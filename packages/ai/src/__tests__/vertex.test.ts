import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, test } from "node:test";
import { createGeminiClient, ModelUnavailableError } from "../gemini";
import { clearVertexTokens, VERTEX_DEFAULT_MODEL, vertexEndpoint, vertexFromEnv, type VertexConfig } from "../vertex";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = {
  type: "service_account",
  client_email: "ranker@demo-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
};
const CFG: VertexConfig = { project: "demo-project", location: "global", credentials: SA };

beforeEach(() => clearVertexTokens());

/** Fake Google: answers the token exchange and generateContent, recording every call. */
function fakeGoogle() {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("Vertex mode signs a valid service-account JWT, uses the global endpoint and reuses the token", async () => {
  const google = fakeGoogle();
  const client = createGeminiClient({ vertex: CFG, fetchImpl: google.impl });
  assert.equal(client.model, VERTEX_DEFAULT_MODEL);
  const req = { system: "s", parts: [{ text: "hi" }], schema: {} };
  assert.equal(await client.generateJson(req), '{"ok":true}');
  assert.equal(await client.generateJson(req), '{"ok":true}');

  const tokenCalls = google.calls.filter((c) => c.url.endsWith("/token"));
  const modelCalls = google.calls.filter((c) => !c.url.endsWith("/token"));
  assert.equal(tokenCalls.length, 1, "token is cached across requests");
  assert.equal(modelCalls.length, 2);
  assert.equal(
    modelCalls[0].url,
    `https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/publishers/google/models/${VERTEX_DEFAULT_MODEL}:generateContent`,
  );
  const headers = modelCalls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer tok-1");
  assert.equal(headers["x-goog-api-key"], undefined);

  // The assertion is a JWT signed by the service account's key, scoped to Google Cloud.
  const assertion = new URLSearchParams(String(tokenCalls[0].init.body)).get("assertion")!;
  const [h, p, sig] = assertion.split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig, "base64url"));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(claims.exp - claims.iat, 3600);
});

test("regional locations use the regional host", () => {
  assert.match(vertexEndpoint({ ...CFG, location: "us-central1" }, "m"), /^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/demo-project\/locations\/us-central1\//);
});

test("vertexFromEnv: off by default, reads base64 or raw JSON credentials, and explains misconfiguration", () => {
  assert.equal(vertexFromEnv({}), null);
  const b64 = Buffer.from(JSON.stringify(SA)).toString("base64");
  const cfg = vertexFromEnv({ GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_CLOUD_PROJECT: "p", GOOGLE_SERVICE_ACCOUNT_JSON: b64 });
  assert.equal(cfg?.credentials.client_email, SA.client_email);
  assert.equal(cfg?.location, "global");
  const raw = vertexFromEnv({ GOOGLE_GENAI_USE_VERTEXAI: "1", GOOGLE_CLOUD_PROJECT: "p", GOOGLE_CLOUD_LOCATION: "us-east5", GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) });
  assert.equal(raw?.location, "us-east5");
  assert.throws(() => vertexFromEnv({ GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_SERVICE_ACCOUNT_JSON: b64 }), /GOOGLE_CLOUD_PROJECT/);
  assert.throws(() => vertexFromEnv({ GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_CLOUD_PROJECT: "p" }), /GOOGLE_SERVICE_ACCOUNT_JSON/);
});

test("a failed token exchange is a ModelUnavailableError, so callers fall back", async () => {
  const denied = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
  const client = createGeminiClient({ vertex: CFG, fetchImpl: denied });
  await assert.rejects(client.generateJson({ system: "", parts: [], schema: {} }), (err: unknown) => {
    assert.ok(err instanceof ModelUnavailableError);
    assert.match(err.message, /Vertex AI auth failed: Vertex token exchange returned 401/);
    return true;
  });
});

test("an explicit apiKey keeps the Gemini API path even when Vertex env is set", async () => {
  const saved = { ...process.env };
  process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
  process.env.GOOGLE_CLOUD_PROJECT = "p";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
  try {
    const google = fakeGoogle();
    await createGeminiClient({ apiKey: "k", model: "m", fetchImpl: google.impl }).generateJson({ system: "", parts: [], schema: {} });
    assert.match(google.calls[0].url, /generativelanguage\.googleapis\.com/);
    assert.equal(createGeminiClient({ fetchImpl: google.impl }).model, process.env.GEMINI_MODEL || VERTEX_DEFAULT_MODEL);
  } finally {
    process.env = saved;
  }
});

test("Gemini 3 thinks at a low level by default; older models keep temperature 0", async () => {
  const { generationTuning } = await import("../gemini");
  const saved = { ...process.env };
  delete process.env.GEMINI_THINKING_LEVEL;
  delete process.env.GEMINI3_TEMPERATURE;
  try {
    assert.deepEqual(generationTuning("gemini-3-flash-preview", 0), { thinkingConfig: { thinkingLevel: "low" } });
    assert.deepEqual(generationTuning("gemini-2.5-flash", undefined), { temperature: 0 });
    process.env.GEMINI_THINKING_LEVEL = "minimal";
    assert.deepEqual(generationTuning("gemini-3.1-pro-preview"), { thinkingConfig: { thinkingLevel: "minimal" } });
    // A request's own level wins over the env; older models ignore it.
    process.env.GEMINI_THINKING_LEVEL = "high";
    assert.deepEqual(generationTuning("gemini-3-flash-preview", 0, "minimal"), { thinkingConfig: { thinkingLevel: "minimal" } });
    assert.deepEqual(generationTuning("gemini-2.5-flash", 0.2, "minimal"), { temperature: 0.2 });
  } finally {
    process.env = saved;
  }
});
