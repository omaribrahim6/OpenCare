// Revision 6: the bill-reduction pipeline (SPEC §1, §7, §8, §9).
// A hospital visit's bill runs through insurance, then every hospital assistance policy, then the
// community care fund. All money is integer cents. Everything here is fictional demo data.

import type { ExpenseCategory, Explanation, NeedAssessment, NeedFactor, SuspiciousContent } from "./ai";
import type { Cents } from "./grants";
import type { PatientProfile, PatientSummary, Provider } from "./records";

// ---------------------------------------------------------------------------
// Insurance (deterministic, packages/core)

/** A made-up plan per demo patient (SPEC §3 "Insurance plan"). */
export interface InsurancePlan {
  /** Fictional payer name. */
  payerName: string;
  deductibleCents: Cents;
  /** Deductible already met this plan year, before this visit. */
  deductibleMetCents: Cents;
  /** Patient's share after the deductible, 0–100. */
  coinsurancePct: number;
  outOfPocketMaxCents: Cents;
  /** Out-of-pocket already spent this plan year, before this visit. */
  outOfPocketMetCents: Cents;
}

/**
 * How the plan split one visit's charges (SPEC §7.1): the patient pays the rest of the deductible,
 * then coinsurance on the remainder, capped by what's left of the out-of-pocket maximum.
 */
export interface InsuranceAdjudication {
  chargesCents: Cents;
  patientDeductibleCents: Cents;
  patientCoinsuranceCents: Cents;
  /** Deductible + coinsurance, after the out-of-pocket cap. */
  patientResponsibilityCents: Cents;
  /** chargesCents − patientResponsibilityCents. Posted as the insurance_adjustment event. */
  insurerPaysCents: Cents;
  /** True when the out-of-pocket maximum lowered the patient's share. */
  outOfPocketCapped: boolean;
}

// ---------------------------------------------------------------------------
// Visits (logged by a paired hospital device)

export interface LineItem {
  /** Untrusted text (it may carry an injection attempt in the demo seed). */
  description: string;
  cents: Cents;
}

/** A seeded visit the hospital-intake tab can log (GET /api/visit-templates). */
export interface VisitTemplate {
  id: string;
  /** e.g. "Emergency visit, sprained wrist". */
  label: string;
  hospitalId: string;
  category: ExpenseCategory;
  /** Untrusted text. */
  description: string;
  lineItems: LineItem[];
  totalCents: Cents;
}

export interface Visit {
  id: string;
  patient: PatientSummary;
  /** The hospital that logged the visit; approval pays it. */
  hospital: Provider;
  /** ISO date YYYY-MM-DD. */
  date: string;
  category: ExpenseCategory;
  /** Untrusted text. */
  description: string;
  lineItems: LineItem[];
  totalCents: Cents;
  /** Label of the hospital device that logged it ("hospital-attested"). */
  attestedBy: string;
  createdAt: string;
}

/** What a Grant carries about its visit. */
export interface VisitSummary {
  id: string;
  hospital: Provider;
  date: string;
  category: ExpenseCategory;
  description: string;
  totalCents: Cents;
}

// ---------------------------------------------------------------------------
// The bill ledger (SPEC §8 "Bill events")

export const BILL_EVENT_TYPES = [
  "charge",
  "insurance_adjustment",
  "hospital_assistance",
  "fund_grant",
  "patient_payment",
] as const;
export type BillEventType = (typeof BILL_EVENT_TYPES)[number];

export type BillEventStatus = "pending" | "confirmed";

export type BillEventSourceKind = "hospital" | "insurer" | "policy" | "fund" | "patient";

export interface BillEvent {
  id: string;
  type: BillEventType;
  /** Always positive. A charge adds to the bill; every other type reduces it. */
  amountCents: Cents;
  source: { kind: BillEventSourceKind; label: string; id: string | null };
  /** Only confirmed events count toward the remaining balance. */
  status: BillEventStatus;
  /** True for simulated decisions (insurance, hospital policies). Always show the label. */
  simulated: boolean;
  /** Policy application ID, grant ID or payment ID. */
  reference: string | null;
  /** Patient-facing line, e.g. "Charity care (hospital decision, simulated)". */
  label: string;
  createdAt: string;
}

/** One step of the shrinking bill, for the patient app and the brief. */
export interface BillStep {
  label: string;
  /** Reduction at this step (0 for the opening charge). */
  reductionCents: Cents;
  /** Balance after this step. */
  balanceCents: Cents;
  simulated: boolean;
  status: BillEventStatus;
}

// ---------------------------------------------------------------------------
// Hospital assistance policies (rules evaluated by packages/ai, records in packages/core)

export const POLICY_KINDS = ["charity_care", "self_pay_discount", "catastrophic_cap"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** Hand-written structured rules (SPEC §7.2). Discounts apply to the balance left by earlier policies. */
export type PolicyRules =
  | {
      kind: "charity_care";
      /** Sliding scale, lowest income first: the first tier the patient fits wins. */
      tiers: { maxIncomePctOfPoverty: number; discountPct: number }[];
    }
  | {
      kind: "self_pay_discount";
      discountPct: number;
      /** Applies only when the patient's profile says uninsured. */
      requiresUninsured: true;
    }
  | {
      kind: "catastrophic_cap";
      /** Patient responsibility for this visit is capped at this share of annual household income. */
      capPctOfAnnualIncome: number;
    };

export interface HospitalPolicy {
  id: string;
  hospitalId: string;
  name: string;
  kind: PolicyKind;
  rules: PolicyRules;
  /** Policies run in ascending order; each sees the balance the previous ones left. */
  applyOrder: number;
  /** Where the (fictional) rule comes from, shown to reviewers. */
  source: string;
  /** ISO date the rule was last reviewed. */
  reviewedOn: string;
  /** Always true in the demo; shown as a label. */
  fictional: boolean;
}

export interface PolicyCriterion {
  key: string;
  label: string;
  /** Null when the needed profile field is unknown. */
  met: boolean | null;
  /** e.g. "Income is 138% of the poverty guideline (limit 200%)". */
  detail: string;
}

/** Input to the pure policy evaluator. No names or free text. */
export interface PolicyEvaluationInput {
  policy: HospitalPolicy;
  profile: PatientProfile;
  /** Monthly income estimated from Nessie deposits, when available. */
  depositIncomeCents: Cents | null;
  /** Balance this policy acts on (after insurance and earlier policies). */
  balanceCents: Cents;
  /** The visit's total charges. */
  chargesCents: Cents;
}

export interface PolicyEvaluation {
  policyId: string;
  eligible: boolean;
  criteria: PolicyCriterion[];
  /** Profile fields that were unknown, e.g. ["household size"]. */
  missing: string[];
  /** 0 when not eligible. Never more than balanceCents. */
  reductionCents: Cents;
  /** One plain sentence. */
  reason: string;
}

/** Status of an application to a hospital policy. Submission and decision are always simulated. */
export const POLICY_APPLICATION_STATUSES = [
  "prepared",
  "submitted_simulated",
  "approved_simulated",
  "denied_simulated",
] as const;
export type PolicyApplicationStatus = (typeof POLICY_APPLICATION_STATUSES)[number];

export interface PolicyApplication {
  id: string;
  visitId: string;
  policy: HospitalPolicy;
  evaluation: PolicyEvaluation;
  /** Application text prepared from the profile. */
  applicationText: string;
  textSource: "gemini" | "template";
  status: PolicyApplicationStatus;
  /** Approved reduction (0 when denied). */
  reductionCents: Cents;
  decidedAt: string | null;
}

/** Input for the application text. Only what the form needs. */
export interface ApplicationTextInput {
  policy: HospitalPolicy;
  evaluation: PolicyEvaluation;
  profile: PatientProfile;
  hospitalName: string;
  visitDate: string;
  category: ExpenseCategory;
  balanceCents: Cents;
}

export interface ApplicationText {
  text: string;
  source: "gemini" | "template";
  model: string | null;
}

// ---------------------------------------------------------------------------
// The bill as the patient app and the admin panel see it

export interface Bill {
  visit: Visit;
  plan: InsurancePlan | null;
  /** Null for uninsured patients. */
  insurance: InsuranceAdjudication | null;
  /** In posting order. */
  events: BillEvent[];
  /** In policy apply order. */
  applications: PolicyApplication[];
  /** Charged → after insurance → after each policy → after the fund → remaining. */
  steps: BillStep[];
  chargesCents: Cents;
  insurerPaidCents: Cents;
  hospitalAssistanceCents: Cents;
  fundPaidCents: Cents;
  patientPaidCents: Cents;
  /** Charges − confirmed reductions and payments, never below 0. */
  remainingCents: Cents;
  /** Reductions that are pending (e.g. a grant whose payout hasn't confirmed). Not subtracted. */
  pendingCents: Cents;
  /** Set when the visit text looks like instructions aimed at the system. Changes nothing. */
  suspiciousContent: SuspiciousContent | null;
}

// ---------------------------------------------------------------------------
// The decision brief (SPEC §7.4)

export interface BriefFlag {
  kind: "suspicious_content" | "income_mismatch" | "unknown_factor";
  detail: string;
}

export interface DecisionBrief {
  grantId: string;
  /** The bill's path: charged → insurance → each policy → remaining. */
  path: BillStep[];
  /** 2–3 sentences built only from the factor values. */
  reasons: string[];
  flags: BriefFlag[];
  /** Always "approve" in revision 6: the default is the full remaining balance. */
  suggestedAction: "approve";
  suggestedCents: Cents;
  /** True when suggestedCents is above SECOND_APPROVAL_ABOVE_CENTS. */
  needsSecondApproval: boolean;
  source: "gemini" | "template";
  model: string | null;
  /** True when every number in the brief matched the case data (always true for templates). */
  checked: boolean;
  computedAt: string;
}

/** What the brief writer sees. Anonymous: no names, IDs or free text other than flagged excerpts. */
export interface BriefInput {
  path: BillStep[];
  remainingCents: Cents;
  assessment: NeedAssessment;
  factors: NeedFactor[];
  /** 1-based position in formula order, and the queue length. */
  rank: number;
  queueLength: number;
  daysWaiting: number;
  suspiciousContent: SuspiciousContent | null;
  secondApprovalAboveCents: Cents;
}

export type BriefDraft = Omit<DecisionBrief, "grantId" | "computedAt">;

/** What the patient explanation sees. */
export interface BillExplanationInput {
  hospitalName: string;
  category: ExpenseCategory;
  lineItems: LineItem[];
  steps: BillStep[];
  remainingCents: Cents;
}

/**
 * Implemented by @abdulcare/ai for revision 6. Core never calls Gemini itself; route handlers pass
 * an engine in. Every async method falls back to rules or a template, so none of them throw on a
 * model failure.
 * - evaluatePolicy: pure and synchronous; same input, same output.
 * - writeApplication: Gemini may rewrite the template, but never adds amounts, fields or claims.
 * - writeBrief: every number must match BriefInput, else the template brief.
 * - explainBill: plain language for the patient, only from the case data.
 */
export interface BillEngine {
  evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluation;
  writeApplication(input: ApplicationTextInput): Promise<ApplicationText>;
  writeBrief(input: BriefInput): Promise<BriefDraft>;
  explainBill(input: BillExplanationInput): Promise<Explanation>;
}

/** Everything the admin panel's case screen shows (SPEC §4 screen 7). */
export interface CaseDetail {
  bill: Bill;
  brief: DecisionBrief | null;
  profile: PatientProfile;
  assessment: NeedAssessment | null;
  /** 1-based formula position among pending requests; null once decided. */
  rank: number | null;
}
