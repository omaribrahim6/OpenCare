// Grant state machine (SPEC §8). Every money rule is enforced in SQL so retries,
// double taps and concurrent requests can't pay twice or overspend the fund.

import type { ConfirmedFields, Grant, GrantDecisionRequest, GrantStatus } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, hmac, isPositiveCents, iso, isoOrNull, newId, requireEnv } from "./util";

interface GrantRow {
  id: string;
  patient_id: string;
  patient_name: string;
  document_id: string;
  provider_id: string;
  provider_name: string;
  provider_kind: string;
  program_id: string;
  program_name: string;
  requested_cents: number;
  approved_cents: number | null;
  status: GrantStatus;
  confirmed: ConfirmedFields | null;
  warnings: string[] | null;
  created_at: Date;
  decided_at: Date | null;
  paid_at: Date | null;
  nessie_external_id: string | null;
  solana_signature: string | null;
  solana_status: string | null;
}

const GRANT_SELECT = `
  select g.id, g.patient_id, p.display_name as patient_name, g.document_id,
         g.provider_id, pr.name as provider_name, pr.kind as provider_kind,
         g.program_id, g.program_name, g.requested_cents, g.approved_cents, g.status,
         d.confirmed, d.warnings, g.created_at, g.decided_at, g.paid_at,
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
    join documents d on d.id = g.document_id`;

const EMPTY_FIELDS: ConfirmedFields = {
  provider: null,
  documentType: null,
  currency: null,
  totalCents: null,
  date: null,
};

function toGrant(row: GrantRow): Grant {
  const started = ["payment_pending", "paid"].includes(row.status);
  return {
    id: row.id,
    patient: { id: row.patient_id, displayName: row.patient_name },
    documentId: row.document_id,
    provider: { id: row.provider_id, name: row.provider_name, kind: row.provider_kind },
    programId: row.program_id,
    programName: row.program_name,
    requestedCents: Number(row.requested_cents),
    approvedCents: row.approved_cents == null ? null : Number(row.approved_cents),
    status: row.status,
    confirmedFields: row.confirmed ?? EMPTY_FIELDS,
    warnings: row.warnings ?? [],
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

/** Patient asks for help with a confirmed document. One grant per document. */
export async function createGrant(
  db: Db,
  input: {
    patientId: string;
    documentId: string;
    providerId: string;
    programId: string;
    programName: string;
    requestedCents: number;
  },
): Promise<Grant> {
  if (!isPositiveCents(input.requestedCents)) {
    throw new CoreError("bad_request", "requestedCents must be a positive integer");
  }
  if (!input.programId || !input.programName) throw new CoreError("bad_request", "A program is required");

  const { rows: docs } = await db.query<{ patient_id: string; status: string; confirmed: ConfirmedFields | null }>(
    "select patient_id, status, confirmed from documents where id = $1",
    [input.documentId],
  );
  const doc = docs[0];
  if (!doc) throw new CoreError("not_found", "Document not found");
  if (doc.patient_id !== input.patientId) throw new CoreError("forbidden", "Not this patient's document");
  if (doc.status !== "confirmed") throw new CoreError("invalid_state", "Confirm the document's fields first");
  const total = doc.confirmed?.totalCents;
  if (total != null && input.requestedCents > total) {
    throw new CoreError("bad_request", "Requested amount is more than the bill");
  }

  const { rows: providers } = await db.query("select id from providers where id = $1", [input.providerId]);
  if (!providers[0]) throw new CoreError("not_found", "Unknown provider");

  const id = newId("grt");
  try {
    await db.query(
      `insert into grants (id, patient_id, document_id, provider_id, program_id, program_name, requested_cents)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.patientId, input.documentId, input.providerId, input.programId, input.programName, input.requestedCents],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new CoreError("conflict", "A request already exists for this document");
    }
    throw err;
  }
  return getGrant(db, id);
}

/** Reviewer approves (reserving fund budget atomically) or rejects a pending request. */
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
    if (cents > Number(grant.requested_cents)) {
      throw new CoreError("bad_request", "Can't approve more than was requested");
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
