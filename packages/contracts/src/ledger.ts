// Public ledger (fraud resistance). Anyone can audit every case the community fund decided: the
// cost of care, the itemized bill, what insurance and the hospital covered, the need score and
// the decision, all tied to the on-chain receipt. Names, birth dates, SSNs, addresses and
// hardship notes never appear here; only a paired reviewer device can reveal identity, and every
// reveal is logged and counted publicly.

import type { ExpenseCategory, InsuranceStatus, NeedFactor, SuspiciousContent } from "./ai";
import type { BillStep, InsuranceAdjudication, InsurancePlan, LineItem, PolicyApplicationStatus } from "./bills";
import type { Cents, GrantStatus } from "./grants";
import type { Provider } from "./records";

export type LedgerKind = "donation" | "payout" | "declined" | "pending";

/** One row of the public ledger. */
export interface LedgerEntry {
  kind: LedgerKind;
  /** Opaque reference: the Solana memo for cases, the donation ID for donations. */
  reference: string;
  at: string;
  /** Money that moved: the donation, or the fund's payout to the hospital (0 when declined). */
  amountCents: Cents;
  solanaSignature: string | null;
  /** Donations: a named institutional funder, or null for an anonymous donor. */
  donorLabel?: string | null;
  rail?: "nessie" | "solana";
  /** Cases only. */
  hospital?: string;
  category?: ExpenseCategory;
  /** Cases: the hospital-attested visit description (no names). */
  summary?: string;
  chargesCents?: Cents;
  insurerPaidCents?: Cents;
  hospitalAssistanceCents?: Cents;
  needScore?: number | null;
  region?: string | null;
}

export interface LedgerResponse {
  entries: LedgerEntry[];
  totals: { donatedCents: Cents; paidCents: Cents; careCostCents: Cents; cases: number; declined: number };
}

/** Everything about one decided case, minus identity (GET /api/ledger/:ref). */
export interface LedgerCase {
  reference: string;
  status: GrantStatus;
  visit: {
    date: string;
    hospital: Provider;
    category: ExpenseCategory;
    description: string;
    lineItems: LineItem[];
    totalCents: Cents;
    attestedBy: string;
  };
  steps: BillStep[];
  chargesCents: Cents;
  insurerPaidCents: Cents;
  hospitalAssistanceCents: Cents;
  fundPaidCents: Cents;
  patientPaidCents: Cents;
  remainingCents: Cents;
  plan: InsurancePlan | null;
  insurance: InsuranceAdjudication | null;
  applications: {
    name: string;
    kind: string;
    source: string;
    status: PolicyApplicationStatus;
    reductionCents: Cents;
    reason: string;
    criteria: { label: string; met: boolean | null; detail: string }[];
  }[];
  /** Non-identifying patient context. */
  patient: {
    region: string | null;
    ageBand: string | null;
    householdSize: number | null;
    monthlyIncomeCents: Cents | null;
    incomePctOfPoverty: number | null;
    insurance: InsuranceStatus | null;
    priorPaidCount90d: number;
  };
  need: { score: number; formulaVersion: string; factors: NeedFactor[]; incomeMismatch: boolean } | null;
  suspicious: SuspiciousContent | null;
  decision: {
    requestedCents: Cents;
    approvedCents: Cents | null;
    note: string | null;
    requestedAt: string;
    decidedAt: string | null;
    paidAt: string | null;
    approvals: { reviewerLabel: string; approvedCents: Cents; at: string }[];
  };
  payout: {
    nessiePaymentId: string | null;
    solanaSignature: string | null;
    explorerUrl: string | null;
  };
  /** How many times a caseworker revealed this case's identity (each reveal is logged). */
  identityReveals: number;
}

/** POST /api/ledger/:ref/identity (reviewer device only). */
export interface IdentityRevealRequest {
  reason?: string;
}

export interface IdentityRevealResponse {
  identity: {
    legalName: string;
    dateOfBirth: string;
    ssn: string;
    address: string | null;
    phone: string | null;
    memberId: string | null;
    fictional: boolean;
  };
  revealedBy: string;
  revealedAt: string;
  identityReveals: number;
}
