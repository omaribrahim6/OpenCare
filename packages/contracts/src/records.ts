// Records as the API returns them (SPEC §9). Database rows live in packages/core.

import type { ExpenseCategory, InsuranceStatus, NeedAssessment, SuspiciousContent } from "./ai";
import type { BillStep, DecisionBrief, VisitSummary } from "./bills";
import type { Cents, GrantStatus, ReceiptStatus } from "./grants";

export interface PatientSummary {
  id: string;
  /** Fictional display name. */
  displayName: string;
}

/** Need information set at enrollment (SPEC §3 "Patient profile"). Null means unknown. */
export interface PatientProfile {
  householdSize: number | null;
  monthlyIncomeCents: Cents | null;
  insurance: InsuranceStatus | null;
}

/** A hospital in revision 6 (SPEC §9 "Hospital"): approval pays its Nessie merchant. */
export interface Provider {
  id: string;
  name: string;
  /** e.g. "hospital". */
  kind: string;
}

/**
 * kiosk = patient app, hospital = intake terminal, reviewer = admin panel (SPEC §9).
 * "provider" is the revision 5 redemption device; it goes away once the web screens move to "hospital".
 */
export const DEVICE_ROLES = ["kiosk", "hospital", "reviewer", "provider"] as const;

export type DeviceRole = (typeof DEVICE_ROLES)[number];

export interface Device {
  id: string;
  role: DeviceRole;
  label: string;
  /** Set for hospital (and legacy provider) devices: the hospital it logs visits for. */
  providerId: string | null;
}

export type DocumentSource = "nessie_bill" | "nessie_purchase";

/** A likely-medical Nessie bill or purchase offered to the patient (SPEC §4 "Bills found"). */
export interface FoundBill {
  /** Nessie bill or purchase ID. */
  id: string;
  source: DocumentSource;
  /** Untrusted text from Nessie. */
  merchant: string;
  description: string | null;
  date: string | null;
  amountCents: Cents;
  likelyMedical: boolean;
  category: ExpenseCategory | null;
  reason: string;
}

/** The Nessie item a patient chose, copied into our database (SPEC §9 Document). */
export interface DocumentRecord {
  id: string;
  patientId: string;
  source: DocumentSource;
  nessieId: string;
  merchant: string;
  description: string | null;
  /** ISO date YYYY-MM-DD, if Nessie had one. */
  date: string | null;
  amountCents: Cents;
  likelyMedical: boolean | null;
  category: ExpenseCategory | null;
  createdAt: string;
}

export interface Receipt {
  nessiePaymentId: string | null;
  solanaSignature: string | null;
  /** Explorer link for the devnet signature. */
  explorerUrl: string | null;
  receiptStatus: ReceiptStatus;
}

/** One caseworker's approval. Grants above SECOND_APPROVAL_ABOVE_CENTS need two. */
export interface GrantApproval {
  reviewerLabel: string;
  approvedCents: Cents;
  at: string;
}

export interface Grant {
  id: string;
  patient: PatientSummary;
  /** Revision 6: the visit this request is for. Null only for revision 5 grants. */
  visit?: VisitSummary | null;
  /** @deprecated Revision 5 Nessie document. Revision 6 grants carry `visit` instead. */
  bill: DocumentRecord;
  /** The hospital the fund pays on approval (revision 6: the visit's hospital). */
  provider: Provider;
  /** Revision 6: the visit's remaining balance when the patient asked. */
  requestedCents: Cents;
  approvedCents: Cents | null;
  status: GrantStatus;
  /** Optional note from the patient. Untrusted: show as plain text, never scored. */
  hardshipNote: string | null;
  approvals: GrantApproval[];
  /** True while a large grant has one approval and waits for a second caseworker. */
  awaitingSecondApproval: boolean;
  createdAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  /** Present once the payout started. */
  receipt: Receipt | null;
}

/** One row of the caseworker queue (SPEC §4 screen 5). */
export interface QueueItem {
  /** 1-based position. Revision 6: always formula order (score, longest wait, earliest). */
  rank: number;
  /** 1-based position in formula order (equal to rank in revision 6). */
  formulaRank: number;
  /** @deprecated Always false in revision 6 (no Gemini ranking). */
  disagreesWithFormula: boolean;
  grant: Grant;
  profile: PatientProfile;
  daysWaiting: number;
  assessment: NeedAssessment;
  /** Revision 6: the brief's reasons joined; kept for older screens. */
  rationale: string;
  suspiciousContent: SuspiciousContent | null;
  /** Revision 6: the decision brief. Core always sets it; optional only so older mocks type-check. */
  brief?: DecisionBrief;
  /** Revision 6: the bill's path, for the queue row. */
  path?: BillStep[];
  /** Revision 6: the remaining balance (what approval would pay). */
  remainingCents?: Cents;
}

export interface ReviewQueue {
  /** Revision 6: always "formula" (the published need-v1 order). */
  source: "gemini" | "formula";
  model: string | null;
  availableCents: Cents;
  items: QueueItem[];
  rankedAt: string;
}

export type FundEventType = "donation" | "reservation" | "release" | "payout" | "receipt";

export interface FundLedgerEntry {
  type: FundEventType;
  /** Opaque reference; never a patient identifier. */
  reference: string;
  amountCents: Cents;
  solanaSignature: string | null;
  at: string;
}

export interface FundSummary {
  totalCents: Cents;
  availableCents: Cents;
  reservedCents: Cents;
  paidCents: Cents;
  approvedCount: number;
  paidCount: number;
  /** Optional only so older mocks still type-check; core always sets it. */
  donationCount?: number;
  /** The fund's public rules (SPEC §2). */
  rules?: { secondApprovalAboveCents: Cents };
  /** Daily totals from the TimescaleDB continuous aggregate (empty when not available). */
  daily: { day: string; approvedCents: Cents; paidCents: Cents }[];
  recent: FundLedgerEntry[];
}

/** A recorded donation (SPEC §8). Donors are anonymous. */
export interface Donation {
  id: string;
  rail: "nessie" | "solana";
  amountCents: Cents;
  /** Nessie deposit ID for card donations. */
  nessieDepositId: string | null;
  solanaSignature: string | null;
  at: string;
}
