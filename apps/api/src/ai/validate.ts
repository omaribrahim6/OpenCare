// Server-side validation of model output (SPEC §7). Model JSON is untrusted: we keep only
// known keys, convert money ourselves, and turn anything doubtful into null plus a warning.

import { cleanUntrusted, detectInjection, INJECTION_WARNING } from "./sanitize";
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type ExtractedFields,
  type ExtractionResult,
  type Field,
  type FieldName,
} from "./types";

/** Largest bill we accept, $100,000.00. Anything above is almost certainly a misread. */
export const MAX_CENTS = 10_000_000;

export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

/** Parse a JSON reply, tolerating a ```json fence around it. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AiOutputError("Model reply was not valid JSON");
  }
}

/**
 * Convert a printed amount ("$1,234.56", "45", "45.5", "USD 12.00") to integer cents.
 * Returns null for negatives, ambiguous formats, or values outside 0..MAX_CENTS.
 */
export function moneyToCents(input: unknown): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    const cents = Math.round(input * 100);
    return cents <= MAX_CENTS ? cents : null;
  }
  if (typeof input !== "string") return null;
  const s = input.replace(/[$\s]|USD|US\$/gi, "");
  if (s.startsWith("-") || s.startsWith("(")) return null;
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const dollars = Number(m[1].replace(/,/g, ""));
  const cents = dollars * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** Accepts YYYY-MM-DD for a real calendar date between 2000 and next year. */
export function normalizeDate(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || y > new Date().getUTCFullYear() + 1) return null;
  return m[0];
}

function str(input: unknown, max: number): string | null {
  const s = cleanUntrusted(input, max);
  return s.length > 0 ? s : null;
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function stringList(input: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((x) => str(x, maxLen)).filter((x): x is string => x !== null).slice(0, maxItems);
}

/** True when some amount printed in the evidence converts to the same cents value. */
function evidenceHasAmount(evidence: string, cents: number): boolean {
  const amounts = evidence.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g) ?? [];
  return amounts.some((a) => moneyToCents(a) === cents);
}

function field<T>(value: T | null, evidence: string | null): Field<T> {
  return value === null ? { value: null, evidence: null } : { value, evidence };
}

/**
 * Validate the extraction model's JSON. Expected (loosely) shape:
 * { readable, provider:{value,evidence}, documentType:{...}, currency:{...},
 *   total:{value:"45.00", evidence}, date:{...}, supportingText:[], warnings:[] }
 */
export function validateExtraction(raw: unknown, source: "scan" | "nessie"): ExtractionResult {
  const obj = record(raw);
  if (Object.keys(obj).length === 0) throw new AiOutputError("Model reply was not a JSON object");
  const warnings = new Set<string>(stringList(obj.warnings, 5, 200));

  const part = (key: string) => {
    const f = record(obj[key]);
    return { value: f.value, evidence: str(f.evidence, 200) };
  };

  const p = part("provider");
  const provider = field(str(p.value, 120), p.evidence);

  const t = part("documentType");
  const typeValue = typeof t.value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(t.value)
    ? (t.value as DocumentType)
    : null;
  const documentType = field(typeValue, t.evidence);

  const c = part("currency");
  const cur = typeof c.value === "string" ? c.value.trim().toUpperCase() : "";
  const currency = field(/^[A-Z]{3}$/.test(cur) ? cur : null, c.evidence);
  if (currency.value && currency.value !== "USD") warnings.add(`Currency is ${currency.value}, not USD. Amounts are not converted.`);

  const a = part("total");
  let cents = moneyToCents(a.value);
  if (a.value !== null && a.value !== undefined && cents === null) {
    warnings.add("The total could not be read as a valid amount. Please enter it by hand.");
  }
  if (cents !== null && (!a.evidence || !evidenceHasAmount(a.evidence, cents))) {
    // The amount isn't backed by the quoted text: don't trust it.
    warnings.add("The total wasn't clearly supported by the document text. Please check it.");
    cents = null;
  }
  const totalCents = field(cents, a.evidence);

  const d = part("date");
  const date = field(normalizeDate(d.value), d.evidence);

  const fields: ExtractedFields = { provider, documentType, currency, totalCents, date };
  const missing = (Object.keys(fields) as FieldName[]).filter((k) => fields[k].value === null);
  const supportingText = stringList(obj.supportingText, 20, 200);

  const allText = [
    ...Object.values(fields).flatMap((f) => [String(f.value ?? ""), f.evidence ?? ""]),
    ...supportingText,
    ...warnings,
  ].join("\n");
  if (obj.injectionSuspected === true || detectInjection(allText).length > 0) warnings.add(INJECTION_WARNING);

  const readable = obj.readable !== false && missing.length < Object.keys(fields).length;
  return { readable, fields, missing, supportingText, warnings: [...warnings], source };
}
