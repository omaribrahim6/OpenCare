// Grant state machine (SPEC §8). Every money rule is enforced in SQL so retries,
// double taps and concurrent requests can't pay twice or overspend the fund.

import {
  type ExpenseCategory,
  MAX_HARDSHIP_NOTE_CHARS,
  SECOND_APPROVAL_ABOVE_CENTS,
  type Grant,
  type GrantApproval,
  type GrantDecisionRequest,
  type GrantStatus,
} from "@abdulcare/contracts";
import type { Db } from "./db";
import { toDocument } from "./documents";
import { getBill } from "./visits";
import { CoreError, hmac, isPositiveCents, iso, isoOrNull, newId, requireEnv } from "./util";

interface GrantRow {
  id: string;
  patient_id: string;
  patient_name: string;
  provider_id: string;
  provider_name: string;
  provider_kind: string;
  requested_cents: number;
  approved_cents: number | null;
  status: GrantStatus;
  hardship_note: string | null;
  created_at: Date;
  decided_at: Date | null;
  paid_at: Date | null;
  approvals: { label: string; cents: number; at: string }[] | string | null;
  nessie_external_id: string | null;
  solana_signature: string | null;
  solana_status: string | null;
  // Document columns, prefixed d_ (rev 5 grants; null for rev 6).
  d_id: string | null;
  d_source: "nessie_bill" | "nessie_purchase";
  d_nessie_id: string;
  d_merchant: string;
  d_description: string | null;
  d_bill_date: Date | string | null;
  d_amount_cents: number;
  d_likely_medical: boolean | null;
  d_category: Grant["bill"]["category"];
  d_created_at: Date;
  // Visit columns, prefixed v_ (rev 6 grants; null for rev 5).
  v_id: string | null;
  v_date: Date | string | null;
  v_category: ExpenseCategory | null;
  v_description: string | null;
  v_total_cents: number | null;
  v_created_at: Date | null;
}

export const GRANT_SELECT = `
  select g.id, g.patient_id, p.display_name as patient_name,
         g.provider_id, pr.name as provider_name, pr.kind as provider_kind,
         g.requested_cents, g.approved_cents, g.status, g.hardship_note,
         g.created_at, g.decided_at, g.paid_at,
         d.id as d_id, d.source as d_source, d.nessie_id as d_nessie_id, d.merchant as d_merchant,
         d.description as d_description, d.bill_date as d_bill_date, d.amount_cents as d_amount_cents,
         d.likely_medical as d_likely_medical, d.category as d_category, d.created_at as d_created_at,
         v.id as v_id, v.visit_date as v_date, v.category as v_category, v.description as v_description,
         v.total_cents as v_total_cents, v.created_at as v_created_at,
         (select coalesce(json_agg(json_build_object('label', dv.label, 'cents', ga.approved_cents,
                                                     'at', ga.created_at) order by ga.created_at), '[]'::json)
            from grant_approvals ga join devices dv on dv.id = ga.reviewer_device_id
           where ga.grant_id = g.id) as approvals,
         (select external_id from payment_attempts a
           where a.grant_id = g.id and a.rail = 'nessie' and a.status = 'confirmed'
           order by a.created_at desc limit 1) as nessie_external_id,
         (select external_id from payment_attempts a
           where a.grant_id = g.id and a.rail = 'solana' and a.status in ('pending', 'confirmed')
           order by a.created_at desc limit 1) as solana_signature,
         (select status from payment_attempts a
           where a.grant_id = g.id and a.rail = 'solana'
           order by a.created_at desc limit 1) as solana_status
    from grants g
    join patients p on p.id = g.patient_id
    join providers pr on pr.id = g.provider_id
    left join documents d on d.id = g.document_id
    left join visits v on v.id = g.visit_id`;

export function toGrant(row: GrantRow): Grant {
  const started = ["payment_pending", "paid"].includes(row.status);
  const raw = typeof row.approvals === "string" ? JSON.parse(row.approvals) : (row.approvals ?? []);
  const approvals: GrantApproval[] = raw.map((a: { label: string; cents: number; at: string }) => ({
    reviewerLabel: a.label,
    approvedCents: Number(a.cents),
    at: iso(a.at),
  }));
  const provider = { id: row.provider_id, name: row.provider_name, kind: row.provider_kind };
  const visit =
    row.v_id == null
      ? null
      : {
          id: row.v_id,
          hospital: provider,
          date: iso(row.v_date).slice(0, 10),
          category: row.v_category as ExpenseCategory,
          description: row.v_description ?? "",
          totalCents: Number(row.v_total_cents),
        };
  // Rev 6 grants have no Nessie document; older screens still read grant.bill, so describe the visit.
  const bill = visit
    ? {
        id: visit.id,
        patientId: row.patient_id,
        source: "nessie_bill" as const,
        nessieId: visit.id,
        merchant: provider.name,
        description: visit.description,
        date: visit.date,
        amountCents: visit.totalCents,
        likelyMedical: true,
        category: visit.category,
        createdAt: iso(row.v_created_at),
      }
    : toDocument({
      id: row.d_id as string,
      patient_id: row.patient_id,
      source: row.d_source,
      nessie_id: row.d_nessie_id,
      merchant: row.d_merchant,
      description: row.d_description,
      bill_date: row.d_bill_date,
      amount_cents: row.d_amount_cents,
      likely_medical: row.d_likely_medical,
      category: row.d_category,
      created_at: row.d_created_at,
    });
  return {
    id: row.id,
    patient: { id: row.patient_id, displayName: row.patient_name },
    visit,
    bill,
    provider,
    requestedCents: Number(row.requested_cents),
    approvedCents: row.approved_cents == null ? null : Number(row.approved_cents),
    status: row.status,
    hardshipNote: row.hardship_note,
    approvals,
    awaitingSecondApproval: row.status === "pending_review" && approvals.length > 0,
    createdAt: iso(row.created_at),
    decidedAt: isoOrNull(row.decided_at),
    paidAt: isoOrNull(row.paid_at),
    receipt: started
      ? {
          nessiePaymentId: row.nessie_external_id,
          solanaSignature: row.solana_signature,
          explorerUrl: row.solana_signature
            ? `https://explorer.solana.com/tx/${row.solana_signature}?cluster=devnet`
            : null,
          receiptStatus: row.solana_status === "confirmed" ? "receipt_confirmed" : "receipt_pending",
        }
      : null,
  };
}

/**
 * Opaque reference for a grant, safe to put on-chain and in the public ledger (SPEC §10).
 * Payments uses it as the Solana memo.
 */
export function payoutReference(grantId: string): string {
  return `ac_${hmac(requireEnv("CARD_TOKEN_PEPPER"), `payout:${grantId}`).slice(0, 20)}`;
}

export async function getGrant(db: Db, grantId: string): Promise<Grant> {
  const { rows } = await db.query<GrantRow>(`${GRANT_SELECT} where g.id = $1`, [grantId]);
  if (!rows[0]) throw new CoreError("not_found", "Grant not found");
  return toGrant(rows[0]);
}

export async function listGrants(
  db: Db,
  filter: { status?: GrantStatus; patientId?: string; providerId?: string } = {},
): Promise<Grant[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) where.push(`g.status = $${params.push(filter.status)}`);
  if (filter.patientId) where.push(`g.patient_id = $${params.push(filter.patientId)}`);
  if (filter.providerId) where.push(`g.provider_id = $${params.push(filter.providerId)}`);
  const sql = `${GRANT_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by g.created_at desc limit 100`;
  const { rows } = await db.query<GrantRow>(sql, params);
  return rows.map(toGrant);
}

/** Patient asks for help with a bill they chose. One grant per document. */
export async function createGrant(
  db: Db,
  input: {
    patientId: string;
    documentId: string;
    providerId: string;
    requestedCents: number;
    hardshipNote?: string | null;
  },
): Promise<Grant> {
  if (!isPositiveCents(input.requestedCents)) {
    throw new CoreError("bad_request", "requestedCents must be a positive integer");
  }
  const note = input.hardshipNote?.trim() || null;
  if (note && note.length > MAX_HARDSHIP_NOTE_CHARS) {
    throw new CoreError("bad_request", `The note can be at most ${MAX_HARDSHIP_NOTE_CHARS} characters`);
  }

  const { rows: docs } = await db.query<{ patient_id: string; amount_cents: number }>(
    "select patient_id, amount_cents from documents where id = $1",
    [input.documentId],
  );
  const doc = docs[0];
  if (!doc) throw new CoreError("not_found", "Document not found");
  if (doc.patient_id !== input.patientId) throw new CoreError("forbidden", "Not this patient's document");
  if (input.requestedCents > Number(doc.amount_cents)) {
    throw new CoreError("bad_request", "Requested amount is more than the bill");
  }

  const { rows: providers } = await db.query("select id from providers where id = $1", [input.providerId]);
  if (!providers[0]) throw new CoreError("not_found", "Unknown provider");

  const id = newId("grt");
  try {
    await db.query(
      `insert into grants (id, patient_id, document_id, provider_id, requested_cents, hardship_note)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, input.patientId, input.documentId, input.providerId, input.requestedCents, note],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new CoreError("conflict", "A request already exists for this bill");
    }
    throw err;
  }
  return getGrant(db, id);
}

/**
 * Rev 6: the patient asks the fund for help with a visit's remaining balance. The server sets the
 * amount (the remaining balance) and the recipient (the visit's hospital). Asking again while a
 * request is live returns that request.
 */
export async function requestHelp(
  db: Db,
  input: { patientId: string; visitId: string; hardshipNote?: string | null },
): Promise<Grant> {
  const note = input.hardshipNote?.trim() || null;
  if (note && note.length > MAX_HARDSHIP_NOTE_CHARS) {
    throw new CoreError("bad_request", `The note can be at most ${MAX_HARDSHIP_NOTE_CHARS} characters`);
  }
  const live = async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from grants where visit_id = $1 and status not in ('rejected', 'canceled')",
      [input.visitId],
    );
    return rows[0]?.id ?? null;
  };
  const bill = await getBill(db, input.visitId, { patientId: input.patientId });
  const existing = await live();
  if (existing) return getGrant(db, existing);
  if (bill.remainingCents <= 0) throw new CoreError("invalid_state", "Nothing is left to pay on this bill");

  const id = newId("grt");
  try {
    await db.query(
      `insert into grants (id, patient_id, visit_id, provider_id, requested_cents, hardship_note)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, input.patientId, input.visitId, bill.visit.hospital.id, bill.remainingCents, note],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      const winner = await live();
      if (winner) return getGrant(db, winner);
    }
    throw err;
  }
  return getGrant(db, id);
}

/**
 * A caseworker approves (reserving fund budget atomically) or rejects a pending request.
 * Above SECOND_APPROVAL_ABOVE_CENTS, the first approval is recorded and the grant stays
 * pending_review; a different caseworker device approving the same amount completes it.
 */
export async function decideGrant(
  db: Db,
  grantId: string,
  reviewerDeviceId: string,
  decision: GrantDecisionRequest,
): Promise<Grant> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ status: GrantStatus; requested_cents: number }>(
      "select status, requested_cents from grants where id = $1 for update",
      [grantId],
    );
    const grant = rows[0];
    if (!grant) throw new CoreError("not_found", "Grant not found");
    if (grant.status !== "pending_review") {
      throw new CoreError("invalid_state", `Grant is ${grant.status}, not pending review`);
    }
    const note = decision.note?.slice(0, 500) ?? null;

    if (decision.decision === "reject") {
      await tx.query(
        `update grants set status = 'rejected', reviewer_device_id = $2, decision_note = $3,
                decided_at = now(), updated_at = now()
          where id = $1`,
        [grantId, reviewerDeviceId, note],
      );
      return;
    }

    const cents = decision.approvedCents;
    if (!isPositiveCents(cents)) throw new CoreError("bad_request", "approvedCents must be a positive integer");
    // Nessie stores whole dollars only, so a payout of cents would be truncated (payments lane).
    if (cents % 100 !== 0) throw new CoreError("bad_request", "Approve whole dollars only");
    if (cents > Number(grant.requested_cents)) {
      throw new CoreError("bad_request", "Can't approve more than was requested");
    }

    const { rows: prior } = await tx.query<{ reviewer_device_id: string; approved_cents: number }>(
      "select reviewer_device_id, approved_cents from grant_approvals where grant_id = $1",
      [grantId],
    );
    if (prior.some((a) => a.reviewer_device_id === reviewerDeviceId)) {
      throw new CoreError("conflict", "You already approved this request; a second caseworker must approve it");
    }
    if (prior[0] && Number(prior[0].approved_cents) !== cents) {
      throw new CoreError("bad_request", `The second approval must match the first amount (${prior[0].approved_cents} cents)`);
    }
    await tx.query(
      "insert into grant_approvals (grant_id, reviewer_device_id, approved_cents) values ($1, $2, $3)",
      [grantId, reviewerDeviceId, cents],
    );
    if (cents > SECOND_APPROVAL_ABOVE_CENTS && prior.length === 0) {
      // The first of two approvals reserves nothing yet, but it must still fit the budget, so no
      // caseworker signs off on an amount the fund can't cover. The second approval checks again.
      const { rows: fund } = await tx.query<{ available: number }>(
        "select total_cents - reserved_cents - paid_cents as available from fund where id = 'community'",
      );
      if (Number(fund[0]?.available ?? 0) < cents) {
        throw new CoreError("insufficient_funds", "The fund doesn't have enough available");
      }
      return; // Recorded; waits for a second caseworker.
    }

    const { rows: reserved } = await tx.query(
      `update fund set reserved_cents = reserved_cents + $1
        where id = 'community' and total_cents - reserved_cents - paid_cents >= $1
        returning id`,
      [cents],
    );
    if (!reserved[0]) throw new CoreError("insufficient_funds", "The fund doesn't have enough available");

    await tx.query(
      `update grants set status = 'approved', approved_cents = $2, reviewer_device_id = $3,
              decision_note = $4, decided_at = now(), updated_at = now()
        where id = $1`,
      [grantId, cents, reviewerDeviceId, note],
    );
    await tx.query(
      "insert into fund_events (type, amount_cents, grant_ref) values ('reservation', $1, $2)",
      [cents, payoutReference(grantId)],
    );
  });
  return getGrant(db, grantId);
}

/** Cancel an approved grant before payment starts, releasing its reservation. */
export async function cancelGrant(db: Db, grantId: string): Promise<Grant> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ approved_cents: number }>(
      `update grants set status = 'canceled', updated_at = now()
        where id = $1 and status = 'approved'
        returning approved_cents`,
      [grantId],
    );
    if (!rows[0]) {
      await getGrant(tx, grantId); // throws not_found if missing
      throw new CoreError("invalid_state", "Only approved grants that haven't started payment can be canceled");
    }
    const cents = Number(rows[0].approved_cents);
    await tx.query("update fund set reserved_cents = reserved_cents - $1 where id = 'community'", [cents]);
    await tx.query(
      "insert into fund_events (type, amount_cents, grant_ref) values ('release', $1, $2)",
      [cents, payoutReference(grantId)],
    );
  });
  return getGrant(db, grantId);
}

/**
 * Atomically claim an approved grant for redemption (SPEC §8). Only the grant's provider,
 * after tapping that patient's card, can claim it. Calling again returns the same grant with
 * claimed=false instead of starting a second payout.
 */
export async function claimForRedemption(
  db: Db,
  input: { grantId: string; providerId: string; patientId: string },
): Promise<{ grant: Grant; claimed: boolean }> {
  const { rows } = await db.query<{ id: string }>(
    `update grants set status = 'payment_pending', updated_at = now()
      where id = $1 and status = 'approved' and provider_id = $2 and patient_id = $3
      returning id`,
    [input.grantId, input.providerId, input.patientId],
  );
  if (rows[0]) return { grant: await getGrant(db, input.grantId), claimed: true };

  const grant = await getGrant(db, input.grantId);
  if (grant.provider.id !== input.providerId) throw new CoreError("forbidden", "This grant is for another provider");
  if (grant.patient.id !== input.patientId) throw new CoreError("forbidden", "The tapped card doesn't match this grant");
  if (grant.status === "payment_pending" || grant.status === "paid") return { grant, claimed: false };
  throw new CoreError("invalid_state", `Grant is ${grant.status}; only approved grants can be redeemed`);
}

/** Payments calls this once the Nessie payout is confirmed. Safe to call twice. */
export async function completePayout(db: Db, grantId: string): Promise<Grant> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ approved_cents: number }>(
      `update grants set status = 'paid', paid_at = now(), updated_at = now()
        where id = $1 and status = 'payment_pending'
        returning approved_cents`,
      [grantId],
    );
    if (!rows[0]) {
      const grant = await getGrant(tx, grantId);
      if (grant.status === "paid") return;
      throw new CoreError("invalid_state", `Grant is ${grant.status}, not payment_pending`);
    }
    const cents = Number(rows[0].approved_cents);
    await tx.query(
      `update fund set reserved_cents = reserved_cents - $1, paid_cents = paid_cents + $1
        where id = 'community'`,
      [cents],
    );
    await tx.query(
      "insert into fund_events (type, amount_cents, grant_ref) values ('payout', $1, $2)",
      [cents, payoutReference(grantId)],
    );
  });
  return getGrant(db, grantId);
}

/**
 * Return a claimed grant to approved so redemption can be retried. Payments calls this ONLY
 * after the Nessie attempt is conclusively failed and reconciled (SPEC §8).
 */
export async function releaseClaim(db: Db, grantId: string): Promise<Grant> {
  const { rows } = await db.query(
    `update grants set status = 'approved', updated_at = now()
      where id = $1 and status = 'payment_pending'
        and not exists (select 1 from payment_attempts a
                         where a.grant_id = $1 and a.rail = 'nessie' and a.status in ('pending', 'confirmed'))
      returning id`,
    [grantId],
  );
  if (!rows[0]) throw new CoreError("invalid_state", "Grant can't be released while a payout is pending or done");
  return getGrant(db, grantId);
}
