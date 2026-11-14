// Live check of the revision 6 Gemini features with fictional data. Not run by the tests or CI.
//   npm run smoke -w @abdulcare/ai
// Makes exactly ONE live call per feature (brief, explanation, application), then repeats each
// with a failing client to confirm the template fallback. Calls are billed to Omar's Vertex key
// (AGENTS.md §7): run it once, never in a loop. Prints results only, never keys or credentials.
import { SECOND_APPROVAL_ABOVE_CENTS, type ApplicationTextInput, type BillExplanationInput, type BriefInput, type HospitalPolicy } from "@abdulcare/contracts";
import { assessNeed } from "./formula";
import { createBillEngine } from "./bills/engine";
import { evaluatePolicy } from "./bills/policy";
import type { ModelClient } from "./gemini";

const steps = [
  { label: "Charged by Valley General Hospital", reductionCents: 0, balanceCents: 480_000, simulated: false, status: "confirmed" as const },
  { label: "Insurance (Bluebird Health Plan)", reductionCents: 264_000, balanceCents: 216_000, simulated: true, status: "confirmed" as const },
  { label: "Charity care (hospital decision, simulated)", reductionCents: 172_800, balanceCents: 43_200, simulated: true, status: "confirmed" as const },
];
const assessment = assessNeed({
  householdSize: 3, profileIncomeCents: 250_000, depositIncomeCents: null, insurance: "insured",
  billCents: 43_200, category: "emergency", daysWaiting: 2, priorPaidCount90d: 0, priorPaidCents90d: 0,
});
const brief: BriefInput = {
  path: steps, remainingCents: 43_200, assessment, factors: assessment.factors, rank: 1, queueLength: 4,
  daysWaiting: 2, suspiciousContent: null, secondApprovalAboveCents: SECOND_APPROVAL_ABOVE_CENTS,
};
const explain: BillExplanationInput = {
  hospitalName: "Valley General Hospital", category: "emergency", steps, remainingCents: 43_200,
  lineItems: [
    { description: "Emergency department visit, level 4", cents: 285_000 },
    { description: "X-ray, wrist (3 views)", cents: 135_000 },
    { description: "Splint and supplies", cents: 60_000 },
  ],
};
const charity: HospitalPolicy = {
  id: "pol_demo_charity", hospitalId: "hosp_demo", name: "Charity care", kind: "charity_care",
  rules: { kind: "charity_care", tiers: [{ maxIncomePctOfPoverty: 200, discountPct: 80 }, { maxIncomePctOfPoverty: 300, discountPct: 50 }, { maxIncomePctOfPoverty: 400, discountPct: 25 }] },
  applyOrder: 1, source: "Valley General Financial Assistance Policy §3, sliding scale (fictional)", reviewedOn: "2026-10-01", fictional: true,
};
const profile = { householdSize: 3, monthlyIncomeCents: 250_000, insurance: "insured" as const };
const application: ApplicationTextInput = {
  policy: charity, profile, hospitalName: "Valley General Hospital", visitDate: "2026-11-14", category: "emergency", balanceCents: 216_000,
  evaluation: evaluatePolicy({ policy: charity, profile, depositIncomeCents: null, balanceCents: 216_000, chargesCents: 480_000 }),
};

const failing: ModelClient = { model: "failing", generateJson: () => Promise.reject(new Error("forced failure")) };

async function main() {
  const live = createBillEngine();
  const dead = createBillEngine({ client: failing });
  for (const [name, run] of [
    ["brief", (e: typeof live) => e.writeBrief(brief)],
    ["explanation", (e: typeof live) => e.explainBill(explain)],
    ["application", (e: typeof live) => e.writeApplication(application)],
  ] as const) {
    const t0 = Date.now();
    const out = await run(live);
    console.log(`== ${name} (live, ${Date.now() - t0} ms):`, JSON.stringify(out, null, 2));
    const fb = await run(dead);
    const source = "source" in fb ? fb.source : fb.fallback ? "template" : "gemini";
    console.log(`== ${name} fallback: ${source === "template" ? "OK (template)" : "UNEXPECTED " + source}`);
  }
}

main().catch((err) => {
  console.error("smoke failed:", (err as Error).message);
  process.exit(1);
});
