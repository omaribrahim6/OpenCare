// Mocks for the SPEC revision 6 pipeline, typed with @abdulcare/contracts: hospital intake →
// insurance → hospital policies → fund request → decision brief → approval pays the hospital.
// Stateful in memory so the whole demo can be clicked through without the API.
// All people, plans, policies and visits are fictional.

import type {
  Bill,
  BillEvent,
  BillStep,
  DecisionBrief,
  Explanation,
  Grant,
  GrantDecisionRequest,
  GrantResponse,
  HospitalPolicy,
  InsuranceAdjudication,
  InsurancePlan,
  PatientBillResponse,
  PatientListResponse,
  PatientSummary,
  PolicyApplication,
  Provider,
  QueueItem,
  ReviewQueue,
  VisitResponse,
  VisitTemplate,
  VisitTemplatesResponse,
} from "@abdulcare/contracts";
import * as base from "./mock";

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const SECOND_APPROVAL_ABOVE = 50_000;
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const DEMO_HOSPITAL: Provider = { id: "prov_mercy", name: "Mercy Valley Hospital (fictional)", kind: "hospital" };

/** Jordan: household of 1, $1,400 a month (135% of the poverty guideline), underinsured. */
const PROFILE = { householdSize: 1, monthlyIncomeCents: 140_000, insurance: "underinsured" as const, incomePctOfPoverty: 135 };
const PLAN: InsurancePlan = {
  payerName: "Bay State Health Plan (fictional)",
  deductibleCents: 150_000,
  deductibleMetCents: 0,
  coinsurancePct: 20,
  outOfPocketMaxCents: 300_000,
  outOfPocketMetCents: 0,
};

const TEMPLATES: VisitTemplate[] = [
  {
    id: "vt_er",
    label: "Emergency visit",
    hospitalId: DEMO_HOSPITAL.id,
    category: "emergency",
    description: "Emergency visit, abdominal pain",
    lineItems: [
      { description: "Emergency department facility fee", cents: 235_000 },
      { description: "Emergency physician services", cents: 98_000 },
      { description: "CT scan, abdomen", cents: 112_000 },
      { description: "Laboratory tests", cents: 35_000 },
    ],
    totalCents: 480_000,
  },
  {
    id: "vt_imaging",
    label: "Outpatient imaging",
    hospitalId: DEMO_HOSPITAL.id,
    category: "hospital",
    description: "Outpatient MRI, knee",
    lineItems: [
      { description: "MRI, knee", cents: 98_000 },
      { description: "Radiologist reading", cents: 27_000 },
    ],
    totalCents: 125_000,
  },
];

const POLICIES: HospitalPolicy[] = [
  {
    id: "pol_charity",
    hospitalId: DEMO_HOSPITAL.id,
    name: "Financial Assistance (charity care)",
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
    source: "Mercy Valley Hospital Financial Assistance Policy (fictional)",
    reviewedOn: "2026-11-01",
    fictional: true,
  },
  {
    id: "pol_selfpay",
    hospitalId: DEMO_HOSPITAL.id,
    name: "Uninsured self-pay discount",
    kind: "self_pay_discount",
    rules: { kind: "self_pay_discount", discountPct: 40, requiresUninsured: true },
    applyOrder: 2,
    source: "Mercy Valley Hospital Self-Pay Policy (fictional)",
    reviewedOn: "2026-11-01",
    fictional: true,
  },
  {
    id: "pol_cap",
    hospitalId: DEMO_HOSPITAL.id,
    name: "Catastrophic cost cap",
    kind: "catastrophic_cap",
    rules: { kind: "catastrophic_cap", capPctOfAnnualIncome: 10 },
    applyOrder: 3,
    source: "Mercy Valley Hospital Catastrophic Care Policy (fictional)",
    reviewedOn: "2026-11-01",
    fictional: true,
  },
];

/** Deterministic adjudication: rest of the deductible, then coinsurance, capped by the out-of-pocket max. */
export function adjudicate(chargesCents: number, plan: InsurancePlan): InsuranceAdjudication {
  const deductibleLeft = Math.max(0, plan.deductibleCents - plan.deductibleMetCents);
  const patientDeductibleCents = Math.min(chargesCents, deductibleLeft);
  const patientCoinsuranceCents = Math.round(((chargesCents - patientDeductibleCents) * plan.coinsurancePct) / 100);
  const raw = patientDeductibleCents + patientCoinsuranceCents;
  const cap = Math.max(0, plan.outOfPocketMaxCents - plan.outOfPocketMetCents);
  const patientResponsibilityCents = Math.min(raw, cap);
  return {
    chargesCents,
    patientDeductibleCents,
    patientCoinsuranceCents,
    patientResponsibilityCents,
    insurerPaysCents: chargesCents - patientResponsibilityCents,
    outOfPocketCapped: raw > cap,
  };
}

function evaluate(visitId: string, balanceCents: number): PolicyApplication[] {
  const out: PolicyApplication[] = [];
  let left = balanceCents;
  const pct = PROFILE.incomePctOfPoverty;
  for (const policy of POLICIES) {
    let eligible = false;
    let reduction = 0;
    let criteria: PolicyApplication["evaluation"]["criteria"] = [];
    let reason = "";
    if (policy.rules.kind === "charity_care") {
      const tier = policy.rules.tiers.find((t) => pct <= t.maxIncomePctOfPoverty);
      eligible = Boolean(tier);
      reduction = tier ? Math.floor((left * tier.discountPct) / 100 / 100) * 100 : 0;
      criteria = [
        {
          key: "income",
          label: "Household income within the sliding scale",
          met: eligible,
          detail: `Income is ${pct}% of the poverty guideline${tier ? ` (limit ${tier.maxIncomePctOfPoverty}%, ${tier.discountPct}% off)` : ""}`,
        },
      ];
      reason = tier ? `Income is ${pct}% of the poverty guideline, so ${tier.discountPct}% of the balance is forgiven.` : "Income is above the sliding scale.";
    } else if (policy.rules.kind === "self_pay_discount") {
      criteria = [{ key: "insurance", label: "No insurance for this visit", met: false, detail: "Covered by Bay State Health Plan" }];
      reason = "The patient has insurance, so the self-pay discount doesn't apply.";
    } else {
      const cap = Math.round((PROFILE.monthlyIncomeCents * 12 * policy.rules.capPctOfAnnualIncome) / 100);
      eligible = left > cap;
      reduction = eligible ? left - cap : 0;
      criteria = [{ key: "cap", label: "Balance above 10% of annual income", met: eligible, detail: `Balance ${money(left)}; cap ${money(cap)}` }];
      reason = eligible ? `The balance is capped at ${money(cap)}.` : "The balance is already under the cap.";
    }
    out.push({
      id: `app_${policy.id}`,
      visitId,
      policy,
      evaluation: { policyId: policy.id, eligible, criteria, missing: [], reductionCents: reduction, reason },
      applicationText: eligible
        ? `Application to ${policy.name} at ${DEMO_HOSPITAL.name}. Household of ${PROFILE.householdSize}; monthly income ${money(PROFILE.monthlyIncomeCents)} (${pct}% of the poverty guideline). Balance: ${money(left)}.`
        : `Not needed: ${reason}`,
      textSource: "template",
      status: eligible ? "approved_simulated" : "denied_simulated",
      reductionCents: reduction,
      decidedAt: now(),
    });
    left -= reduction;
  }
  return out;
}

let visitBill: Omit<Bill, "events" | "steps" | "fundPaidCents" | "remainingCents" | "pendingCents"> & { baseEvents: BillEvent[] } | null = null;
let demoGrant: Grant | null = null;
let intakePatient: PatientSummary | null = null;

function assemble(): Bill | null {
  if (!visitBill) return null;
  const { baseEvents, ...rest } = visitBill;
  const events = [...baseEvents];
  if (demoGrant && ["pending_review", "approved", "payment_pending", "paid"].includes(demoGrant.status)) {
    const paid = demoGrant.status === "paid";
    events.push({
      id: "ev_fund",
      type: "fund_grant",
      amountCents: paid ? (demoGrant.approvedCents ?? 0) : demoGrant.requestedCents,
      source: { kind: "fund", label: "Community care fund", id: null },
      status: paid ? "confirmed" : "pending",
      simulated: false,
      reference: demoGrant.id,
      label: paid ? "Community care fund grant, paid to the hospital" : "Community care fund request",
      createdAt: demoGrant.paidAt ?? demoGrant.createdAt,
    });
  }
  const steps: BillStep[] = [];
  let balance = 0;
  for (const e of events) {
    if (e.type === "charge") {
      balance += e.amountCents;
      steps.push({ label: "Charged", reductionCents: 0, balanceCents: balance, simulated: false, status: "confirmed" });
    } else {
      if (e.status === "confirmed") balance -= e.amountCents;
      steps.push({ label: e.label, reductionCents: e.amountCents, balanceCents: Math.max(0, balance), simulated: e.simulated, status: e.status });
    }
  }
  const fundPaid = events.filter((e) => e.type === "fund_grant" && e.status === "confirmed").reduce((a, e) => a + e.amountCents, 0);
  const pending = events.filter((e) => e.status === "pending").reduce((a, e) => a + e.amountCents, 0);
  return { ...rest, events, steps, fundPaidCents: fundPaid, remainingCents: Math.max(0, balance), pendingCents: pending };
}

function explain(bill: Bill): Explanation {
  const ins = bill.insurance;
  return {
    summary: `Your ${bill.visit.description.toLowerCase()} at ${bill.visit.hospital.name} cost ${money(bill.chargesCents)}. Insurance paid ${money(bill.insurerPaidCents)}, and the hospital's assistance took off ${money(bill.hospitalAssistanceCents)}.`,
    points: [
      ins
        ? `After insurance you owed ${money(ins.patientResponsibilityCents)}: your ${money(ins.patientDeductibleCents)} deductible plus ${PLAN.coinsurancePct}% of the rest.`
        : "You don't have insurance, so the hospital's self-pay discount was checked.",
      `Because your household income is ${PROFILE.incomePctOfPoverty}% of the poverty guideline, the hospital's charity care forgave part of that.`,
      bill.remainingCents > 0
        ? `${money(bill.remainingCents)} is left. The community care fund can pay it directly to the hospital.`
        : "Nothing is left to pay.",
    ],
    questionsToAsk: [],
    disclaimer: "This uses only your hospital and insurance records. It isn't medical or insurance advice.",
    fallback: true,
  };
}

// Hospital intake --------------------------------------------------------------------------------

export async function getVisitTemplates(): Promise<VisitTemplatesResponse> {
  await delay(150);
  return { templates: TEMPLATES };
}

export async function listPatients(): Promise<PatientListResponse> {
  await delay(150);
  return { patients: [base.DEMO_PATIENT] };
}

export function setIntakePatient(p: PatientSummary | null) {
  intakePatient = p;
}

export async function getIntakePatient() {
  await delay(80);
  return { patient: intakePatient };
}

export async function createVisit(templateId: string, patientId?: string): Promise<VisitResponse> {
  await delay(900);
  const patient = patientId === base.DEMO_PATIENT.id || !patientId ? base.DEMO_PATIENT : base.DEMO_PATIENT;
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const at = now();
  const visitId = "visit_demo";
  const ins = adjudicate(t.totalCents, PLAN);
  const applications = evaluate(visitId, ins.patientResponsibilityCents);
  const hospitalOff = applications.reduce((a, x) => a + x.reductionCents, 0);
  const baseEvents: BillEvent[] = [
    {
      id: "ev_charge",
      type: "charge",
      amountCents: t.totalCents,
      source: { kind: "hospital", label: DEMO_HOSPITAL.name, id: DEMO_HOSPITAL.id },
      status: "confirmed",
      simulated: false,
      reference: null,
      label: `${t.label} at ${DEMO_HOSPITAL.name}`,
      createdAt: at,
    },
    {
      id: "ev_ins",
      type: "insurance_adjustment",
      amountCents: ins.insurerPaysCents,
      source: { kind: "insurer", label: PLAN.payerName, id: null },
      status: "confirmed",
      simulated: true,
      reference: null,
      label: `${PLAN.payerName} paid its share (simulated)`,
      createdAt: at,
    },
    ...applications
      .filter((x) => x.status === "approved_simulated" && x.reductionCents > 0)
      .map<BillEvent>((x) => ({
        id: `ev_${x.policy.id}`,
        type: "hospital_assistance",
        amountCents: x.reductionCents,
        source: { kind: "policy", label: x.policy.name, id: x.policy.id },
        status: "confirmed",
        simulated: true,
        reference: x.id,
        label: `${x.policy.name} (hospital decision, simulated)`,
        createdAt: at,
      })),
  ];
  demoGrant = null;
  visitBill = {
    visit: {
      id: visitId,
      patient,
      hospital: DEMO_HOSPITAL,
      date: at.slice(0, 10),
      category: t.category,
      description: t.description,
      lineItems: t.lineItems,
      totalCents: t.totalCents,
      attestedBy: "Hospital intake (mock)",
      createdAt: at,
    },
    plan: PLAN,
    insurance: ins,
    applications,
    chargesCents: t.totalCents,
    insurerPaidCents: ins.insurerPaysCents,
    hospitalAssistanceCents: hospitalOff,
    patientPaidCents: 0,
    suspiciousContent: null,
    baseEvents,
  };
  return { bill: assemble()! };
}

// Patient app ------------------------------------------------------------------------------------

export async function getMyBill(): Promise<PatientBillResponse> {
  await delay();
  const bill = assemble();
  return { bill, explanation: bill ? explain(bill) : null, grant: demoGrant };
}

export async function requestHelp(visitId: string, hardshipNote?: string): Promise<GrantResponse> {
  await delay(500);
  const bill = assemble();
  if (!bill || bill.visit.id !== visitId) throw new Error("Log the hospital visit first.");
  if (demoGrant && demoGrant.status === "pending_review") return { grant: demoGrant, bill };
  const doc = (await base.createDocument({ source: "nessie_bill", nessieId: "bill_pharm" })).document;
  demoGrant = {
    id: "grt_visit_demo",
    patient: base.DEMO_PATIENT,
    visit: {
      id: bill.visit.id,
      hospital: bill.visit.hospital,
      date: bill.visit.date,
      category: bill.visit.category,
      description: bill.visit.description,
      totalCents: bill.visit.totalCents,
    },
    bill: { ...doc, merchant: bill.visit.hospital.name, description: bill.visit.description, amountCents: bill.remainingCents, category: bill.visit.category },
    provider: bill.visit.hospital,
    requestedCents: bill.remainingCents,
    approvedCents: null,
    status: "pending_review",
    hardshipNote: hardshipNote?.trim() || null,
    approvals: [],
    awaitingSecondApproval: false,
    createdAt: now(),
    decidedAt: null,
    paidAt: null,
    receipt: null,
  };
  return { grant: demoGrant, bill: assemble()! };
}

// Admin panel ------------------------------------------------------------------------------------

export function briefFor(item: QueueItem, path: BillStep[], remainingCents: number): DecisionBrief {
  const suggested = Math.floor(remainingCents / 100) * 100;
  const flags: DecisionBrief["flags"] = [];
  if (item.suspiciousContent) {
    flags.push({ kind: "suspicious_content", detail: `Instructions hidden in the ${item.suspiciousContent.field.replace("_", " ")} were ignored; nothing changed.` });
  }
  if (item.assessment.incomeMismatch) flags.push({ kind: "income_mismatch", detail: "Income on file differs from bank deposits by more than 25%." });
  for (const f of item.assessment.factors.filter((x) => x.unknown)) {
    flags.push({ kind: "unknown_factor", detail: `${f.label} is unknown and scored at the midpoint.` });
  }
  return {
    grantId: item.grant.id,
    path,
    reasons: [item.rationale],
    flags,
    suggestedAction: "approve",
    suggestedCents: suggested,
    needsSecondApproval: suggested > SECOND_APPROVAL_ABOVE,
    source: "template",
    model: null,
    checked: true,
    computedAt: now(),
  };
}

export async function getReviewQueue(): Promise<ReviewQueue> {
  const q = await base.getReviewQueue(true);
  let items: QueueItem[] = q.items
    .filter((it) => it.grant.id !== "grt_001")
    .map((it) => {
      const remaining = it.grant.requestedCents;
      const path: BillStep[] = [{ label: "Remaining", reductionCents: 0, balanceCents: remaining, simulated: false, status: "confirmed" }];
      return { ...it, path, remainingCents: remaining, brief: briefFor(it, path, remaining) };
    });
  const bill = assemble();
  if (demoGrant?.status === "pending_review" && bill) {
    const template = q.items.find((it) => it.grant.id === "grt_001");
    if (template) {
      const it: QueueItem = {
        ...template,
        grant: demoGrant,
        daysWaiting: 0,
        rationale:
          "Income is 135% of the poverty guideline and the patient is underinsured. After insurance and the hospital's charity care, $432.00 remains, about 0.31 months of income. No prior support from the fund.",
        path: bill.steps,
        remainingCents: bill.remainingCents,
      };
      it.brief = briefFor(it, bill.steps.filter((s) => s.status === "confirmed"), bill.remainingCents);
      items.push(it);
    }
  }
  items = items
    .filter((it) => it.grant.status === "pending_review")
    .sort((a, b) => b.assessment.score - a.assessment.score || b.daysWaiting - a.daysWaiting)
    .map((it, i) => ({ ...it, rank: i + 1, formulaRank: i + 1, disagreesWithFormula: false }));
  return { ...q, source: "formula", model: null, items };
}

/** Approval pays the hospital directly (no provider tap): approve → paid with a receipt. */
export async function decideGrant(id: string, req: GrantDecisionRequest): Promise<GrantResponse> {
  if (demoGrant && id === demoGrant.id) {
    await delay(1200);
    demoGrant =
      req.decision === "approve"
        ? {
            ...demoGrant,
            status: "paid",
            approvedCents: req.approvedCents,
            approvals: [{ reviewerLabel: "Final reviewer (mock)", approvedCents: req.approvedCents, at: now() }],
            decidedAt: now(),
            paidAt: now(),
            receipt: {
              nessiePaymentId: "mock_pay_7d41",
              solanaSignature: "4vJmockReceiptSignature",
              explorerUrl: null,
              receiptStatus: "receipt_confirmed",
            },
          }
        : { ...demoGrant, status: "rejected", decidedAt: now() };
    return { grant: demoGrant };
  }
  const r = await base.decideGrant(id, req);
  return r.grant.status === "approved" ? base.redeemGrant(id).catch(() => r) : r;
}
