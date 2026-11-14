// Need formula (SPEC §7 job 2). Deterministic and versioned: the same NeedInput always gives
// the same NeedAssessment, and the model never touches it. Only the structured fields in
// NeedInput are used. No names, demographics, diagnoses, bill text or hardship notes.

import type { ExpenseCategory, FactorKey, NeedAssessment, NeedFactor, NeedInput } from "@abdulcare/contracts";
import { usd } from "./json";

/**
 * Everything tunable lives here. Change any value → bump `version`, because every stored
 * assessment records the version it was computed with.
 */
export const FORMULA = {
  version: "need-v1",
  weights: {
    income: 30,
    cost_burden: 25,
    insurance: 15,
    cost_of_care: 10,
    urgency: 10,
    wait_time: 10,
    prior_support: -10,
  } satisfies Record<FactorKey, number>,
  income: { fullAtOrBelowPct: 100, zeroAtOrAbovePct: 400 },
  /** Bill ÷ monthly income at which cost burden scores full points. */
  costBurdenFullRatio: 0.5,
  insurance: { uninsured: 1, underinsured: 0.5, insured: 0 },
  /** Log scale between these bill amounts (cents): none at or below the floor, full at or above the cap. */
  costOfCare: { floorCents: 1_000, capCents: 500_000 },
  /** Share of the urgency weight per category. */
  urgency: {
    emergency: 1,
    pharmacy: 1,
    hospital: 0.8,
    primary_care: 0.6,
    dental_vision: 0.5,
    other_medical: 0.3,
  } satisfies Record<ExpenseCategory, number>,
  /** Wait time grows linearly to full points at this many days. */
  waitCapDays: 30,
  /** Each grant paid in the last 90 days subtracts this share of the prior-support weight. */
  priorSupportPerGrant: 0.5,
  /** Profile and deposit incomes that differ by more than this share are shown side by side. */
  incomeMismatchRatio: 0.25,
  /**
   * HHS poverty guidelines, 48 contiguous states and DC, annual dollars.
   * Source: https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines
   */
  poverty: { year: 2025, firstPersonDollars: 15_650, perExtraPersonDollars: 5_500 },
} as const;

const LABELS: Record<FactorKey, string> = {
  income: "Income",
  cost_burden: "Cost burden",
  insurance: "Insurance",
  cost_of_care: "Cost of care",
  urgency: "Urgency",
  wait_time: "Wait time",
  prior_support: "Prior support",
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  pharmacy: "pharmacy",
  emergency: "emergency care",
  hospital: "hospital",
  primary_care: "primary care",
  dental_vision: "dental or vision",
  other_medical: "other medical",
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Annual poverty guideline for a household, in cents. */
export function povertyLineCents(householdSize: number): number {
  const p = FORMULA.poverty;
  return (p.firstPersonDollars + p.perExtraPersonDollars * Math.max(0, householdSize - 1)) * 100;
}

const validCents = (x: number | null): x is number => x !== null && Number.isFinite(x) && x >= 0;
const validSize = (x: number | null): x is number => x !== null && Number.isInteger(x) && x >= 1 && x <= 20;

function factor(key: FactorKey, share: number | null, input: string): NeedFactor {
  const w = FORMULA.weights[key];
  // Unknown inputs score the midpoint, so missing data neither helps nor hurts.
  const s = share === null ? 0.5 : clamp01(share);
  // `|| 0` turns -0 (prior support with no grants) into 0.
  return { key, label: LABELS[key], input, points: round1(w * s) || 0, maxPoints: w, unknown: share === null };
}

export function assessNeed(input: NeedInput): NeedAssessment {
  const F = FORMULA;

  // Income: profile first, then the deposit estimate.
  const profile = validCents(input.profileIncomeCents) ? input.profileIncomeCents : null;
  const deposits = validCents(input.depositIncomeCents) ? input.depositIncomeCents : null;
  const monthly = profile ?? deposits;
  const incomeSource = profile !== null ? "profile" : deposits !== null ? "deposits" : null;
  const incomeMismatch =
    profile !== null && deposits !== null && Math.abs(profile - deposits) > F.incomeMismatchRatio * Math.max(profile, 1)
      ? { profileCents: profile, depositCents: deposits }
      : null;
  const size = validSize(input.householdSize) ? input.householdSize : null;

  let incomePct: number | null = null;
  let incomeFactor: NeedFactor;
  if (monthly !== null && size !== null) {
    incomePct = Math.round(((monthly * 12) / povertyLineCents(size)) * 100);
    const { fullAtOrBelowPct: lo, zeroAtOrAbovePct: hi } = F.income;
    const estimated = incomeSource === "deposits" ? ", estimated from deposits" : "";
    incomeFactor = factor("income", (hi - incomePct) / (hi - lo), `${incomePct}% of poverty guideline (household of ${size}${estimated})`);
  } else {
    incomeFactor = factor("income", null, monthly === null ? "Income unknown" : "Household size unknown");
  }

  const bill = validCents(input.billCents) ? input.billCents : 0;
  let burden: NeedFactor;
  if (monthly === null) {
    burden = factor("cost_burden", null, "Income unknown");
  } else if (monthly === 0) {
    burden = factor("cost_burden", 1, `${usd(bill)} bill with no monthly income`);
  } else {
    const months = bill / monthly;
    burden = factor("cost_burden", months / F.costBurdenFullRatio, `${usd(bill)} bill is ${round1(months)} months of income`);
  }

  const ins = input.insurance;
  const insurance = factor("insurance", ins === null ? null : F.insurance[ins], ins === null ? "Insurance unknown" : ins.charAt(0).toUpperCase() + ins.slice(1));

  const { floorCents, capCents } = F.costOfCare;
  const care = factor(
    "cost_of_care",
    bill <= floorCents ? 0 : Math.log(bill / floorCents) / Math.log(capCents / floorCents),
    `${usd(bill)} bill`,
  );

  const cat = input.category;
  const urgency = factor("urgency", cat === null ? null : F.urgency[cat], cat === null ? "Category unknown" : `${CATEGORY_LABELS[cat].charAt(0).toUpperCase()}${CATEGORY_LABELS[cat].slice(1)} expense`);

  const days = Number.isFinite(input.daysWaiting) ? Math.max(0, Math.floor(input.daysWaiting)) : 0;
  const wait = factor("wait_time", days / F.waitCapDays, `${days} ${days === 1 ? "day" : "days"} waiting`);

  const count = Number.isInteger(input.priorPaidCount90d) ? Math.max(0, input.priorPaidCount90d) : 0;
  const prior = factor(
    "prior_support",
    count * F.priorSupportPerGrant,
    count === 0
      ? "No grants paid in the last 90 days"
      : `${count} ${count === 1 ? "grant" : "grants"} (${usd(validCents(input.priorPaidCents90d) ? input.priorPaidCents90d : 0)}) paid in the last 90 days`,
  );
  // Prior support is never "unknown" (core always knows the fund's records); it only subtracts.
  prior.unknown = false;

  const factors = [incomeFactor, burden, insurance, care, urgency, wait, prior];
  const total = factors.reduce((sum, f) => sum + f.points, 0);
  return {
    score: Math.round(Math.min(100, Math.max(0, total))),
    formulaVersion: F.version,
    factors,
    incomePctOfPoverty: incomePct,
    incomeSource,
    incomeMismatch,
  };
}
