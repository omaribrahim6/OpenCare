// UI types. Stable shapes come from @abdulcare/contracts; the need-ranking shapes below
// mirror SPEC rev 4 §7 locally until the api lane's migration 003 contracts land.

import type { Cents, GrantStatus, PatientSummary, Provider, Receipt } from "@abdulcare/contracts";

export type { Cents, FundSummary, GrantStatus, PatientSummary, Provider, Receipt } from "@abdulcare/contracts";

export const EXPENSE_CATEGORIES = [
  "pharmacy",
  "emergency",
  "hospital",
  "primary_care",
  "dental_vision",
  "other_medical",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  pharmacy: "Pharmacy",
  emergency: "Emergency",
  hospital: "Hospital",
  primary_care: "Primary care",
  dental_vision: "Dental / vision",
  other_medical: "Other medical",
};

export interface FoundBill {
  id: string;
  source: "nessie_bill" | "nessie_purchase";
  merchant: string;
  date: string | null;
  amountCents: Cents;
  likelyMedical: boolean;
  category: ExpenseCategory | null;
  reason: string;
}

export type TapResult =
  | { kind: "session"; patient: PatientSummary }
  | { kind: "unknown_card" }
  | { kind: "unpaired_device" };

export interface BillExplanation {
  summary: string;
  amountCents: Cents;
  provider: Provider;
}

export type InsuranceStatus = "uninsured" | "underinsured" | "insured" | "unknown";

export type FactorKey = "income" | "cost_burden" | "insurance" | "cost_of_care" | "urgency" | "wait_time" | "prior_support";

export interface NeedFactor {
  key: FactorKey;
  label: string;
  /** Human-readable input, e.g. "80% of poverty guideline". */
  input: string;
  points: number;
  maxPoints: number;
  unknown?: boolean;
}

export interface NeedAssessment {
  score: number; // 0–100, "need score", never "eligibility"
  formulaVersion: string;
  factors: NeedFactor[];
  rationale: string;
  incomePctOfPoverty: number | null;
  incomeEstimatedFromDeposits: boolean;
  suspiciousContent: { excerpt: string; field: string } | null;
}

export interface QueueItem {
  rank: number;
  grantId: string;
  patient: PatientSummary;
  provider: Provider;
  bill: { merchant: string; description: string; date: string | null; category: ExpenseCategory };
  requestedCents: Cents;
  daysWaiting: number;
  hardshipNote: string | null;
  profile: { householdSize: number; monthlyIncomeCents: Cents | null; insurance: InsuranceStatus };
  assessment: NeedAssessment;
}

export interface GrantView {
  id: string;
  patient: PatientSummary;
  provider: Provider;
  requestedCents: Cents;
  approvedCents: Cents | null;
  status: GrantStatus;
  receipt: Receipt | null;
}
