// Triage insight for a case (classification, urgency, a short reading and a suggested next step),
// computed by rules from the case data. No model call, so the queue stays fast and every pending
// request gets one. Advice only: it never changes a score, an order or an amount (SPEC §7).
// The visit description is used only to label the kind of care, never to score anyone.

import type { Bill, CaseInsight, NeedAssessment, PatientProfile, SuspiciousContent } from "@abdulcare/contracts";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CARE_LABELS: [RegExp, string][] = [
  [/burn|fire|smoke|electrical/i, "Burn and fire injury"],
  [/neonatal|premature|nicu/i, "Neonatal intensive care"],
  [/spinal|spine|brain|craniotomy|stroke|concussion/i, "Neurological"],
  [/gunshot|stab/i, "Penetrating trauma"],
  [/crash|collision|fall|fracture|crush|amputation|accident|injury|bite/i, "Injury and trauma"],
  [/heart|cardiac|stent/i, "Cardiac emergency"],
  [/drown|pediatric|child|playground/i, "Pediatric"],
  [/appendi|surgery|surgical/i, "Emergency surgery"],
];

export interface TriageInput {
  bill: Bill;
  remainingCents: number;
  assessment: NeedAssessment;
  profile: PatientProfile;
  suspicious: SuspiciousContent | null;
  priorPaidCount90d: number;
  employment?: string | null;
}

export function triageCase(input: TriageInput): CaseInsight {
  const { bill, assessment, profile, remainingCents } = input;
  const labels: string[] = [];
  const text = `${bill.visit.description} ${bill.visit.lineItems.map((li) => li.description).join(" ")}`;
  for (const [pattern, label] of CARE_LABELS) if (pattern.test(text) && labels.length < 2) labels.push(label);
  if (!labels.length) labels.push(bill.visit.category === "emergency" ? "Emergency care" : "Hospital care");

  const pct = assessment.incomePctOfPoverty;
  if (profile.insurance === "uninsured") labels.push("Uninsured");
  else if (profile.insurance === "underinsured") labels.push("Underinsured");
  if (pct != null) labels.push(pct < 150 ? "Very low income" : pct < 250 ? "Low income" : pct < 400 ? "Moderate income" : "Higher income");
  const monthly = profile.monthlyIncomeCents;
  const months = monthly && monthly > 0 ? remainingCents / monthly : null;
  if (months != null && months >= 12) labels.push("Catastrophic cost");
  if (bill.chargesCents >= 25_000_000) labels.push("Six-figure bill");
  if (input.priorPaidCount90d > 0) labels.push("Repeat support");
  if (assessment.incomeMismatch) labels.push("Income mismatch");
  if (input.suspicious) labels.push("Suspicious text");

  const score = Math.round(assessment.score);
  const urgency: CaseInsight["urgency"] =
    score >= 80 || (months != null && months >= 24) ? "critical" : score >= 65 ? "high" : score >= 45 ? "moderate" : "low";

  const who = [
    profile.householdSize ? `household of ${profile.householdSize}` : "household of unknown size",
    pct != null ? `at ${pct}% of the poverty guideline` : "with unknown income",
    profile.insurance ? `(${profile.insurance})` : "",
  ].filter(Boolean).join(" ");
  const covered = bill.insurerPaidCents + bill.hospitalAssistanceCents;
  const summary =
    `${labels[0]} at ${bill.visit.hospital.name}: ${usd(bill.chargesCents)} charged, ${usd(covered)} covered by insurance and hospital assistance, ` +
    `${usd(remainingCents)} left for a ${who}` +
    (months != null ? `, about ${months >= 10 ? Math.round(months) : months.toFixed(1)} months of household income.` : ".");

  const considerations: string[] = [];
  const top = [...assessment.factors].filter((f) => f.maxPoints > 0).sort((a, b) => b.points / b.maxPoints - a.points / a.maxPoints).slice(0, 2);
  if (top.length) considerations.push(`Strongest need factors: ${top.map((f) => `${f.label.toLowerCase()} (${f.input})`).join("; ")}.`);
  if (bill.insurerPaidCents === 0 && profile.insurance !== "uninsured" && bill.plan) {
    considerations.push("The plan paid nothing on this visit (deductible not met or benefit limit).");
  }
  if (bill.hospitalAssistanceCents === 0) considerations.push("No hospital assistance policy applied to this bill.");
  if (input.employment) considerations.push(`Work situation on file: ${input.employment}.`);
  if (input.priorPaidCount90d > 0) considerations.push(`The fund already paid ${input.priorPaidCount90d} grant(s) for this patient in the last 90 days; check for duplicates.`);
  if (assessment.incomeMismatch) {
    considerations.push(`Reported income ${usd(assessment.incomeMismatch.profileCents)}/mo vs deposits ${usd(assessment.incomeMismatch.depositCents)}/mo.`);
  }
  if (input.suspicious) considerations.push(`The ${input.suspicious.field.replace("_", " ")} contains instructions aimed at the review system; they were ignored.`);

  let recommendation: CaseInsight["recommendation"] = "approve_full";
  let recommendationText = `Approve the full remaining balance of ${usd(remainingCents)}; nothing in the case data argues against it.`;
  if (input.suspicious) {
    recommendation = "review_carefully";
    recommendationText = "Confirm the itemized charges with the hospital before paying; the record contains text aimed at the review system.";
  } else if (assessment.incomeMismatch) {
    recommendation = "verify_first";
    recommendationText = "Verify income before approving: the profile and 90 days of deposits disagree.";
  } else if (pct != null && pct >= 600) {
    recommendation = "likely_decline";
    recommendationText = `Household income is ${pct}% of the poverty guideline; a hospital payment plan may fit better than a grant.`;
  } else if (input.priorPaidCount90d > 0) {
    recommendation = "verify_first";
    recommendationText = "Check this isn't a duplicate of the recent grant before approving.";
  }

  return { labels, urgency, summary, considerations, recommendation, recommendationText, source: "rules" };
}
