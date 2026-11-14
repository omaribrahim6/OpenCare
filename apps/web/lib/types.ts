// Local UI types that mirror docs/SPEC.md §8–9.
// Replace with imports from packages/contracts once the api lane merges them.

export type Cents = number;

export type GrantStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "canceled"
  | "payment_pending"
  | "paid";

export type ReceiptStatus = "receipt_pending" | "receipt_confirmed";

export type DocumentSource = "scan" | "nessie_bill" | "nessie_purchase";

export interface Patient {
  id: string;
  displayName: string;
}

export interface Provider {
  id: string;
  name: string;
  kind: string;
}

export interface FoundBill {
  id: string;
  source: Exclude<DocumentSource, "scan">;
  merchant: string;
  date: string;
  amountCents: Cents;
  likelyMedical: boolean;
  reason: string;
}

export interface ExtractedField<T = string> {
  value: T | null; // null = unknown, never guessed
  evidence?: string;
}

export interface ExtractedFields {
  provider: ExtractedField;
  documentType: ExtractedField;
  currency: ExtractedField;
  totalCents: ExtractedField<Cents>;
  date: ExtractedField;
}

export interface ProgramMatch {
  programId: string;
  name: string;
  fictional: boolean;
  possibleFit: boolean;
  reasons: string[];
  missingInfo: string[];
  maxCents: Cents;
}

export interface Explanation {
  summary: string;
  amountCents: Cents;
  matches: ProgramMatch[];
}

export interface Grant {
  id: string;
  patientId: string;
  patientName: string;
  documentId: string;
  provider: Provider;
  requestedCents: Cents;
  approvedCents: Cents | null;
  status: GrantStatus;
  createdAt: string;
  fields: ExtractedFields;
  programName: string;
  receipt?: {
    nessiePaymentId: string | null;
    solanaSignature: string | null;
    receiptStatus: ReceiptStatus;
  };
}

export interface FundSummary {
  contributionsCents: Cents;
  availableCents: Cents;
  reservedCents: Cents;
  approvedCount: number;
  paidCount: number;
  paidCents: Cents;
  ledger: {
    kind: "donation" | "payout";
    reference: string;
    signature: string;
    at: string;
  }[];
}

export type TapResult =
  | { kind: "session"; patient: Patient }
  | { kind: "unknown_card" }
  | { kind: "unpaired_device" };
