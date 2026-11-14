// Deterministic templates for revision 6 (SPEC §7.2, §7.4, §7.5). They are the default output
// and the fallback for every Gemini step, so they must always be true to the case data. Gemini
// may only rewrite their wording (./live.ts), never their numbers.

import type {
  ApplicationText,
  ApplicationTextInput,
  BillExplanationInput,
  BriefDraft,
  BriefFlag,
  BriefInput,
  ExpenseCategory,
  Explanation,
} from "@abdulcare/contracts";
import { usd } from "../json";
import { cleanUntrusted, detectInjection } from "../sanitize";

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  pharmacy: "pharmacy",
  emergency: "emergency",
  hospital: "hospital",
  primary_care: "primary care",
  dental_vision: "dental or vision",
  other_medical: "medical",
};

export const SIMULATED_FOOTER = "Prepared from the patient's TrumpCare profile. Submission and the hospital's decision are simulated.";

export const BILL_DISCLAIMER =
  "Prototype with fictional data. Insurance and hospital decisions shown here are simulated. This is not medical, legal or financial advice.";

const FIELD_LABELS: Record<string, string> = {
  hardship_note: "hardship note",
  merchant: "merchant name",
  description: "visit description",
  policy_text: "hospital policy text",
};

/** Untrusted visit text, shown only when it doesn't look like an instruction. */
export function safeText(text: string, fallback: string, max = 80): string {
  const clean = cleanUntrusted(text, max);
  return clean && detectInjection(clean).length === 0 ? clean : fallback;
}

/** Policy text is untrusted too (SPEC §7): a flagged name or source is never shown or sent. */
export function safePolicyName(name: string): string {
  return safeText(name, "this hospital policy", 120);
}
export function safePolicySource(source: string): string {
  return safeText(source, "withheld: the source text was flagged for review", 200);
}

// ---------------------------------------------------------------------------
// Application text (one per hospital policy)

export function applicationTemplate(input: ApplicationTextInput): ApplicationText {
  const p = input.profile;
  const e = input.evaluation;
  const lines = [
    `Application for ${safePolicyName(input.policy.name)} at ${safeText(input.hospitalName, "the hospital", 120)}`,
    `Visit: ${input.visitDate}, ${CATEGORY_LABELS[input.category]} care`,
    `Balance this application asks about: ${usd(input.balanceCents)}`,
    "",
    "Applicant information (from the TrumpCare profile):",
    `- Household size: ${p.householdSize ?? "not on file"}`,
    `- Monthly household income: ${p.monthlyIncomeCents == null ? "not on file" : usd(p.monthlyIncomeCents)}`,
    `- Insurance: ${p.insurance ?? "not on file"}`,
    "",
    "Policy criteria:",
    ...e.criteria.map((c) => `- ${c.label}: ${c.met === null ? "unknown" : c.met ? "met" : "not met"}. ${c.detail}.`),
    ...(e.missing.length ? ["", `Missing information: ${e.missing.join(", ")}.`] : []),
    "",
    `Requested reduction under the policy rules: ${usd(e.reductionCents)}.`,
    `Policy source: ${safePolicySource(input.policy.source)} (reviewed ${input.policy.reviewedOn}).`,
    SIMULATED_FOOTER,
  ];
  return { text: lines.join("\n"), source: "template", model: null };
}

// ---------------------------------------------------------------------------
// Decision brief (admin panel)

/** Flags are always computed in code, never by the model. */
export function briefFlags(input: BriefInput): BriefFlag[] {
  const flags: BriefFlag[] = [];
  if (input.suspiciousContent) {
    const where = FIELD_LABELS[input.suspiciousContent.field] ?? input.suspiciousContent.field;
    flags.push({
      kind: "suspicious_content",
      detail: `The ${where} contains text that looks like instructions to the system ("${cleanUntrusted(input.suspiciousContent.excerpt, 160)}"). It was ignored and changed nothing.`,
    });
  }
  const m = input.assessment.incomeMismatch;
  if (m) {
    flags.push({
      kind: "income_mismatch",
      detail: `Profile income is ${usd(m.profileCents)} a month but deposits suggest ${usd(m.depositCents)} a month. The profile value was scored.`,
    });
  }
  for (const f of input.factors.filter((x) => x.unknown)) {
    flags.push({ kind: "unknown_factor", detail: `${f.label} is unknown, so it was scored at the midpoint.` });
  }
  return flags;
}

/** Reviewers approve whole dollars, so the suggestion is the remaining balance rounded down to a dollar. */
export function suggestedCents(remainingCents: number): number {
  return Math.max(0, Math.floor(remainingCents / 100) * 100);
}

export function briefReasonsTemplate(input: BriefInput): string[] {
  const top = [...input.factors]
    .filter((f) => f.points > 0 && !f.unknown)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2);
  const prior = input.factors.find((f) => f.key === "prior_support");
  return [
    `Need score ${Math.round(input.assessment.score)}, position ${input.rank} of ${input.queueLength} in formula order.`,
    top.length
      ? `Largest factors: ${top.map((f) => `${f.label.toLowerCase()} (${f.input})`).join(" and ")}.`
      : "No single factor stands out.",
    `${usd(input.remainingCents)} is left after insurance and hospital assistance; waiting ${input.daysWaiting} ${input.daysWaiting === 1 ? "day" : "days"}${prior && prior.points < 0 ? `; ${prior.input.toLowerCase()}` : ""}.`,
  ];
}

export function briefTemplate(input: BriefInput): BriefDraft {
  const cents = suggestedCents(input.remainingCents);
  return {
    path: input.path,
    reasons: briefReasonsTemplate(input),
    flags: briefFlags(input),
    suggestedAction: "approve",
    suggestedCents: cents,
    needsSecondApproval: cents > input.secondApprovalAboveCents,
    source: "template",
    model: null,
    checked: true,
  };
}

// ---------------------------------------------------------------------------
// Patient explanation (kiosk bill page)

/** One point per step after the opening charge. Always from code, so the numbers are exact. */
export function stepPoints(input: BillExplanationInput): string[] {
  return input.steps.slice(1).map((s) => {
    const tag = [s.simulated ? "simulated" : "", s.status === "pending" ? "pending" : ""].filter(Boolean).join(", ");
    return `${s.label}: ${usd(s.reductionCents)} off, leaving ${usd(s.balanceCents)}${tag ? ` (${tag})` : ""}.`;
  });
}

export function chargesLine(input: BillExplanationInput): string {
  const items = input.lineItems.slice(0, 8).map((li) => `${safeText(li.description, "Other charge")} (${usd(li.cents)})`);
  return items.length ? `Charges: ${items.join("; ")}.` : "";
}

export const BILL_QUESTIONS = ["Can I get an itemized copy of this bill?", "Is a payment plan available for what's left?"];

export function explanationTemplate(input: BillExplanationInput): Explanation {
  const charged = input.steps[0]?.balanceCents ?? input.lineItems.reduce((s, li) => s + li.cents, 0);
  const hospital = safeText(input.hospitalName, "the hospital");
  const left =
    input.remainingCents > 0
      ? `${usd(input.remainingCents)} is left. You can ask the community care fund to help with it.`
      : "Nothing is left to pay.";
  return {
    summary: `Your ${CATEGORY_LABELS[input.category]} visit at ${hospital} was charged ${usd(charged)}. ${left}`,
    points: [chargesLine(input), ...stepPoints(input)].filter(Boolean),
    questionsToAsk: BILL_QUESTIONS,
    disclaimer: BILL_DISCLAIMER,
    fallback: true,
  };
}
