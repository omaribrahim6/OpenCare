// Queue ranking (SPEC §7 job 3). Gemini compares all pending requests and sets the order.
// Input: anonymized rows of factor values only (labels A, B, C…). Guardrails: the order must be
// a permutation of the labels, every number in a rationale must be one of the queue's values,
// rationales can't make eligibility or approval claims, and the call has a deadline. Any failure
// returns formula order with templated rationales. Core caches the result by input hash and
// re-checks the permutation.

import type { QueueRanking, RankingRow } from "@abdulcare/contracts";
import { createGeminiClient, S, type ModelClient } from "./gemini";
import { asRecord, parseModelJson, usd } from "./json";
import { BASE_RULES, cleanUntrusted, detectInjection } from "./sanitize";

export const RANK_PROMPT_VERSION = "rank-v1";
export const RANK_TIMEOUT_MS = 20_000;
/** Above this, Gemini isn't asked (prompt size and latency); formula order is used. */
export const MAX_RANKED_ROWS = 60;

const SCHEMA = S.obj({
  order: S.list({ type: "STRING" }, "Every label exactly once, highest priority first"),
  rationales: S.list(
    S.obj({
      label: { type: "STRING" },
      rationale: { type: "STRING", description: "2 or 3 sentences comparing this request with the others, using only the given numbers" },
    }),
  ),
});

const PROMPT = `You help a community fund's caseworker decide which pending medical-bill requests to look at first.
Each row below is one anonymized request with its need factors and a formula need score (0-100).
Order ALL rows from greatest to least financial need. The formula score is a strong guide; you may
place a request differently when the factors together justify it (for example a very high cost
burden at very low income), and the rationale must then say why.

For each request write 2 or 3 short sentences that compare it with the others, for example:
"Lowest income in the queue at 80% of the poverty guideline; this $1,200.00 bill equals 1.5 months of income. No prior support from the fund."

Rules:
- Use only numbers that appear in the rows, written the same way. Do not compute new numbers, totals, ranks or positions.
- Refer to other requests by label (e.g. "request B") if needed.
- Never say a request is eligible, approved, denied, guaranteed or deserving; the caseworker decides every grant.
- Unknown factors are scored at their midpoint; mention when a key factor is unknown.`;

/** The exact view of a row that Gemini sees: no IDs, names or free text. */
function promptRow(r: RankingRow) {
  return {
    label: r.label,
    needScore: r.score,
    bill: usd(r.billCents),
    daysWaiting: r.daysWaiting,
    incomePctOfPoverty: r.incomePctOfPoverty,
    factors: r.factors.map((f) => ({
      factor: f.label,
      value: cleanUntrusted(f.input, 120),
      points: f.points,
      maxPoints: f.maxPoints,
      ...(f.unknown && { unknown: true }),
    })),
  };
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const toNum = (s: string) => Number(s.replace(/,/g, ""));

/** Every number the rationales may cite: the queue's own values, as printed or as plain numbers. */
export function allowedNumbers(rows: RankingRow[]): Set<number> {
  const allowed = new Set<number>();
  const addText = (text: string) => {
    for (const m of text.match(NUMBER) ?? []) allowed.add(toNum(m));
  };
  for (const r of rows) {
    allowed.add(r.score);
    allowed.add(r.daysWaiting);
    allowed.add(r.billCents / 100);
    if (r.incomePctOfPoverty !== null) allowed.add(r.incomePctOfPoverty);
    for (const f of r.factors) {
      allowed.add(Math.abs(f.points));
      allowed.add(Math.abs(f.maxPoints));
      addText(f.input);
      addText(f.label);
    }
  }
  return allowed;
}

const FORBIDDEN = /\b(eligib\w*|approv\w*|den(y|ied|ial)|reject\w*|guarantee\w*|deserv\w*|diagnos\w*|qualif\w*)\b/i;

/** Null when the rationale is acceptable, otherwise why not. */
export function checkRationale(text: string, allowed: Set<number>): string | null {
  if (!text || text.length > 600) return "empty or too long";
  if (FORBIDDEN.test(text)) return "makes a decision or eligibility claim";
  if (detectInjection(text).length) return "contains instruction-like text";
  for (const m of text.match(NUMBER) ?? []) {
    if (!allowed.has(toNum(m))) return `number ${m} is not one of the queue's values`;
  }
  return null;
}

export function templatedRationale(row: RankingRow): string {
  const top = [...row.factors]
    .filter((f) => f.points > 0 && !f.unknown)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((f) => `${f.label.toLowerCase()} (${f.input})`);
  const unknown = row.factors.filter((f) => f.unknown).map((f) => f.label.toLowerCase());
  return [
    `Need score ${row.score}.`,
    top.length ? `Largest factors: ${top.join(" and ")}.` : "",
    unknown.length ? `Unknown: ${unknown.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Rows as given (core sends them in formula order) with templated rationales. */
export function formulaRanking(rows: RankingRow[]): QueueRanking {
  return {
    source: "formula",
    order: rows.map((r) => r.label),
    rationales: Object.fromEntries(rows.map((r) => [r.label, templatedRationale(r)])),
    model: null,
  };
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ranking timed out")), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** Validate Gemini's reply; returns null if any guardrail fails. */
export function validateRanking(raw: unknown, rows: RankingRow[], model: string): QueueRanking | null {
  const obj = asRecord(raw);
  const labels = rows.map((r) => r.label);
  const order = Array.isArray(obj.order) ? obj.order : [];
  if (order.length !== labels.length || new Set(order).size !== labels.length || !order.every((l) => labels.includes(l as string))) {
    return null;
  }

  const allowed = allowedNumbers(rows);
  const rationales: Record<string, string> = {};
  for (const item of Array.isArray(obj.rationales) ? obj.rationales : []) {
    const r = asRecord(item);
    if (typeof r.label !== "string" || !labels.includes(r.label) || r.label in rationales) continue;
    const text = cleanUntrusted(r.rationale, 600);
    if (checkRationale(text, allowed) !== null) return null;
    rationales[r.label] = text;
  }
  if (labels.some((l) => !(l in rationales))) return null;
  return { source: "gemini", order: order as string[], rationales, model };
}

export async function rankQueue(
  rows: RankingRow[],
  deps: { client?: ModelClient; timeoutMs?: number } = {},
): Promise<QueueRanking> {
  const fallback = formulaRanking(rows);
  const labelsOk = rows.every((r) => /^[A-Z]{1,3}$/.test(r.label)) && new Set(rows.map((r) => r.label)).size === rows.length;
  if (rows.length === 0 || rows.length > MAX_RANKED_ROWS || !labelsOk) return fallback;

  try {
    const client = deps.client ?? createGeminiClient({ timeoutMs: deps.timeoutMs ?? RANK_TIMEOUT_MS });
    const model = `${client.model ?? "unknown-model"}/${RANK_PROMPT_VERSION}`;
    const text = await withDeadline(
      client.generateJson({
        system: BASE_RULES,
        parts: [{ text: `${PROMPT}\n\nPending requests:\n${rows.map((r) => JSON.stringify(promptRow(r))).join("\n")}` }],
        schema: SCHEMA,
        temperature: 0,
      }),
      deps.timeoutMs ?? RANK_TIMEOUT_MS,
    );
    return validateRanking(parseModelJson(text), rows, model) ?? fallback;
  } catch {
    return fallback;
  }
}
