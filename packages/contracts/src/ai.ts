// AI shapes, taken from the ai lane's original types (packages/ai re-exports or imports these).
// All money is integer cents (SPEC §8). Unknown values are null, never guessed (SPEC §3, §7).

import type { Cents } from "./grants";

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
  /** Amount the patient is asked to pay. */
  totalCents: Field<Cents>;
  /** ISO date YYYY-MM-DD. */
  date: Field<string>;
}

export type FieldName = keyof ExtractedFields;

export interface ExtractionResult {
  /** False when the image is unreadable or not a bill: show retake/manual review. */
  readable: boolean;
  fields: ExtractedFields;
  missing: FieldName[];
  supportingText: string[];
  /** Why the source may be unreliable, including suspicious embedded instructions (SPEC §7). */
  warnings: string[];
  source: "scan" | "nessie";
}

/** Fields after the patient reviewed and corrected them. */
export interface ConfirmedFields {
  provider: string | null;
  documentType: DocumentType | null;
  currency: string | null;
  totalCents: Cents | null;
  date: string | null;
}

export interface Explanation {
  summary: string;
  points: string[];
  questionsToAsk: string[];
  disclaimer: string;
  /** True when a template was used because the AI was unavailable or failed checks. */
  fallback: boolean;
}

/** A Nessie purchase or bill, reduced to what the classifier needs. */
export interface TransactionInput {
  id: string;
  kind: "purchase" | "bill";
  /** Merchant name or payee (untrusted text). */
  merchant: string;
  description?: string;
  amountCents: Cents;
  date?: string;
}

export interface TransactionClassification {
  id: string;
  likelyMedical: boolean;
  reason: string;
  basis: "ai" | "rules";
}

/** What the patient tells the kiosk, all optional. */
export interface PatientInfo {
  householdSize?: number;
  annualIncomeCents?: Cents;
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
  detail: string;
}

export interface ProgramMatch {
  programId: string;
  name: string;
  fictional: boolean;
  fit: "possible" | "needs_info" | "unlikely";
  possibleFit: boolean;
  reasons: string[];
  criteria: CriterionResult[];
  missingInfo: string[];
  /** Max the program could cover for this bill, or null if the bill amount is unknown. */
  maxCents: Cents | null;
  /** A match is a possible fit, never a guarantee (SPEC §3). */
  note: string;
}
