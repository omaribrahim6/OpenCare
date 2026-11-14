// Gemini through Vertex AI (billed to the Google Cloud project). A service account signs a
// short JWT with node:crypto (RS256), which Google exchanges for a one-hour OAuth token.
// No SDK dependency. Credentials and tokens are never logged.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface VertexConfig {
  project: string;
  /** "global" or a region such as "us-central1". */
  location: string;
  credentials: ServiceAccount;
}

/** Gemini 3 Flash: available to the project on Vertex (2.5 models are not). */
export const VERTEX_DEFAULT_MODEL = "gemini-3-flash-preview";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw.trim(), "base64").toString("utf8");
  const sa = JSON.parse(text) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("Service account JSON is missing client_email or private_key");
  return sa;
}

/**
 * Vertex settings from the environment, or null when Vertex is off.
 * - GOOGLE_GENAI_USE_VERTEXAI=true turns it on.
 * - GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (default "global") pick the endpoint.
 * - Credentials: GOOGLE_SERVICE_ACCOUNT_JSON (the key file's JSON, raw or base64; used on Vercel,
 *   which has no key files), else the file at GOOGLE_APPLICATION_CREDENTIALS (local dev).
 */
export function vertexFromEnv(env: NodeJS.ProcessEnv = process.env): VertexConfig | null {
  const flag = (env.GOOGLE_GENAI_USE_VERTEXAI ?? "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1") return null;
  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = env.GOOGLE_APPLICATION_CREDENTIALS?.trim().replace(/^"(.*)"$/, "$1");
  let credentials: ServiceAccount;
  if (inline) credentials = parseServiceAccount(inline);
  else if (file) credentials = parseServiceAccount(readFileSync(file, "utf8"));
  else throw new Error("Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS for Vertex AI");
  return { project, location: env.GOOGLE_CLOUD_LOCATION?.trim() || "global", credentials };
}

export function vertexEndpoint(cfg: VertexConfig, model: string): string {
  const host = cfg.location === "global" ? "aiplatform.googleapis.com" : `${cfg.location}-aiplatform.googleapis.com`;
  return (
    `https://${host}/v1/projects/${encodeURIComponent(cfg.project)}/locations/${encodeURIComponent(cfg.location)}` +
    `/publishers/google/models/${encodeURIComponent(model)}:generateContent`
  );
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Forget cached tokens (tests). */
export function clearVertexTokens(): void {
  tokens.clear();
}

/** An OAuth access token for the service account, reused until a minute before it expires. */
export async function vertexAccessToken(
  cfg: VertexConfig,
  doFetch: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string> {
  const key = cfg.credentials.client_email;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  const tokenUri = cfg.credentials.token_uri || TOKEN_URI;
  const iat = Math.floor(now / 1000);
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: cfg.credentials.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(cfg.credentials.private_key, "base64url");

  const res = await doFetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Vertex token exchange returned ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Vertex token exchange returned no token");
  tokens.set(key, { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}
