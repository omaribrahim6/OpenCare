import { test } from "node:test";
import assert from "node:assert/strict";
import type { HospitalPolicy, PatientProfile, PolicyEvaluationInput } from "@abdulcare/contracts";
import { applyPolicies, evaluatePolicy, incomePctOfPoverty, simulatedDecision } from "../bills/policy";

// Same parameters as packages/core/db/seed.ts (Valley General Hospital, fictional).
const POLICIES: HospitalPolicy[] = [
  {
    id: "pol_demo_charity",
    hospitalId: "hosp_demo",
    name: "Charity care",
    kind: "charity_care",
    rules: {
      kind: "charity_care",
      tiers: [
        { maxIncomePctOfPoverty: 200, discountPct: 80 },
        { maxIncomePctOfPoverty: 300, discountPct: 50 },
        { maxIncomePctOfPoverty: 400, discountPct: 25 },
      ],
    },
    applyOrder: 1,
    source: "Valley General Financial Assistance Policy §3, sliding scale (fictional)",
    reviewedOn: "2026-10-01",
    fictional: true,
  },
  {
    id: "pol_demo_selfpay",
    hospitalId: "hosp_demo",
    name: "Uninsured self-pay discount",
    kind: "self_pay_discount",
    rules: { kind: "self_pay_discount", discountPct: 30, requiresUninsured: true },
    applyOrder: 2,
    source: "Valley General Self-Pay Pricing Policy (fictional)",
    reviewedOn: "2026-10-01",
    fictional: true,
  },
  {
    id: "pol_demo_catastrophic",
    name: "Catastrophic cap",
    hospitalId: "hosp_demo",
    kind: "catastrophic_cap",
    rules: { kind: "catastrophic_cap", capPctOfAnnualIncome: 10 },
    applyOrder: 3,
    source: "Valley General Financial Assistance Policy §5, catastrophic expenses (fictional)",
    reviewedOn: "2026-10-01",
    fictional: true,
  },
];
const [charity, selfPay, catastrophic] = POLICIES;

// Jordan Lee (fictional): household of 3, $2,500/month, insured. $4,800 ER visit; insurance
// (core) leaves $2,160: the $1,500 deductible plus 20% of the other $3,300.
const jordan: PatientProfile = { householdSize: 3, monthlyIncomeCents: 250_000, insurance: "insured" };
const base = { profile: jordan, depositIncomeCents: null, chargesCents: 480_000 };
const input = (policy: HospitalPolicy, balanceCents: number, over: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput => ({
  ...base,
  policy,
  balanceCents,
  ...over,
});

test("demo path: $4,800 → $2,160 after insurance → $432 after hospital policies", () => {
  const afterInsurance = 150_000 + Math.round((480_000 - 150_000) * 0.2);
  assert.equal(afterInsurance, 216_000);
  const steps = applyPolicies(POLICIES.slice().reverse(), base, afterInsurance); // order comes from applyOrder
  assert.deepEqual(steps.map((s) => s.policy.id), ["pol_demo_charity", "pol_demo_selfpay", "pol_demo_catastrophic"]);
  assert.deepEqual(steps.map((s) => s.evaluation.reductionCents), [172_800, 0, 0]);
  assert.deepEqual(steps.map((s) => s.balanceAfterCents), [43_200, 43_200, 43_200]);
  assert.deepEqual(steps.map((s) => simulatedDecision(s.evaluation)), ["approved_simulated", "denied_simulated", "denied_simulated"]);
  assert.equal(steps[0].evaluation.reason, "Charity care takes $1,728.00 off the remaining $2,160.00.");
  assert.match(steps[0].evaluation.criteria[0].detail, /113% of the poverty guideline for a household of 3; limit 400%/);
  assert.match(steps[2].evaluation.criteria[0].detail, /Cap is \$3,000\.00 .*balance is \$432\.00/);
});

test("charity care: the first band the patient fits wins, whatever order the tiers are stored in", () => {
  const shuffled: HospitalPolicy = {
    ...charity,
    rules: { kind: "charity_care", tiers: [{ maxIncomePctOfPoverty: 400, discountPct: 25 }, { maxIncomePctOfPoverty: 200, discountPct: 80 }, { maxIncomePctOfPoverty: 300, discountPct: 50 }] },
  };
  assert.equal(evaluatePolicy(input(shuffled, 100_000)).reductionCents, 80_000);
  const at = (monthly: number) => evaluatePolicy(input(charity, 100_000, { profile: { ...jordan, monthlyIncomeCents: monthly } })).reductionCents;
  assert.equal(incomePctOfPoverty({ ...jordan, monthlyIncomeCents: 555_000 }, null), 250);
  assert.equal(at(555_000), 50_000); // 250% → 50%
  assert.equal(at(800_000), 25_000); // 360% → 25%
  const over = evaluatePolicy(input(charity, 100_000, { profile: { ...jordan, monthlyIncomeCents: 1_000_000 } }));
  assert.deepEqual([over.eligible, over.reductionCents, over.criteria[0].met], [false, 0, false]);
  assert.match(over.reason, /doesn't apply/);
});

test("charity care uses the deposit estimate when the profile has no income, and says so", () => {
  const r = evaluatePolicy(input(charity, 100_000, { profile: { ...jordan, monthlyIncomeCents: null }, depositIncomeCents: 250_000 }));
  assert.equal(r.reductionCents, 80_000);
  assert.match(r.criteria[0].detail, /estimated from deposits/);
});

test("unknown profile fields are reported as missing, never guessed", () => {
  const r = evaluatePolicy(input(charity, 100_000, { profile: { householdSize: null, monthlyIncomeCents: null, insurance: null } }));
  assert.deepEqual([r.eligible, r.reductionCents, r.criteria[0].met], [false, 0, null]);
  assert.deepEqual(r.missing, ["household size", "household income"]);
  assert.equal(r.reason, "Charity care can't be decided yet: household size and household income unknown.");
  const s = evaluatePolicy(input(selfPay, 100_000, { profile: { ...jordan, insurance: null } }));
  assert.deepEqual([s.criteria[0].met, s.missing], [null, ["insurance status"]]);
  const c = evaluatePolicy(input(catastrophic, 100_000, { profile: { ...jordan, monthlyIncomeCents: null } }));
  assert.deepEqual([c.criteria[0].met, c.missing], [null, ["household income"]]);
});

test("uninsured patient: charity care, then self-pay on what's left, then the catastrophic cap", () => {
  // Household of 3, $1,800/month (81% of the guideline), uninsured, $3,000 bill.
  const profile: PatientProfile = { householdSize: 3, monthlyIncomeCents: 180_000, insurance: "uninsured" };
  const steps = applyPolicies(POLICIES, { profile, depositIncomeCents: null, chargesCents: 300_000 }, 300_000);
  assert.deepEqual(steps.map((s) => s.evaluation.reductionCents), [240_000, 18_000, 0]);
  assert.deepEqual(steps.map((s) => s.balanceAfterCents), [60_000, 42_000, 42_000]);
});

test("catastrophic cap lowers the balance to 10% of yearly income", () => {
  // $1,000/month → $12,000 a year → cap $1,200. Insured, above every charity band.
  const profile: PatientProfile = { householdSize: 1, monthlyIncomeCents: 100_000, insurance: "insured" };
  const r = evaluatePolicy({ policy: catastrophic, profile, depositIncomeCents: null, balanceCents: 500_000, chargesCents: 900_000 });
  assert.deepEqual([r.eligible, r.reductionCents], [true, 380_000]);
});

test("reductions never exceed the balance and bad inputs stay safe", () => {
  const free: HospitalPolicy = { ...charity, rules: { kind: "charity_care", tiers: [{ maxIncomePctOfPoverty: 400, discountPct: 150 }] } };
  assert.equal(evaluatePolicy(input(free, 10_000)).reductionCents, 10_000);
  for (const balance of [0, -500, Number.NaN]) {
    const r = evaluatePolicy(input(charity, balance));
    assert.equal(r.reductionCents, 0);
    assert.equal(r.eligible, false);
  }
  assert.match(evaluatePolicy(input(charity, 0)).reason, /nothing is left/);
  const weird = evaluatePolicy(input(charity, 100_000, { profile: { householdSize: 0, monthlyIncomeCents: -1, insurance: "insured" } }));
  assert.deepEqual(weird.missing, ["household size", "household income"]);
});

test("same input, same output", () => {
  assert.deepEqual(evaluatePolicy(input(charity, 216_000)), evaluatePolicy(input(charity, 216_000)));
});
