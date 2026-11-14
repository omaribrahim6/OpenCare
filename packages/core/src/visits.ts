// Visits and the bill ledger (SPEC §1 steps 1–3, §8). A paired hospital device logs a visit; the
// charge, the insurance adjustment and every hospital policy's simulated decision post to the
// visit's bill in one transaction, exactly once per idempotency key.

import type {
  Bill,
  BillEngine,
  BillEvent,
  BillEventSourceKind,
  BillEventStatus,
  BillEventType,
  BillStep,
  ExpenseCategory,
  Explanation,
  HospitalPolicy,
  InsuranceAdjudication,
  LineItem,
  NeedEngine,
  PolicyApplication,
  PolicyApplicationStatus,
  PolicyEvaluation,
  PolicyRules,
  Provider,
  SuspiciousContent,
  Visit,
  VisitTemplate,
} from "@abdulcare/contracts";
import { applicationTextFallback, explainBillFallback } from "./bill-fallback";
import type { Db } from "./db";
import { adjudicate, getInsurancePlan } from "./insurance";
import { getPatientWithProfile } from "./profiles";
import { CoreError, iso, isoOrNull, newId } from "./util";

// ---------------------------------------------------------------------------
// Templates and policies

interface TemplateRow {
  id: string;
  hospital_id: string;
  label: string;
  category: ExpenseCategory;
  description: string;
  line_items: LineItem[] | string;
  total_cents: number;
}

const json = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

function toTemplate(r: TemplateRow): VisitTemplate {
  return {
    id: r.id,
    label: r.label,
    hospitalId: r.hospital_id,
    category: r.category,
    description: r.description,
    lineItems: json(r.line_items),
    totalCents: Number(r.total_cents),
  };
}

/** The seeded visits a hospital can log; all hospitals' when hospitalId is omitted. */
export async function listVisitTemplates(db: Db, hospitalId?: string | null): Promise<VisitTemplate[]> {
  const { rows } = await db.query<TemplateRow>(
    `select id, hospital_id, label, category, description, line_items, total_cents
       from visit_templates ${hospitalId ? "where hospital_id = $1" : ""}
      order by sort_order, label`,
    hospitalId ? [hospitalId] : [],
  );
  return rows.map(toTemplate);
}

interface PolicyRow {
  id: string;
  hospital_id: string;
  name: string;
  kind: HospitalPolicy["kind"];
  rules: PolicyRules | string;
  apply_order: number;
  source: string;
  reviewed_on: Date | string;
  fictional: boolean;
}

const POLICY_COLUMNS = "id, hospital_id, name, kind, rules, apply_order, source, reviewed_on, fictional";

function toPolicy(r: PolicyRow): HospitalPolicy {
  return {
    id: r.id,
    hospitalId: r.hospital_id,
    name: r.name,
    kind: r.kind,
    rules: json(r.rules),
    applyOrder: Number(r.apply_order),
    source: r.source,
    reviewedOn: iso(r.reviewed_on).slice(0, 10),
    fictional: r.fictional,
  };
}

/** A hospital's assistance policies in apply order. */
export async function listHospitalPolicies(db: Db, hospitalId: string): Promise<HospitalPolicy[]> {
  const { rows } = await db.query<PolicyRow>(
    `select ${POLICY_COLUMNS} from hospital_policies where hospital_id = $1 order by apply_order`,
    [hospitalId],
  );
  return rows.map(toPolicy);
}

// ---------------------------------------------------------------------------
// Logging a visit

export interface LogVisitInput {
  templateId: string;
  patientId: string;
  /** The hospital device logging the visit; its hospital must own the template. */
  device: { id: string; label: string; providerId: string | null };
  idempotencyKey: string;
  /** Monthly income from Nessie deposits, when the route could fetch it. */
  depositIncomeCents?: number | null;
  /**
   * True applies every policy at once (the simulated hospital decides at intake). False (default)
   * records each application as "prepared"; the patient applies them with applyVisitPolicies.
   */
  applyPolicies?: boolean;
  /**
   * The admin panel's hospital-intake tab (a reviewer device, simulated hospital staff) may log any
   * hospital's templates; hospital devices only log their own.
   */
  anyHospital?: boolean;
}


const POLICY_LABEL = (name: string) => `${name} (hospital decision, simulated)`;

/**
 * Log a visit and run insurance and every hospital policy on it. Repeating the same
 * idempotency key returns the same bill without posting anything again.
 */
export async function logVisit(
  db: Db,
  engines: { bills: BillEngine; need?: Pick<NeedEngine, "detectSuspicious"> },
  input: LogVisitInput,
): Promise<Bill> {
  const key = input.idempotencyKey?.trim();
  if (!key || key.length > 100) throw new CoreError("bad_request", "idempotencyKey is required");
  const existing = await visitIdForKey(db, key);
  if (existing) {
    if (existing.patientId !== input.patientId) throw new CoreError("conflict", "This idempotency key was used for another patient");
    return getBill(db, existing.id);
  }

  if (!input.anyHospital && !input.device.providerId) throw new CoreError("forbidden", "This device isn't linked to a hospital");
  const { rows: tRows } = await db.query<TemplateRow>(
    "select id, hospital_id, label, category, description, line_items, total_cents from visit_templates where id = $1",
    [input.templateId],
  );
  if (!tRows[0]) throw new CoreError("not_found", "Unknown visit template");
  const template = toTemplate(tRows[0]);
  if (!input.anyHospital && template.hospitalId !== input.device.providerId) {
    throw new CoreError("forbidden", "This visit template belongs to another hospital");
  }
  const { profile } = await getPatientWithProfile(db, input.patientId);
  const plan = await getInsurancePlan(db, input.patientId);
  const { rows: hRows } = await db.query<{ name: string }>("select name from providers where id = $1", [template.hospitalId]);
  const hospitalName = hRows[0]?.name ?? "Hospital";
  const today = new Date().toISOString().slice(0, 10);

  // Everything below is computed before the transaction (the AI text may take a moment).
  const charges = template.lineItems.reduce((sum, li) => sum + li.cents, 0);
  if (charges !== template.totalCents) throw new CoreError("internal", "Visit template total doesn't match its line items");
  const insurance = plan ? adjudicate(plan, charges) : null;
  let balance = insurance ? insurance.patientResponsibilityCents : charges;

  const applications: {
    id: string;
    policy: HospitalPolicy;
    evaluation: PolicyEvaluation;
    text: string;
    textSource: "gemini" | "template";
    status: PolicyApplicationStatus;
    reduction: number;
  }[] = [];
  const policies = await listHospitalPolicies(db, template.hospitalId);
  for (const policy of policies) {
    const evaluation = engines.bills.evaluatePolicy({
      policy,
      profile,
      depositIncomeCents: input.depositIncomeCents ?? null,
      balanceCents: balance,
      chargesCents: charges,
    });
    // Defense in depth: a reduction is a whole number of cents between 0 and the balance.
    const reduction = evaluation.eligible ? Math.min(balance, Math.max(0, Math.round(evaluation.reductionCents))) : 0;
    const textInput = { policy, evaluation, profile, hospitalName, visitDate: today, category: template.category, balanceCents: balance };
    let text = applicationTextFallback(textInput);
    try {
      text = await engines.bills.writeApplication(textInput);
    } catch {
      // Keep the template text.
    }
    applications.push({
      id: newId("pap"),
      policy,
      evaluation: { ...evaluation, reductionCents: reduction },
      text: text.text,
      textSource: text.source,
      status: !input.applyPolicies ? "prepared" : reduction > 0 ? "approved_simulated" : "denied_simulated",
      reduction,
    });
    balance -= reduction;
  }

  let suspicious: SuspiciousContent | null = null;
  if (engines.need) {
    try {
      suspicious = await engines.need.detectSuspicious([
        { field: "description", text: template.description },
        ...template.lineItems.map((li) => ({ field: "description" as const, text: li.description })),
        // Policy names and sources are untrusted too (SPEC §7); amounts only ever come from the rules.
        ...policies.flatMap((p) => [
          { field: "policy_text" as const, text: p.name },
          { field: "policy_text" as const, text: p.source },
        ]),

      ]);
    } catch {
      suspicious = null; // A warning only; it never blocks intake.
    }
  }

  const visitId = newId("vis");
  const inserted = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into visits (id, patient_id, hospital_id, template_id, visit_date, category, description,
                           line_items, total_cents, device_id, attested_by, idempotency_key, suspicious)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (idempotency_key) do nothing
       returning id`,
      [
        visitId,
        input.patientId,
        template.hospitalId,
        template.id,
        today,
        template.category,
        template.description,
        JSON.stringify(template.lineItems),
        charges,
        input.device.id,
        input.device.label,
        key,
        JSON.stringify(suspicious),
      ],
    );
    if (!rows[0]) return false; // A concurrent request with the same key won.

    let seq = 0;
    const post = (e: {
      type: BillEventType;
      amount: number;
      kind: BillEventSourceKind;
      sourceLabel: string;
      sourceId: string | null;
      simulated: boolean;
      reference: string | null;
      label: string;
    }) =>
      tx.query(
        `insert into bill_events (id, visit_id, type, amount_cents, source_kind, source_label, source_id,
                                  status, simulated, reference, label, seq)
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10, $11)`,
        [newId("bev"), visitId, e.type, e.amount, e.kind, e.sourceLabel, e.sourceId, e.simulated, e.reference, e.label, ++seq],
      );

    await post({
      type: "charge",
      amount: charges,
      kind: "hospital",
      sourceLabel: hospitalName,
      sourceId: template.hospitalId,
      simulated: false,
      reference: null,
      label: `${template.label} at ${hospitalName} (hospital-attested)`,
    });
    if (plan && insurance && insurance.insurerPaysCents > 0) {
      await post({
        type: "insurance_adjustment",
        amount: insurance.insurerPaysCents,
        kind: "insurer",
        sourceLabel: plan.payerName,
        sourceId: null,
        simulated: true,
        reference: null,
        label: `${plan.payerName} paid its share (simulated)`,
      });
    }
    for (const a of applications) {
      await tx.query(
        `insert into policy_applications (id, visit_id, policy_id, evaluation, application_text, text_source,
                                          status, reduction_cents, decided_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          a.id,
          visitId,
          a.policy.id,
          JSON.stringify(a.evaluation),
          a.text,
          a.textSource,
          a.status,
          input.applyPolicies ? a.reduction : 0,
          input.applyPolicies ? new Date() : null,
        ],
      );
      if (input.applyPolicies && a.reduction > 0) {

        await post({
          type: "hospital_assistance",
          amount: a.reduction,
          kind: "policy",
          sourceLabel: a.policy.name,
          sourceId: a.policy.id,
          simulated: true,
          reference: a.id,
          label: POLICY_LABEL(a.policy.name),
        });
      }
    }
    return true;
  });

  if (!inserted) {
    const winner = await visitIdForKey(db, key);
    if (!winner) throw new CoreError("internal", "Visit insert raced and vanished");
    return getBill(db, winner.id);
  }
  return getBill(db, visitId);
}

async function visitIdForKey(db: Db, key: string): Promise<{ id: string; patientId: string } | null> {
  const { rows } = await db.query<{ id: string; patient_id: string }>(
    "select id, patient_id from visits where idempotency_key = $1",
    [key],
  );
  return rows[0] ? { id: rows[0].id, patientId: rows[0].patient_id } : null;
}

// ---------------------------------------------------------------------------
// "Apply for savings": the patient submits the prepared applications

/**
 * Submit a visit's prepared policy applications in apply order. Each simulated hospital decision
 * is re-evaluated against the balance left at that moment and posts a confirmed reduction. If the
 * patient saved an insurance plan after intake and nothing was applied yet, the insurance
 * adjustment posts first. Idempotent: once nothing is prepared, it returns the bill unchanged.
 */
export async function applyVisitPolicies(
  db: Db,
  engines: { bills: BillEngine },
  input: { visitId: string; patientId: string; depositIncomeCents?: number | null },
): Promise<Bill> {
  const bill = await getBill(db, input.visitId, { patientId: input.patientId });
  const prepared = bill.applications.filter((a) => a.status === "prepared");
  if (prepared.length === 0) return bill;

  const { profile } = await getPatientWithProfile(db, input.patientId);
  const plan = await getInsurancePlan(db, input.patientId);
  const hasInsurance = bill.events.some((e) => e.type === "insurance_adjustment");
  const anyApplied = bill.events.some((e) => e.type === "hospital_assistance" || e.type === "fund_grant");
  const insurance = !hasInsurance && !anyApplied && plan ? adjudicate(plan, bill.chargesCents) : null;

  // Everything is computed before the transaction (the AI text may take a moment).
  let balance = bill.remainingCents - (insurance ? insurance.insurerPaysCents : 0);
  const decisions: { app: PolicyApplication; evaluation: PolicyEvaluation; reduction: number; text: string; textSource: "gemini" | "template" }[] = [];
  for (const app of prepared) {
    const evaluation = engines.bills.evaluatePolicy({
      policy: app.policy,
      profile,
      depositIncomeCents: input.depositIncomeCents ?? null,
      balanceCents: balance,
      chargesCents: bill.chargesCents,
    });
    const reduction = evaluation.eligible ? Math.min(balance, Math.max(0, Math.round(evaluation.reductionCents))) : 0;
    let text = { text: app.applicationText, source: app.textSource as "gemini" | "template" };
    if (app.evaluation.reductionCents !== reduction) {
      // The balance changed since intake (for example, a plan saved later): refresh the text.
      const textInput = {
        policy: app.policy,
        evaluation,
        profile,
        hospitalName: bill.visit.hospital.name,
        visitDate: bill.visit.date,
        category: bill.visit.category,
        balanceCents: balance,
      };
      text = applicationTextFallback(textInput);
      try {
        text = await engines.bills.writeApplication(textInput);
      } catch {
        // Keep the template text.
      }
    }
    decisions.push({ app, evaluation: { ...evaluation, reductionCents: reduction }, reduction, text: text.text, textSource: text.source });
    balance -= reduction;
  }

  await db.transaction(async (tx) => {
    // Lock the visit so two taps on "Apply" can't both post.
    await tx.query("select id from visits where id = $1 for update", [input.visitId]);
    const { rows: still } = await tx.query<{ id: string }>(
      "select id from policy_applications where visit_id = $1 and status = 'prepared'",
      [input.visitId],
    );
    const stillPrepared = new Set(still.map((r) => r.id));
    if (decisions.some((d) => !stillPrepared.has(d.app.id))) return; // Another request applied them.
    const { rows: seqRows } = await tx.query<{ seq: number }>(
      "select coalesce(max(seq), 0)::int as seq from bill_events where visit_id = $1",
      [input.visitId],
    );
    let seq = Number(seqRows[0]?.seq ?? 0);
    const post = (type: BillEventType, amount: number, kind: BillEventSourceKind, sourceLabel: string, sourceId: string | null, reference: string | null, label: string) =>
      tx.query(
        `insert into bill_events (id, visit_id, type, amount_cents, source_kind, source_label, source_id,
                                  status, simulated, reference, label, seq)
         values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', true, $8, $9, $10)`,
        [newId("bev"), input.visitId, type, amount, kind, sourceLabel, sourceId, reference, label, ++seq],
      );
    if (plan && insurance && insurance.insurerPaysCents > 0) {
      await post("insurance_adjustment", insurance.insurerPaysCents, "insurer", plan.payerName, null, null, `${plan.payerName} paid its share (simulated)`);
    }
    for (const d of decisions) {
      await tx.query(
        `update policy_applications
            set status = $2, evaluation = $3, reduction_cents = $4, application_text = $5, text_source = $6, decided_at = now()
          where id = $1 and status = 'prepared'`,
        [d.app.id, d.reduction > 0 ? "approved_simulated" : "denied_simulated", JSON.stringify(d.evaluation), d.reduction, d.text, d.textSource],
      );
      if (d.reduction > 0) {
        await post("hospital_assistance", d.reduction, "policy", d.app.policy.name, d.app.policy.id, d.app.id, POLICY_LABEL(d.app.policy.name));
      }
    }
  });
  return getBill(db, input.visitId, { patientId: input.patientId });
}

/** The patient's visits, newest first. */
export async function listPatientVisitIds(db: Db, patientId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "select id from visits where patient_id = $1 order by created_at desc limit 50",
    [patientId],
  );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Reading a bill

interface VisitRow {
  id: string;
  patient_id: string;
  patient_name: string;
  hospital_id: string;
  hospital_name: string;
  hospital_kind: string;
  visit_date: Date | string;
  category: ExpenseCategory;
  description: string;
  line_items: LineItem[] | string;
  total_cents: number;
  attested_by: string;
  suspicious: SuspiciousContent | string | null;
  created_at: Date;
}

const VISIT_SELECT = `
  select v.id, v.patient_id, p.display_name as patient_name, v.hospital_id, h.name as hospital_name,
         h.kind as hospital_kind, v.visit_date, v.category, v.description, v.line_items, v.total_cents,
         v.attested_by, v.suspicious, v.created_at
    from visits v
    join patients p on p.id = v.patient_id
    join providers h on h.id = v.hospital_id`;

function toVisit(r: VisitRow): Visit {
  const hospital: Provider = { id: r.hospital_id, name: r.hospital_name, kind: r.hospital_kind };
  return {
    id: r.id,
    patient: { id: r.patient_id, displayName: r.patient_name },
    hospital,
    date: iso(r.visit_date).slice(0, 10),
    category: r.category,
    description: r.description,
    lineItems: json(r.line_items),
    totalCents: Number(r.total_cents),
    attestedBy: r.attested_by,
    createdAt: iso(r.created_at),
  };
}

/**
 * The full bill for a visit. Pass patientId to require that the visit is that patient's
 * (kiosk sessions); reviewers and the logging hospital omit it.
 */
export async function getBill(db: Db, visitId: string, opts: { patientId?: string } = {}): Promise<Bill> {
  const { rows } = await db.query<VisitRow>(`${VISIT_SELECT} where v.id = $1`, [visitId]);
  const row = rows[0];
  if (!row) throw new CoreError("not_found", "Visit not found");
  if (opts.patientId !== undefined && row.patient_id !== opts.patientId) {
    throw new CoreError("forbidden", "Not this patient's visit");
  }
  const visit = toVisit(row);
  const plan = await getInsurancePlan(db, visit.patient.id);

  const { rows: evRows } = await db.query<{
    id: string;
    type: BillEventType;
    amount_cents: number;
    source_kind: BillEventSourceKind;
    source_label: string;
    source_id: string | null;
    status: BillEventStatus;
    simulated: boolean;
    reference: string | null;
    label: string;
    created_at: Date;
  }>(
    `select id, type, amount_cents, source_kind, source_label, source_id, status, simulated, reference, label, created_at
       from bill_events where visit_id = $1 order by seq`,
    [visitId],
  );
  const events: BillEvent[] = evRows.map((e) => ({
    id: e.id,
    type: e.type,
    amountCents: Number(e.amount_cents),
    source: { kind: e.source_kind, label: e.source_label, id: e.source_id },
    status: e.status,
    simulated: e.simulated,
    reference: e.reference,
    label: e.label,
    createdAt: iso(e.created_at),
  }));

  // Fund grants come straight from the grants table, so the bill can never disagree with them.
  const { rows: gRows } = await db.query<{
    id: string;
    status: string;
    approved_cents: number | null;
    decided_at: Date | null;
    paid_at: Date | null;
  }>(
    `select id, status, approved_cents, decided_at, paid_at from grants
      where visit_id = $1 and status in ('approved', 'payment_pending', 'paid')
      order by created_at`,
    [visitId],
  );
  for (const g of gRows) {
    events.push({
      id: `fund_${g.id}`,
      type: "fund_grant",
      amountCents: Number(g.approved_cents ?? 0),
      source: { kind: "fund", label: "Community care fund", id: null },
      status: g.status === "paid" ? "confirmed" : "pending",
      simulated: false,
      reference: g.id,
      label: g.status === "paid" ? "Community care fund paid the hospital" : "Community care fund approved (payment pending)",
      createdAt: iso(g.paid_at ?? g.decided_at ?? new Date()),
    });
  }

  const { rows: aRows } = await db.query<
    PolicyRow & {
      app_id: string;
      evaluation: PolicyEvaluation | string;
      application_text: string;
      text_source: "gemini" | "template";
      status: PolicyApplicationStatus;
      reduction_cents: number;
      decided_at: Date | null;
    }
  >(
    `select a.id as app_id, a.evaluation, a.application_text, a.text_source, a.status, a.reduction_cents, a.decided_at,
            hp.id, hp.hospital_id, hp.name, hp.kind, hp.rules, hp.apply_order, hp.source, hp.reviewed_on, hp.fictional
       from policy_applications a join hospital_policies hp on hp.id = a.policy_id
      where a.visit_id = $1 order by hp.apply_order`,
    [visitId],
  );
  const applications: PolicyApplication[] = aRows.map((a) => ({
    id: a.app_id,
    visitId,
    policy: toPolicy(a),
    evaluation: json(a.evaluation),
    applicationText: a.application_text,
    textSource: a.text_source,
    status: a.status,
    reductionCents: Number(a.reduction_cents),
    decidedAt: isoOrNull(a.decided_at),
  }));

  return summarize(visit, plan ? adjudicate(plan, visit.totalCents) : null, plan, events, applications, json(row.suspicious));
}

function summarize(
  visit: Visit,
  insurance: InsuranceAdjudication | null,
  plan: Bill["plan"],
  events: BillEvent[],
  applications: PolicyApplication[],
  suspicious: SuspiciousContent | null,
): Bill {
  const sum = (type: BillEventType, status: BillEventStatus = "confirmed") =>
    events.filter((e) => e.type === type && e.status === status).reduce((s, e) => s + e.amountCents, 0);
  const chargesCents = sum("charge");
  const steps: BillStep[] = [];
  let balance = 0;
  for (const e of events) {
    if (e.type === "charge") {
      balance += e.amountCents;
      steps.push({ label: "Charged", reductionCents: 0, balanceCents: balance, simulated: false, status: e.status });
      continue;
    }
    // Pending reductions are listed but never subtracted.
    const reduction = e.status === "confirmed" ? Math.min(balance, e.amountCents) : 0;
    balance -= reduction;
    steps.push({
      label: e.label,
      reductionCents: e.status === "confirmed" ? reduction : e.amountCents,
      balanceCents: balance,
      simulated: e.simulated,
      status: e.status,
    });
  }
  const reductions = events
    .filter((e) => e.type !== "charge" && e.status === "confirmed")
    .reduce((s, e) => s + e.amountCents, 0);
  return {
    visit,
    plan,
    insurance,
    events,
    applications,
    steps,
    chargesCents,
    insurerPaidCents: sum("insurance_adjustment"),
    hospitalAssistanceCents: sum("hospital_assistance"),
    fundPaidCents: sum("fund_grant"),
    patientPaidCents: sum("patient_payment"),
    remainingCents: Math.max(0, chargesCents - reductions),
    pendingCents: events.filter((e) => e.type !== "charge" && e.status === "pending").reduce((s, e) => s + e.amountCents, 0),
    suspiciousContent: suspicious,
  };
}

/** The patient's most recent visit, or null. */
export async function latestVisitId(db: Db, patientId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    "select id from visits where patient_id = $1 order by created_at desc limit 1",
    [patientId],
  );
  return rows[0]?.id ?? null;
}

/**
 * The patient explanation for a bill, cached on the visit and refreshed whenever the bill's
 * steps change (for example, once the fund pays).
 */
export async function explainBill(db: Db, engine: BillEngine, bill: Bill): Promise<Explanation> {
  const input = {
    hospitalName: bill.visit.hospital.name,
    category: bill.visit.category,
    lineItems: bill.visit.lineItems,
    steps: bill.steps,
    remainingCents: bill.remainingCents,
  };
  const stamp = JSON.stringify(bill.steps.map((s) => [s.label, s.balanceCents, s.status]));
  const { rows } = await db.query<{ explanation: { stamp: string; value: Explanation } | string | null }>(
    "select explanation from visits where id = $1",
    [bill.visit.id],
  );
  const cached = rows[0]?.explanation ? json(rows[0].explanation) : null;
  if (cached && cached.stamp === stamp) return cached.value;
  let value: Explanation;
  try {
    value = await engine.explainBill(input);
  } catch {
    value = explainBillFallback(input);
  }
  await db.query("update visits set explanation = $2 where id = $1", [bill.visit.id, JSON.stringify({ stamp, value })]);
  return value;
}

/** Demo patients, for the hospital tab's "pick the demo patient" when no card is at hand. */
export async function listPatients(db: Db): Promise<{ id: string; displayName: string }[]> {
  const { rows } = await db.query<{ id: string; display_name: string }>(
    // The history seed's patients (pat_hist_*) are past cases, not people at the hospital today.
    "select id, display_name from patients where id not like 'pat_hist_%' order by display_name",
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
}
