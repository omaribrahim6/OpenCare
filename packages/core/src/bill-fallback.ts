// A minimal, fully deterministic BillEngine. The real one (rules, Gemini text, number checks) is
// @abdulcare/ai's; route handlers use it when available. This one keeps the pipeline running
// without it, and core's tests use it. It never calls a model.

import type {
  ApplicationText,
  ApplicationTextInput,
  BillEngine,
  BillExplanationInput,
  BriefDraft,
  BriefInput,
  Explanation,
  PolicyCriterion,
  PolicyEvaluation,
  PolicyEvaluationInput,
} from "@abdulcare/contracts";

/** HHS 2025 poverty guideline, 48 states and DC (same numbers as @abdulcare/ai's need-v1). */
export function povertyLineCents(householdSize: number): number {
  return (15_650 + 5_500 * Math.max(0, householdSize - 1)) * 100;
}

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function incomePct(input: PolicyEvaluationInput): number | null {
  const monthly = input.profile.monthlyIncomeCents ?? input.depositIncomeCents;
  const size = input.profile.householdSize;
  if (monthly == null || size == null) return null;
  return Math.round(((monthly * 12) / povertyLineCents(size)) * 100);
}

export function evaluatePolicyFallback(input: PolicyEvaluationInput): PolicyEvaluation {
  const { policy, balanceCents } = input;
  const rules = policy.rules;
  const criteria: PolicyCriterion[] = [];
  const missing: string[] = [];
  let reduction = 0;

  if (rules.kind === "charity_care") {
    const pct = incomePct(input);
    if (pct == null) {
      if (input.profile.householdSize == null) missing.push("household size");
      if (input.profile.monthlyIncomeCents == null && input.depositIncomeCents == null) missing.push("household income");
    }
    const tier = pct == null ? null : rules.tiers.find((t) => pct <= t.maxIncomePctOfPoverty);
    const limit = Math.max(...rules.tiers.map((t) => t.maxIncomePctOfPoverty));
    criteria.push({
      key: "income",
      label: "Income within the sliding scale",
      met: pct == null ? null : tier != null,
      detail: pct == null ? "Income or household size unknown" : `Income is ${pct}% of the poverty guideline (limit ${limit}%)`,
    });
    if (tier) reduction = Math.round((balanceCents * tier.discountPct) / 100);
  } else if (rules.kind === "self_pay_discount") {
    const insurance = input.profile.insurance;
    if (insurance == null) missing.push("insurance status");
    criteria.push({
      key: "uninsured",
      label: "Patient is uninsured (self-pay)",
      met: insurance == null ? null : insurance === "uninsured",
      detail: insurance == null ? "Insurance status unknown" : `Insurance status: ${insurance}`,
    });
    if (insurance === "uninsured") reduction = Math.round((balanceCents * rules.discountPct) / 100);
  } else {
    const monthly = input.profile.monthlyIncomeCents ?? input.depositIncomeCents;
    if (monthly == null) missing.push("household income");
    const cap = monthly == null ? null : Math.round((monthly * 12 * rules.capPctOfAnnualIncome) / 100);
    criteria.push({
      key: "cap",
      label: `Balance above ${rules.capPctOfAnnualIncome}% of annual income`,
      met: cap == null ? null : balanceCents > cap,
      detail: cap == null ? "Income unknown" : `Cap is ${usd(cap)}; balance is ${usd(balanceCents)}`,
    });
    if (cap != null && balanceCents > cap) reduction = balanceCents - cap;
  }

  reduction = Math.min(Math.max(0, reduction), balanceCents);
  const eligible = reduction > 0;
  return {
    policyId: policy.id,
    eligible,
    criteria,
    missing,
    reductionCents: reduction,
    reason: eligible
      ? `${policy.name} takes ${usd(reduction)} off the remaining ${usd(balanceCents)}.`
      : missing.length
        ? `${policy.name} can't be decided: ${missing.join(" and ")} unknown.`
        : `${policy.name} doesn't apply to this patient.`,
  };
}

export function applicationTextFallback(input: ApplicationTextInput): ApplicationText {
  const p = input.profile;
  const lines = [
    `Application: ${input.policy.name} (${input.hospitalName})`,
    `Visit: ${input.visitDate}, ${input.category.replace("_", " ")}`,
    `Balance this application covers: ${usd(input.balanceCents)}`,
    `Household size: ${p.householdSize ?? "unknown"}`,
    `Monthly household income: ${p.monthlyIncomeCents == null ? "unknown" : usd(p.monthlyIncomeCents)}`,
    `Insurance: ${p.insurance ?? "unknown"}`,
    ...input.evaluation.criteria.map((c) => `- ${c.label}: ${c.met == null ? "unknown" : c.met ? "met" : "not met"} (${c.detail})`),
    "Prepared from the patient's OpenCare profile. Submission is simulated.",
  ];
  return { text: lines.join("\n"), source: "template", model: null };
}

export function briefFallback(input: BriefInput): BriefDraft {
  const top = [...input.factors]
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2);
  const reasons = [
    `Need score ${Math.round(input.assessment.score)}, position ${input.rank} of ${input.queueLength} in formula order.`,
    ...(top.length ? [`Largest factors: ${top.map((f) => `${f.label.toLowerCase()} (${f.input})`).join(" and ")}.`] : []),
    `Waiting ${input.daysWaiting} day${input.daysWaiting === 1 ? "" : "s"}.`,
  ];
  const flags: BriefDraft["flags"] = [];
  if (input.suspiciousContent) {
    flags.push({ kind: "suspicious_content", detail: `Instructions found in ${input.suspiciousContent.field.replace("_", " ")}: "${input.suspiciousContent.excerpt}". Ignored.` });
  }
  if (input.assessment.incomeMismatch) {
    const m = input.assessment.incomeMismatch;
    flags.push({ kind: "income_mismatch", detail: `Profile income ${usd(m.profileCents)}/mo vs deposits ${usd(m.depositCents)}/mo.` });
  }
  for (const f of input.factors.filter((f) => f.unknown)) {
    flags.push({ kind: "unknown_factor", detail: `${f.label} unknown (scored at the midpoint).` });
  }
  // Reviewers can approve cents, so the suggestion is the exact remaining balance.
  const suggestedCents = Math.max(0, input.remainingCents);
  return {
    path: input.path,
    reasons,
    flags,
    suggestedAction: "approve",
    suggestedCents,
    needsSecondApproval: false, // one approval is enough at any amount
    source: "template",
    model: null,
    checked: true,
  };
}

export function explainBillFallback(input: BillExplanationInput): Explanation {
  return {
    summary: `Your visit at ${input.hospitalName} was charged ${usd(input.steps[0]?.balanceCents ?? 0)}. After every step so far, ${usd(input.remainingCents)} is left.`,
    points: input.steps.slice(1).map((s) => `${s.label}: ${usd(s.reductionCents)} off, leaving ${usd(s.balanceCents)}${s.simulated ? " (simulated)" : ""}.`),
    questionsToAsk: ["Can I get an itemized copy of this bill?", "Is a payment plan available for what's left?"],
    disclaimer: "Prototype with fictional data. Insurance and hospital decisions shown here are simulated.",
    fallback: true,
  };
}

export const fallbackBillEngine: BillEngine = {
  evaluatePolicy: evaluatePolicyFallback,
  writeApplication: async (input) => applicationTextFallback(input),
  writeBrief: async (input) => briefFallback(input),
  explainBill: async (input) => explainBillFallback(input),
};
