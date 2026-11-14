// Output checks for Gemini text in revision 6. Gemini may only reword: every number it writes must
// already be in the case data, it can't make decision, eligibility, coverage or medical claims,
// and it can't echo instruction-like text. Anything that fails falls back to the template.

import { detectInjection } from "../sanitize";

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const toNum = (s: string) => Number(s.replace(/,/g, ""));

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(toNum).filter((n) => Number.isFinite(n));
}

/** Every number the model may cite: numeric values plus the numbers printed inside the given strings. */
export function allowedNumbers(values: Array<number | string | null | undefined>): Set<number> {
  const allowed = new Set<number>();
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      allowed.add(v);
      allowed.add(Math.abs(v));
    } else if (typeof v === "string") {
      for (const n of numbersIn(v)) allowed.add(n);
    }
  }
  return allowed;
}

/** Dollars for a cents value, so "$432.00" and "$432" both match 43200 cents. */
export const dollars = (cents: number) => cents / 100;

const DECISION = /\b(eligib\w*|approv\w*|den(y|ied|ial)|reject\w*|guarantee\w*|deserv\w*|qualif\w*|entitled)\b/i;
const MEDICAL = [
  /\bdiagnos\w*/i,
  /\byou (have|may have|might have|suffer)\b/i,
  /\b(symptom|condition|disease|infection|illness)s?\b/i,
  /\b(dosage|doses?|treatments?|treating|treat)\b/i,
];
const COVERAGE = [
  /\b(you are|you're|you will be) (eligible|approved|covered|qualified)\b/i,
  /\b(will|should) be (approved|paid|covered|forgiven)\b/i,
  /\bguarantee\w*/i,
  /\b(the )?(fund|hospital|insurance|insurer|medicare|medicaid) (will|should) (pay|cover|approve)\b/i,
];

export interface CheckOptions {
  allowed: Set<number>;
  /** Reject decision words (approve, deny, eligible…). Briefs and explanations: yes. */
  noDecisions?: boolean;
  maxLength?: number;
  /** Strings that must appear verbatim (e.g. the amounts that matter). */
  mustInclude?: string[];
}

/** Null when the text passes, otherwise the reason it was rejected. */
export function checkText(text: string, opts: CheckOptions): string | null {
  if (!text.trim()) return "empty";
  if (text.length > (opts.maxLength ?? 1200)) return "too long";
  if (detectInjection(text).length) return "contains instruction-like text";
  if (opts.noDecisions && DECISION.test(text)) return "makes a decision or eligibility claim";
  for (const re of [...MEDICAL, ...COVERAGE]) if (re.test(text)) return `forbidden claim: ${re.source}`;
  for (const n of numbersIn(text)) if (!opts.allowed.has(n)) return `number ${n} is not in the case data`;
  for (const s of opts.mustInclude ?? []) if (!text.includes(s)) return `missing "${s}"`;
  return null;
}

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("model call timed out")), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}
