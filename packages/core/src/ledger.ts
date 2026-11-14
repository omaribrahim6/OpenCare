// Public ledger (fraud resistance). Every decided case and every donation, auditable by anyone:
// cost of care, itemized bill, insurance, hospital assistance, need score and decision, tied to
// the Solana receipt. Identity (name, birth date, SSN, address) and hardship notes stay private;
// only a reviewer device can reveal identity, and each reveal is logged and counted publicly.

import type {
  IdentityRevealResponse,
  LedgerCase,
  LedgerEntry,
  LedgerResponse,
  NeedAssessment,
  NeedInput,
  SuspiciousContent,
} from "@abdulcare/contracts";
import type { Db } from "./db";
import { getGrant, payoutReference } from "./grants";
import { povertyLineCents } from "./bill-fallback";
import { CoreError, iso, newId } from "./util";
import { getBill } from "./visits";

const LEDGER_LIMIT = 1000;

interface CaseRow {
  id: string;
  public_ref: string | null;
  status: string;
  approved_cents: number | null;
  created_at: Date;
  decided_at: Date | null;
  paid_at: Date | null;
  decision_signature: string | null;
  hospital: string;
  category: LedgerEntry["category"];
  description: string;
  total_cents: number;
  insurer_cents: number;
  assistance_cents: number;
  score: number | null;
  region: string | null;
  solana_signature: string | null;
}

/** The public reference for a grant: stored, or derived (and then stored) for older grants. */
async function refFor(db: Db, row: { id: string; public_ref: string | null }): Promise<string> {
  if (row.public_ref) return row.public_ref;
  const ref = payoutReference(row.id);
  await db.query("update grants set public_ref = $2 where id = $1 and public_ref is null", [row.id, ref]);
  return ref;
}

export async function listLedger(db: Db): Promise<LedgerResponse> {
  const { rows: donations } = await db.query<{
    id: string;
    rail: "nessie" | "solana";
    amount_cents: number;
    solana_signature: string | null;
    donor_label: string | null;
    created_at: Date;
  }>(
    `select id, rail, amount_cents, solana_signature, donor_label, created_at
       from donations order by created_at desc limit ${LEDGER_LIMIT}`,
  );

  const { rows: cases } = await db.query<CaseRow>(
    `select g.id, g.public_ref, g.status, g.approved_cents, g.created_at, g.decided_at, g.paid_at,
            g.decision_signature, h.name as hospital, v.category, v.description, v.total_cents,
            coalesce((select sum(amount_cents) from bill_events b
                       where b.visit_id = v.id and b.type = 'insurance_adjustment' and b.status = 'confirmed'), 0)::bigint
              as insurer_cents,
            coalesce((select sum(amount_cents) from bill_events b
                       where b.visit_id = v.id and b.type = 'hospital_assistance' and b.status = 'confirmed'), 0)::bigint
              as assistance_cents,
            n.score, p.region,
            (select external_id from payment_attempts a
              where a.grant_id = g.id and a.rail = 'solana' and a.status = 'confirmed'
              order by a.created_at desc limit 1) as solana_signature
       from grants g
       join visits v on v.id = g.visit_id
       join providers h on h.id = v.hospital_id
       join patients p on p.id = g.patient_id
       left join need_assessments n on n.grant_id = g.id
      where g.status in ('approved', 'payment_pending', 'paid', 'rejected')
      order by coalesce(g.paid_at, g.decided_at, g.created_at) desc
      limit ${LEDGER_LIMIT}`,
  );

  const entries: LedgerEntry[] = donations.map((d) => ({
    kind: "donation",
    reference: d.id,
    at: iso(d.created_at),
    amountCents: Number(d.amount_cents),
    solanaSignature: d.solana_signature,
    donorLabel: d.donor_label,
    rail: d.rail,
  }));
  for (const c of cases) {
    const declined = c.status === "rejected";
    entries.push({
      kind: declined ? "declined" : c.status === "paid" ? "payout" : "pending",
      reference: await refFor(db, c),
      at: iso(c.paid_at ?? c.decided_at ?? c.created_at),
      amountCents: declined ? 0 : Number(c.approved_cents ?? 0),
      solanaSignature: declined ? c.decision_signature : c.solana_signature,
      hospital: c.hospital,
      category: c.category,
      summary: c.description,
      chargesCents: Number(c.total_cents),
      insurerPaidCents: Number(c.insurer_cents),
      hospitalAssistanceCents: Number(c.assistance_cents),
      needScore: c.score == null ? null : Number(c.score),
      region: c.region,
    });
  }
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const totals = { donatedCents: 0, paidCents: 0, careCostCents: 0, cases: 0, declined: 0 };
  for (const e of entries) {
    if (e.kind === "donation") totals.donatedCents += e.amountCents;
    else {
      totals.cases++;
      totals.careCostCents += e.chargesCents ?? 0;
      if (e.kind === "payout") totals.paidCents += e.amountCents;
      if (e.kind === "declined") totals.declined++;
    }
  }
  return { entries, totals };
}

/** Find the grant behind a public reference (decided cases only). */
async function grantIdForRef(db: Db, ref: string): Promise<string> {
  if (!/^[A-Za-z0-9_:-]{1,64}$/.test(ref)) throw new CoreError("bad_request", "Bad reference");
  const { rows } = await db.query<{ id: string }>("select id from grants where public_ref = $1", [ref]);
  if (rows[0]) return rows[0].id;
  // Grants decided before public_ref existed: derive their references once.
  const { rows: older } = await db.query<{ id: string; public_ref: string | null }>(
    "select id, public_ref from grants where public_ref is null and visit_id is not null",
  );
  for (const g of older) if ((await refFor(db, g)) === ref) return g.id;
  throw new CoreError("not_found", "No case with that reference");
}

export async function getLedgerCase(db: Db, ref: string): Promise<LedgerCase> {
  const grantId = await grantIdForRef(db, ref);
  const grant = await getGrant(db, grantId);
  if (!grant.visit) throw new CoreError("not_found", "No case with that reference");
  if (grant.status === "pending_review" || grant.status === "draft" || grant.status === "canceled") {
    throw new CoreError("not_found", "This case hasn't been decided yet");
  }
  const bill = await getBill(db, grant.visit.id);

  const { rows: pRows } = await db.query<{
    region: string | null;
    age_band: string | null;
    household_size: number | null;
    monthly_income_cents: number | null;
    insurance_status: LedgerCase["patient"]["insurance"];
  }>("select region, age_band, household_size, monthly_income_cents, insurance_status from patients where id = $1", [
    grant.patient.id,
  ]);
  const p = pRows[0];
  const { rows: nRows } = await db.query<{
    score: number;
    formula_version: string;
    inputs: NeedInput | string;
    assessment: NeedAssessment | string;
    suspicious: SuspiciousContent | string | null;
  }>("select score, formula_version, inputs, assessment, suspicious from need_assessments where grant_id = $1", [grantId]);
  const n = nRows[0];
  const parse = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
  const assessment = n ? parse(n.assessment) : null;
  const inputs = n ? parse(n.inputs) : null;

  const { rows: rRows } = await db.query<{ n: number }>(
    "select count(*)::int as n from identity_reveals where grant_id = $1",
    [grantId],
  );
  const { rows: gRows } = await db.query<{ public_ref: string | null; decision_signature: string | null; decision_note: string | null }>(
    "select public_ref, decision_signature, decision_note from grants where id = $1",
    [grantId],
  );
  const g = gRows[0];

  const monthly = p?.monthly_income_cents == null ? null : Number(p.monthly_income_cents);
  const size = p?.household_size ?? null;
  const signature = grant.status === "rejected" ? g?.decision_signature ?? null : grant.receipt?.solanaSignature ?? null;

  return {
    reference: await refFor(db, { id: grantId, public_ref: g?.public_ref ?? null }),
    status: grant.status,
    visit: {
      date: bill.visit.date,
      hospital: bill.visit.hospital,
      category: bill.visit.category,
      description: bill.visit.description,
      lineItems: bill.visit.lineItems,
      totalCents: bill.visit.totalCents,
      attestedBy: bill.visit.attestedBy,
    },
    steps: bill.steps,
    chargesCents: bill.chargesCents,
    insurerPaidCents: bill.insurerPaidCents,
    hospitalAssistanceCents: bill.hospitalAssistanceCents,
    fundPaidCents: bill.fundPaidCents,
    patientPaidCents: bill.patientPaidCents,
    remainingCents: bill.remainingCents,
    plan: bill.plan,
    insurance: bill.insurance,
    applications: bill.applications.map((a) => ({
      name: a.policy.name,
      kind: a.policy.kind,
      source: a.policy.source,
      status: a.status,
      reductionCents: a.reductionCents,
      reason: a.evaluation.reason,
      criteria: a.evaluation.criteria.map((c) => ({ label: c.label, met: c.met, detail: c.detail })),
    })),
    patient: {
      region: p?.region ?? null,
      ageBand: p?.age_band ?? null,
      householdSize: size,
      monthlyIncomeCents: monthly,
      incomePctOfPoverty:
        assessment?.incomePctOfPoverty ??
        (monthly != null && size != null ? Math.round(((monthly * 12) / povertyLineCents(size)) * 100) : null),
      insurance: p?.insurance_status ?? null,
      priorPaidCount90d: inputs?.priorPaidCount90d ?? 0,
    },
    need: assessment
      ? {
          score: Number(n.score),
          formulaVersion: n.formula_version,
          factors: assessment.factors,
          incomeMismatch: assessment.incomeMismatch != null,
        }
      : null,
    suspicious: bill.suspiciousContent ?? (n?.suspicious ? parse(n.suspicious) : null),
    decision: {
      requestedCents: grant.requestedCents,
      approvedCents: grant.approvedCents,
      note: g?.decision_note ?? null,
      requestedAt: grant.createdAt,
      decidedAt: grant.decidedAt,
      paidAt: grant.paidAt,
      approvals: grant.approvals.map((a) => ({ reviewerLabel: a.reviewerLabel, approvedCents: a.approvedCents, at: a.at })),
    },
    payout: {
      nessiePaymentId: grant.receipt?.nessiePaymentId ?? null,
      solanaSignature: signature,
      explorerUrl: signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : null,
    },
    identityReveals: rRows[0]?.n ?? 0,
  };
}

/**
 * Reveal a case's identity to a caseworker. The route has already checked the reviewer device;
 * this logs the reveal (device, reason, time) before returning anything.
 */
export async function revealIdentity(
  db: Db,
  ref: string,
  device: { id: string; label: string },
  reason?: string | null,
): Promise<IdentityRevealResponse> {
  const grantId = await grantIdForRef(db, ref);
  const { rows } = await db.query<{
    patient_id: string;
    legal_name: string | null;
    date_of_birth: string | null;
    ssn: string | null;
    address: string | null;
    phone: string | null;
    member_id: string | null;
    fictional: boolean | null;
    display_name: string;
  }>(
    `select g.patient_id, i.legal_name, to_char(i.date_of_birth, 'YYYY-MM-DD') as date_of_birth, i.ssn, i.address, i.phone, i.member_id, i.fictional,
            p.display_name
       from grants g
       join patients p on p.id = g.patient_id
       left join patient_identities i on i.patient_id = g.patient_id
      where g.id = $1`,
    [grantId],
  );
  const r = rows[0];
  if (!r) throw new CoreError("not_found", "No case with that reference");
  const { rows: logged } = await db.query<{ created_at: Date }>(
    `insert into identity_reveals (id, patient_id, grant_id, device_id, reason)
     values ($1, $2, $3, $4, $5) returning created_at`,
    [newId("rev"), r.patient_id, grantId, device.id, reason?.trim().slice(0, 300) || null],
  );
  const { rows: count } = await db.query<{ n: number }>(
    "select count(*)::int as n from identity_reveals where grant_id = $1",
    [grantId],
  );
  return {
    identity: {
      legalName: r.legal_name ?? r.display_name,
      dateOfBirth: r.date_of_birth ?? "not on file",
      ssn: r.ssn ?? "not on file",
      address: r.address,
      phone: r.phone,
      memberId: r.member_id,
      fictional: r.fictional ?? true,
    },
    revealedBy: device.label,
    revealedAt: iso(logged[0].created_at),
    identityReveals: count[0]?.n ?? 1,
  };
}
