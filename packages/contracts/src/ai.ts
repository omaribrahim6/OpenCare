// AI shapes (SPEC §7, rev 5). The ai lane implements NeedEngine (bottom of this file);
// packages/core calls it and stores the results. All money is integer cents. Unknown is null.

import type { Cents } from "./grants";

export const EXPENSE_CATEGORIES = [
  "pharmacy",
  "emergency",
  "hospital",
  "primary_care",
  "dental_vision",
  "other_medical",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** A patient's insurance as recorded in their profile. Null means unknown. */
export const INSURANCE_STATUSES = ["uninsured", "underinsured", "insured"] as const;
export type InsuranceStatus = (typeof INSURANCE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Bill discovery and the patient explanation

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
  /** Null when not medical or unclear. */
  category: ExpenseCategory | null;
  reason: string;
  basis: "ai" | "rules";
}

/** Plain-language explanation of the selected bill for the patient (SPEC §7 job 4). */
export interface Explanation {
  summary: string;
  points: string[];
  questionsToAsk: string[];
  disclaimer: string;
  /** True when a template was used because the AI was unavailable or failed checks. */
  fallback: boolean;
}

/** Text that looks like instructions aimed at the system (SPEC §7 injection flag). */
export interface SuspiciousContent {
  /** Revision 6: "description" covers the visit description and its line items. */
  field: "merchant" | "description" | "hardship_note";
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Need assessment (SPEC §7 job 2): deterministic, versioned, auditable

export const FACTOR_KEYS = [
  "income",
  "cost_burden",
  "insurance",
  "cost_of_care",
  "urgency",
  "wait_time",
  "prior_support",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

export interface NeedFactor {
  key: FactorKey;
  label: string;
  /** Human-readable input, e.g. "80% of poverty guideline". Never a name or free text. */
  input: string;
  points: number;
  /** Negative for prior support, which subtracts. */
  maxPoints: number;
  /** True when the input was missing and the factor scored its midpoint. */
  unknown: boolean;
}

/** Everything the formula needs. Core gathers it; it holds no names, IDs or free text. */
export interface NeedInput {
  householdSize: number | null;
  /** Monthly household income from the patient's profile. */
  profileIncomeCents: Cents | null;
  /** Monthly income estimated from the last 90 days of Nessie deposits, if available. */
  depositIncomeCents: Cents | null;
  insurance: InsuranceStatus | null;
  /** Revision 6: the bill's remaining balance after insurance and hospital assistance. */
  billCents: Cents;
  /** Revision 6: the visit's category. */
  category: ExpenseCategory | null;
  daysWaiting: number;
  /** Grants paid to this patient by the fund in the last 90 days. */
  priorPaidCount90d: number;
  priorPaidCents90d: Cents;
}

export interface NeedAssessment {
  /** 0–100 formula score. Label it "need score", never "eligibility". */
  score: number;
  formulaVersion: string;
  factors: NeedFactor[];
  incomePctOfPoverty: number | null;
  incomeSource: "profile" | "deposits" | null;
  /** Both incomes, when profile and deposits differ by more than 25%. */
  incomeMismatch: { profileCents: Cents; depositCents: Cents } | null;
}

// ---------------------------------------------------------------------------
// Queue ranking (SPEC §7 job 3): Gemini sets the order, the formula is the guardrail

/** One anonymized pending request, as Gemini sees it. */
export interface RankingRow {
  /** "A", "B", "C"… never a grant or patient ID. */
  label: string;
  score: number;
  factors: NeedFactor[];
  incomePctOfPoverty: number | null;
  billCents: Cents;
  daysWaiting: number;
}

export interface QueueRanking {
  /** "formula" when Gemini failed validation, timed out or errored. */
  source: "gemini" | "formula";
  /** Every label exactly once, highest priority first. */
  order: string[];
  /** Label → 2–3 sentence rationale comparing the request with the others. */
  rationales: Record<string, string>;
  /** Model and prompt version when source is "gemini". */
  model: string | null;
}

/**
 * Implemented by @abdulcare/ai. Core never calls Gemini itself; route handlers pass an engine in.
 * - assessNeed: pure and synchronous; same input, same output.
 * - rankQueue: Gemini with guardrails (permutation, numbers match, timeout); falls back to formula order.
 * - detectSuspicious: flags injected instructions in untrusted text; never affects score or rank.
 */
export interface NeedEngine {
  assessNeed(input: NeedInput): NeedAssessment;
  /** @deprecated Revision 6 retires Gemini ranking: core orders the queue by formula. */
  rankQueue(rows: RankingRow[]): Promise<QueueRanking>;
  detectSuspicious(
    fields: { field: SuspiciousContent["field"]; text: string }[],
  ): Promise<SuspiciousContent | null>;
}
