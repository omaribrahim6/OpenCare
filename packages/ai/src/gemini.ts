// Minimal Gemini client over REST (no SDK dependency). Backend only: the key never
// reaches the browser (SPEC §5, §10). We never log prompts, images or replies.

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
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createGeminiClient(opts: GeminiOptions = {}): ModelClient {
  // `||` so an empty value from .env ("GEMINI_MODEL=") falls back to the default.
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  const model = opts.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    model,
    async generateJson(req) {
      if (!apiKey) throw new ModelUnavailableError("GEMINI_API_KEY is not set");
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: req.parts }],
        generationConfig: {
          temperature: req.temperature ?? 0,
          responseMimeType: "application/json",
          responseSchema: req.schema,
        },
      });

      let lastError: ModelUnavailableError | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        let res: Response;
        try {
          res = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
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
