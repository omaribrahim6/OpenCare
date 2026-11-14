// Minimal Gemini client over REST (no SDK dependency). Backend only: keys and tokens never
// reach the browser (SPEC §5, §10). We never log prompts, images or replies.
// Two ways in: Vertex AI with a service account (GOOGLE_GENAI_USE_VERTEXAI=true, see ./vertex),
// or the Gemini API with GEMINI_API_KEY.

import { VERTEX_DEFAULT_MODEL, vertexAccessToken, vertexEndpoint, vertexFromEnv, type VertexConfig } from "./vertex";

export interface ModelPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface ModelRequest {
  system: string;
  parts: ModelPart[];
  /** Gemini responseSchema (OpenAPI subset). */
  schema: Record<string, unknown>;
  temperature?: number;
}

/** Anything that turns a request into raw JSON text. Tests pass a fake. */
export interface ModelClient {
  /** Model name, recorded with Gemini queue rankings. */
  readonly model?: string;
  generateJson(req: ModelRequest): Promise<string>;
}

export class ModelUnavailableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export const DEFAULT_MODEL = "gemini-2.5-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiOptions {
  apiKey?: string;
  /** Vertex settings; defaults to vertexFromEnv() unless an apiKey is passed explicitly. */
  vertex?: VertexConfig | null;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createGeminiClient(opts: GeminiOptions = {}): ModelClient {
  // `||` so an empty value from .env ("GEMINI_MODEL=") falls back to the default.
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  let vertex: VertexConfig | null = null;
  let vertexError: string | null = null;
  try {
    vertex = opts.vertex !== undefined ? opts.vertex : opts.apiKey !== undefined ? null : vertexFromEnv();
  } catch (err) {
    vertexError = (err as Error).message;
  }
  const model = opts.model || process.env.GEMINI_MODEL || (vertex ? VERTEX_DEFAULT_MODEL : DEFAULT_MODEL);
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    model,
    async generateJson(req) {
      if (vertexError) throw new ModelUnavailableError(`Vertex AI is misconfigured: ${vertexError}`);
      if (!vertex && !apiKey) throw new ModelUnavailableError("GEMINI_API_KEY is not set (or turn on Vertex AI)");
      let url: string;
      let auth: Record<string, string>;
      if (vertex) {
        try {
          auth = { authorization: `Bearer ${await vertexAccessToken(vertex, doFetch)}` };
        } catch (err) {
          throw new ModelUnavailableError(`Vertex AI auth failed: ${(err as Error).message}`);
        }
        url = vertexEndpoint(vertex, model);
      } else {
        auth = { "x-goog-api-key": apiKey as string };
        url = `${BASE_URL}/${encodeURIComponent(model)}:generateContent`;
      }
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: req.parts }],
        generationConfig: {
          ...generationTuning(model, req.temperature),
          responseMimeType: "application/json",
          responseSchema: req.schema,
        },
      });

      let lastError: ModelUnavailableError | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        let res: Response;
        try {
          res = await doFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", ...auth },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          lastError = new ModelUnavailableError(`Gemini request failed: ${(err as Error).name}`);
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          lastError = new ModelUnavailableError(`Gemini returned ${res.status}`, res.status);
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (!res.ok) throw new ModelUnavailableError(`Gemini returned ${res.status}`, res.status);

        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
          promptFeedback?: { blockReason?: string };
        };
        if (data.promptFeedback?.blockReason) {
          throw new ModelUnavailableError(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (!text) throw new ModelUnavailableError("Gemini returned no content");
        return text;
      }
      throw lastError ?? new ModelUnavailableError("Gemini request failed");
    },
  };
}

/**
 * Gemini 3 models think before answering; at the default level a queue ranking can take over 20s.
 * GEMINI_THINKING_LEVEL ("minimal" | "low" | "medium" | "high", default "low") keeps it fast.
 * Google advises leaving Gemini 3 at its default temperature (1.0): lower values can loop.
 * Older models keep the caller's temperature (default 0).
 */
export function generationTuning(model: string, temperature?: number): Record<string, unknown> {
  if (/^gemini-3/.test(model)) {
    const level = process.env.GEMINI_THINKING_LEVEL || "low";
    const keepTemp = process.env.GEMINI3_TEMPERATURE;
    return { thinkingConfig: { thinkingLevel: level }, ...(keepTemp ? { temperature: Number(keepTemp) } : {}) };
  }
  return { temperature: temperature ?? 0 };
}

// Small helpers for building response schemas.
export const S = {
  str: (description?: string) => ({ type: "STRING", nullable: true, ...(description && { description }) }),
  bool: (description?: string) => ({ type: "BOOLEAN", ...(description && { description }) }),
  enumOf: (values: readonly string[], description?: string) => ({
    type: "STRING",
    enum: [...values],
    nullable: true,
    ...(description && { description }),
  }),
  list: (items: Record<string, unknown>, description?: string) => ({ type: "ARRAY", items, ...(description && { description }) }),
  obj: (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
    type: "OBJECT",
    properties,
    required,
  }),
};
