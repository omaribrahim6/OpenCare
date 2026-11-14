// Public shapes for the ai lane. When packages/contracts exists, these move there
// (or get re-exported from there); keep this file free of runtime code.
// All money is integer cents (SPEC §8). Unknown values are null, never guessed (SPEC §3, §7).

export const DOCUMENT_TYPES = [
  "pharmacy_receipt",
  "medical_bill",
  "explanation_of_benefits",
  "prescription_receipt",
  "lab_bill",
  "dental_bill",
  "vision_bill",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** One extracted value plus the source text that supports it. */
export interface Field<T> {
  value: T | null;
  /** Short verbatim excerpt from the source that supports the value. Null when value is null. */
  evidence: string | null;
}

export interface ExtractedFields {
  provider: Field<string>;
  documentType: Field<DocumentType>;
  /** ISO 4217, e.g. "USD". */
  currency: Field<string>;
  /** Amount the patient is asked to pay, integer cents. */
  totalCents: Field<number>;
  /** ISO date YYYY-MM-DD (service or statement date). */
  date: Field<string>;
}

export type FieldName = keyof ExtractedFields;

export interface ExtractionResult {
  /** False when the image is unreadable or not a bill: show retake/manual review. */
  readable: boolean;
  fields: ExtractedFields;
  /** Field names whose value is null. */
  missing: FieldName[];
  /** Other text from the document that helps a human reviewer (line items, notes). */
  supportingText: string[];
  /** Why the source may be unreliable: suspicious instructions, clipped amounts, etc. */
  warnings: string[];
  source: "scan" | "nessie";
}

/** Fields after the patient reviewed and corrected them (PATCH /documents/:id/review). */
export interface ConfirmedFields {
  provider: string | null;
  documentType: DocumentType | null;
  currency: string | null;
  totalCents: number | null;
  date: string | null;
}

export interface Explanation {
  /** Two to four short plain-language sentences grounded in the confirmed fields. */
  summary: string;
  /** Bullet points: what the document is, what it asks for, what is unclear. */
  points: string[];
  /** What the patient could check or ask the provider; never medical advice. */
  questionsToAsk: string[];
  /** Always shown: AI explanation, not financial, legal or medical advice. */
  disclaimer: string;
  /** True when the AI was unavailable or its output failed checks and a template was used. */
  fallback: boolean;
}

/** A Nessie purchase or bill, reduced to what the classifier needs. */
export interface TransactionInput {
  id: string;
  kind: "purchase" | "bill";
  /** Merchant name or payee (untrusted text). */
  merchant: string;
  description?: string;
  amountCents: number;
  date?: string;
}

export interface TransactionClassification {
  id: string;
  likelyMedical: boolean;
  /** Short reason shown to the patient. */
  reason: string;
  /** Who decided: the model, the keyword fallback, or both agreeing. */
  basis: "ai" | "rules";
}

/** What the patient tells the kiosk, all optional. */
export interface PatientInfo {
  householdSize?: number;
  /** Annual household income, integer cents. */
  annualIncomeCents?: number;
  /** Two-letter US state code. */
  state?: string;
  insured?: boolean;
  age?: number;
}

export type CriterionStatus = "met" | "not_met" | "unknown";

export interface CriterionResult {
  id: string;
  label: string;
  status: CriterionStatus;
  /** Plain-language reason, e.g. "Bill is $45.00, under the $200.00 cap". */
  detail: string;
}

export interface ProgramMatch {
  programId: string;
  programName: string;
  fictional: boolean;
  /** possible: all known criteria met; needs_info: nothing failed but some unknown; unlikely: a criterion failed. */
  fit: "possible" | "needs_info" | "unlikely";
  criteria: CriterionResult[];
  /** Questions to ask the patient to resolve unknown criteria. */
  missingInfo: string[];
  /** Max the program could cover for this bill, integer cents, or null if unknown. */
  maxCoverCents: number | null;
  /** Always present: a match is a possible fit, never a guarantee (SPEC §3). */
  note: string;
}
