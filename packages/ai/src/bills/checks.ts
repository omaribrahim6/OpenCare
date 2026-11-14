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
  /\byou (may have|might have|suffer)\b/i,
  // "You have $432.00 left" or "you have the right to ask" is billing talk; "you have a fracture" is not.
  /\byou have (?!\$|(been |now )?(left|to pay|paid|charged|billed|owe)\b|(a |an |the |some |any |\d+ )?(remaining |outstanding |final |unpaid )?(balance|bill|amount|charge|option|right|choice|question|payment|days?)s?\b)/i,
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
  /** What the text must still say: amounts (matched by value) and names (matched loosely). */
  mustInclude?: Required[];
}

/** A required amount or name. The label goes in the fallback reason, so it carries no case data. */
export type Required = { label: string; cents: number } | { label: string; text: string };

/** Null when the text passes, otherwise the reason it was rejected. */
export function checkText(text: string, opts: CheckOptions): string | null {
  if (!text.trim()) return "empty";
  if (text.length > (opts.maxLength ?? 1200)) return "too long";
  if (detectInjection(text).length) return "contains instruction-like text";
  if (opts.noDecisions && DECISION.test(text)) return "makes a decision or eligibility claim";
  for (const re of [...MEDICAL, ...COVERAGE]) if (re.test(text)) return `forbidden claim: ${re.source}`;
  for (const m of text.matchAll(NUMBER)) {
    const n = toNum(m[0]);
    if (Number.isFinite(n) && !opts.allowed.has(n)) return `${numberKind(text, m.index ?? 0, m[0].length)} is not in the case data`;
  }
  for (const r of opts.mustInclude ?? []) if (!mentions(text, r)) return `missing the ${r.label}`;
  return null;
}

/** What kind of number was rejected, so the fallback log says something useful without the value. */
function numberKind(text: string, start: number, length: number): string {
  if (text[start - 1] === "$") return "a dollar amount";
  if (/^\s*(%|percent\b)/i.test(text.slice(start + length))) return "a percentage";
  return "a plain number";
}

/**
 * Amounts match by value, so "$1,728.00", "$1,728", "$1728.00" and "1,728 dollars" all cite 172800
 * cents. That is safe because the number check above already rejects any number (such as $1,728.50)
 * that is not in the case data. Names ignore case and punctuation: "charity-care" cites "Charity care".
 */
function mentions(text: string, r: Required): boolean {
  if ("cents" in r) return numbersIn(text).includes(dollars(r.cents));
  const norm = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return norm(text).includes(norm(r.text));
}

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("model call timed out")), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}
