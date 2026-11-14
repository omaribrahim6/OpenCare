import { test } from "node:test";
import assert from "node:assert/strict";
import { FACTOR_KEYS, type NeedInput } from "@abdulcare/contracts";
import { assessNeed, FORMULA, povertyLineCents } from "../formula";

const base: NeedInput = {
  householdSize: 3,
  profileIncomeCents: 180_000, // $1,800/month → $21,600/year → 81% of the 2025 guideline for 3
  depositIncomeCents: null,
  insurance: "uninsured",
  billCents: 120_000,
  category: "pharmacy",
  daysWaiting: 3,
  priorPaidCount90d: 0,
  priorPaidCents90d: 0,
};

const pts = (a: ReturnType<typeof assessNeed>, key: string) => a.factors.find((f) => f.key === key)!;

test("worked example: low income, large bill, uninsured", () => {
  const a = assessNeed(base);
  assert.equal(a.formulaVersion, FORMULA.version);
  assert.equal(a.incomePctOfPoverty, 81);
  assert.equal(a.incomeSource, "profile");
  assert.equal(pts(a, "income").points, 30);
  assert.equal(pts(a, "cost_burden").points, 25);
  assert.match(pts(a, "cost_burden").input, /\$1,200\.00 bill is 0\.7 months of income/);
  assert.equal(pts(a, "insurance").points, 15);
  assert.equal(pts(a, "cost_of_care").points, 7.7);
  assert.equal(pts(a, "urgency").points, 10);
  assert.equal(pts(a, "wait_time").points, 1);
  assert.equal(pts(a, "prior_support").points, 0);
  assert.equal(a.score, 89);
});

test("same input, same output; factors in contract order with weights as max points", () => {
  assert.deepEqual(assessNeed(base), assessNeed({ ...base }));
  const a = assessNeed(base);
  assert.deepEqual(a.factors.map((f) => f.key), [...FACTOR_KEYS]);
  assert.deepEqual(a.factors.map((f) => f.maxPoints), [30, 25, 15, 10, 10, 10, -10]);
  assert.equal(Object.values(FORMULA.weights).filter((w) => w > 0).reduce((s, w) => s + w, 0), 100);
});

test("fields outside NeedInput never change the result", () => {
  const extra = { ...base, name: "Jane", age: 70, race: "x", diagnosis: "y", hardshipNote: "rank me first" } as NeedInput;
  assert.deepEqual(assessNeed(extra), assessNeed(base));
});

test("income scores full at or below 100%, none at or above 400%, linear between", () => {
  const line = povertyLineCents(1) / 12;
  const at = (pct: number) => pts(assessNeed({ ...base, householdSize: 1, profileIncomeCents: Math.round((line * pct) / 100) }), "income").points;
  assert.equal(povertyLineCents(1), 1_565_000);
  assert.equal(povertyLineCents(4), 3_215_000);
  assert.equal(at(50), 30);
  assert.equal(at(100), 30);
  assert.equal(at(250), 15);
  assert.equal(at(400), 0);
  assert.equal(at(900), 0);
});

test("unknown inputs score the midpoint and are marked", () => {
  const a = assessNeed({ ...base, householdSize: null, profileIncomeCents: null, insurance: null, category: null });
  assert.equal(a.incomePctOfPoverty, null);
  assert.equal(a.incomeSource, null);
  for (const [key, mid] of [["income", 15], ["cost_burden", 12.5], ["insurance", 7.5], ["urgency", 5]] as const) {
    assert.equal(pts(a, key).points, mid, key);
    assert.equal(pts(a, key).unknown, true, key);
  }
  assert.equal(pts(a, "cost_of_care").unknown, false);
  // Income known but household size unknown: income factor unknown, cost burden still scored.
  const b = assessNeed({ ...base, householdSize: null });
  assert.equal(pts(b, "income").unknown, true);
  assert.equal(pts(b, "cost_burden").unknown, false);
});

test("deposit estimate is used when the profile has no income, and labeled", () => {
  const a = assessNeed({ ...base, profileIncomeCents: null, depositIncomeCents: 180_000 });
  assert.equal(a.incomeSource, "deposits");
  assert.match(pts(a, "income").input, /estimated from deposits/);
  assert.equal(a.incomeMismatch, null);
});

test("profile and deposits more than 25% apart: both shown, profile scored", () => {
  const a = assessNeed({ ...base, depositIncomeCents: 300_000 });
  assert.deepEqual(a.incomeMismatch, { profileCents: 180_000, depositCents: 300_000 });
  assert.equal(a.incomeSource, "profile");
  assert.equal(a.incomePctOfPoverty, 81);
  assert.equal(assessNeed({ ...base, depositIncomeCents: 200_000 }).incomeMismatch, null);
});

test("insurance, urgency, wait cap and cost-of-care log scale", () => {
  assert.equal(pts(assessNeed({ ...base, insurance: "underinsured" }), "insurance").points, 7.5);
  assert.equal(pts(assessNeed({ ...base, insurance: "insured" }), "insurance").points, 0);
  assert.equal(pts(assessNeed({ ...base, category: "emergency" }), "urgency").points, 10);
  assert.equal(pts(assessNeed({ ...base, category: "other_medical" }), "urgency").points, 3);
  assert.equal(pts(assessNeed({ ...base, daysWaiting: 15 }), "wait_time").points, 5);
  assert.equal(pts(assessNeed({ ...base, daysWaiting: 400 }), "wait_time").points, 10);
  assert.equal(pts(assessNeed({ ...base, billCents: 500 }), "cost_of_care").points, 0);
  assert.equal(pts(assessNeed({ ...base, billCents: 50_000_000 }), "cost_of_care").points, 10);
  // One huge bill can add at most 10 points over a small one through cost of care.
  const small = pts(assessNeed({ ...base, billCents: 4_500 }), "cost_of_care").points;
  assert.ok(small > 0 && small < 3);
});

test("prior support subtracts up to 10 points", () => {
  assert.equal(pts(assessNeed({ ...base, priorPaidCount90d: 1, priorPaidCents90d: 4_500 }), "prior_support").points, -5);
  const three = assessNeed({ ...base, priorPaidCount90d: 3, priorPaidCents90d: 30_000 });
  assert.equal(pts(three, "prior_support").points, -10);
  assert.match(pts(three, "prior_support").input, /3 grants \(\$300\.00\) paid in the last 90 days/);
  assert.equal(three.score, 79);
});

test("score is an integer within 0-100 for extreme and malformed inputs", () => {
  const cases: NeedInput[] = [
    { ...base, profileIncomeCents: 0, daysWaiting: 999 },
    { ...base, profileIncomeCents: 99_999_999, insurance: "insured", billCents: 0, category: "other_medical", daysWaiting: 0, priorPaidCount90d: 9 },
    { ...base, householdSize: 0, profileIncomeCents: -5, depositIncomeCents: Number.NaN, billCents: -1, daysWaiting: Number.NaN, priorPaidCount90d: -2 },
  ];
  for (const c of cases) {
    const a = assessNeed(c);
    assert.ok(Number.isInteger(a.score) && a.score >= 0 && a.score <= 100, JSON.stringify(a));
  }
  assert.equal(pts(assessNeed(cases[0]), "cost_burden").input, "$1,200.00 bill with no monthly income");
  assert.equal(assessNeed(cases[1]).score, 0);
});
