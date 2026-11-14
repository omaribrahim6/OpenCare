// Hospital assistance policies (SPEC §7.2). Pure, deterministic rule evaluation: the model never
// decides a reduction. The hospital's approval is simulated by these same rules (eligible means
// "approved_simulated"), and every policy is fictional and labeled.
//
// Inputs are structured profile fields only. Visit text never reaches this file.

import type {
  HospitalPolicy,
  PatientProfile,
  PolicyApplicationStatus,
  PolicyCriterion,
  PolicyEvaluation,
  PolicyEvaluationInput,
} from "@abdulcare/contracts";
import { povertyLineCents } from "../formula";
import { usd } from "../json";
import { safePolicyName } from "./templates";

const validCents = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const validSize = (x: number | null | undefined): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 20;
const pct = (x: number) => Math.min(100, Math.max(0, Number.isFinite(x) ? x : 0));

/** Monthly income used by the policies: the profile first, then the deposit estimate. */
function monthlyIncome(profile: PatientProfile, depositIncomeCents: number | null): { cents: number; fromDeposits: boolean } | null {
  if (validCents(profile.monthlyIncomeCents)) return { cents: profile.monthlyIncomeCents, fromDeposits: false };
  if (validCents(depositIncomeCents)) return { cents: depositIncomeCents, fromDeposits: true };
  return null;
}

/** Income as a whole-number percentage of the HHS poverty guideline (same table as need-v1). */
export function incomePctOfPoverty(profile: PatientProfile, depositIncomeCents: number | null): number | null {
  const income = monthlyIncome(profile, depositIncomeCents);
  if (income === null || !validSize(profile.householdSize)) return null;
  return Math.round(((income.cents * 12) / povertyLineCents(profile.householdSize)) * 100);
}

function missingIncome(profile: PatientProfile, depositIncomeCents: number | null, needSize: boolean): string[] {
  const missing: string[] = [];
  if (needSize && !validSize(profile.householdSize)) missing.push("household size");
  if (monthlyIncome(profile, depositIncomeCents) === null) missing.push("household income");
  return missing;
}

/** Evaluate one policy against the balance left by insurance and earlier policies. */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const { policy, profile, depositIncomeCents } = input;
  const balance = validCents(input.balanceCents) ? Math.round(input.balanceCents) : 0;
  const rules = policy.rules;
  const criteria: PolicyCriterion[] = [];
  let missing: string[] = [];
  let reduction = 0;

  if (rules.kind === "charity_care") {
    // Sliding scale: lowest income band first, and the first band the patient fits wins.
    const tiers = [...rules.tiers]
      .filter((t) => Number.isFinite(t.maxIncomePctOfPoverty))
      .sort((a, b) => a.maxIncomePctOfPoverty - b.maxIncomePctOfPoverty);
    const limit = tiers.length ? tiers[tiers.length - 1].maxIncomePctOfPoverty : 0;
    const p = incomePctOfPoverty(profile, depositIncomeCents);
    const fromDeposits = monthlyIncome(profile, depositIncomeCents)?.fromDeposits ?? false;
    const tier = p === null ? undefined : tiers.find((t) => p <= t.maxIncomePctOfPoverty);
    if (p === null) missing = missingIncome(profile, depositIncomeCents, true);
    criteria.push({
      key: "income",
      label: `Income at or below ${limit}% of the poverty guideline`,
      met: p === null ? null : tier !== undefined,
      detail:
        p === null
          ? `Can't check: ${missing.join(" and ")} unknown`
          : `Income is ${p}% of the poverty guideline for a household of ${profile.householdSize}${fromDeposits ? " (estimated from deposits)" : ""}; limit ${limit}%`,
    });
    if (tier) {
      const discount = pct(tier.discountPct);
      criteria.push({
        key: "discount",
        label: "Sliding-scale discount",
        met: true,
        detail: `${discount}% off for income up to ${tier.maxIncomePctOfPoverty}% of the poverty guideline`,
      });
      reduction = Math.round((balance * discount) / 100);
    }
  } else if (rules.kind === "self_pay_discount") {
    const ins = profile.insurance;
    if (ins === null || ins === undefined) missing = ["insurance status"];
    criteria.push({
      key: "uninsured",
      label: "Patient is uninsured (self-pay)",
      met: ins == null ? null : ins === "uninsured",
      detail: ins == null ? "Can't check: insurance status unknown" : `Insurance on file: ${ins}`,
    });
    if (ins === "uninsured") reduction = Math.round((balance * pct(rules.discountPct)) / 100);
  } else if (rules.kind === "catastrophic_cap") {
    const income = monthlyIncome(profile, depositIncomeCents);
    const capPct = pct(rules.capPctOfAnnualIncome);
    if (income === null) missing = ["household income"];
    const cap = income === null ? null : Math.round((income.cents * 12 * capPct) / 100);
    criteria.push({
      key: "cap",
      label: `Balance above ${capPct}% of yearly household income`,
      met: cap === null ? null : balance > cap,
      detail:
        cap === null
          ? "Can't check: household income unknown"
          : `Cap is ${usd(cap)} (${capPct}% of ${usd(income!.cents * 12)} a year${income!.fromDeposits ? ", estimated from deposits" : ""}); balance is ${usd(balance)}`,
    });
    if (cap !== null && balance > cap) reduction = balance - cap;
  }

  reduction = Math.min(Math.max(0, reduction), balance);
  const eligible = reduction > 0;
  // Policy text is untrusted: the amounts come only from the structured rules above.
  const name = safePolicyName(policy.name);
  return {
    policyId: policy.id,
    eligible,
    criteria,
    missing,
    reductionCents: reduction,
    reason: eligible
      ? `${name} takes ${usd(reduction)} off the remaining ${usd(balance)}.`
      : missing.length
        ? `${name} can't be decided yet: ${missing.join(" and ")} unknown.`
        : balance === 0
          ? `${name} isn't needed: nothing is left to pay.`
          : `${name} doesn't apply to this patient.`,
  };
}

/** The hospital's decision, simulated by the rules (always labeled "hospital decision (simulated)"). */
export function simulatedDecision(evaluation: PolicyEvaluation): Extract<PolicyApplicationStatus, "approved_simulated" | "denied_simulated"> {
  return evaluation.eligible ? "approved_simulated" : "denied_simulated";
}

export interface PolicyStep {
  policy: HospitalPolicy;
  evaluation: PolicyEvaluation;
  balanceBeforeCents: number;
  balanceAfterCents: number;
}

/**
 * Run every policy in apply order, each on the balance the previous ones left, so nothing is
 * double-counted. Core keeps the ledger; this is the same arithmetic for tests and previews.
 */
export function applyPolicies(
  policies: HospitalPolicy[],
  base: Omit<PolicyEvaluationInput, "policy" | "balanceCents">,
  afterInsuranceCents: number,
): PolicyStep[] {
  let balance = afterInsuranceCents;
  return [...policies]
    .sort((a, b) => a.applyOrder - b.applyOrder)
    .map((policy) => {
      const evaluation = evaluatePolicy({ ...base, policy, balanceCents: balance });
      const step = { policy, evaluation, balanceBeforeCents: balance, balanceAfterCents: balance - evaluation.reductionCents };
      balance = step.balanceAfterCents;
      return step;
    });
}
