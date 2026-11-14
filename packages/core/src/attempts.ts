// Payment attempt records (SPEC §8), used by the payments lane. Write the attempt BEFORE calling
// Nessie or broadcasting to Solana; the database allows only one live attempt per grant and rail.

import type { AttemptStatus, PaymentRail } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, newId } from "./util";

export interface PaymentAttempt {
  id: string;
  grantId: string;
  rail: PaymentRail;
  idempotencyKey: string;
  amountCents: number | null;
  lamports: number | null;
  recipient: string;
  externalId: string | null;
  signedTx: string | null;
  lastValidBlockHeight: number | null;
  status: AttemptStatus;
  error: string | null;
}

interface AttemptRow {
  id: string;
  grant_id: string;
  rail: PaymentRail;
  idempotency_key: string;
  amount_cents: number | null;
  lamports: number | null;
  recipient: string;
  external_id: string | null;
  signed_tx: string | null;
  last_valid_block_height: number | null;
  status: AttemptStatus;
  error: string | null;
}

const num = (v: unknown) => (v == null ? null : Number(v));

function toAttempt(r: AttemptRow): PaymentAttempt {
  return {
    id: r.id,
    grantId: r.grant_id,
    rail: r.rail,
    idempotencyKey: r.idempotency_key,
    amountCents: num(r.amount_cents),
    lamports: num(r.lamports),
    recipient: r.recipient,
    externalId: r.external_id,
    signedTx: r.signed_tx,
    lastValidBlockHeight: num(r.last_valid_block_height),
    status: r.status,
    error: r.error,
  };
}

/** The pending or confirmed attempt for this grant and rail, if any. */
export async function getLiveAttempt(db: Db, grantId: string, rail: PaymentRail): Promise<PaymentAttempt | null> {
  const { rows } = await db.query<AttemptRow>(
    `select * from payment_attempts
      where grant_id = $1 and rail = $2 and status in ('pending', 'confirmed')`,
    [grantId, rail],
  );
  return rows[0] ? toAttempt(rows[0]) : null;
}

/**
 * Record a new attempt. Throws `conflict` if a live attempt already exists for this grant and
 * rail: reconcile that one instead of starting another (SPEC §8).
 */
export async function createAttempt(
  db: Db,
  input: {
    grantId: string;
    rail: PaymentRail;
    recipient: string;
    amountCents?: number;
    lamports?: number;
    signedTx?: string;
    lastValidBlockHeight?: number;
    /** Defaults to a fresh key; pass one to make the call itself idempotent. */
    idempotencyKey?: string;
  },
): Promise<PaymentAttempt> {
  try {
    const { rows } = await db.query<AttemptRow>(
      `insert into payment_attempts
         (id, grant_id, rail, idempotency_key, amount_cents, lamports, recipient, signed_tx, last_valid_block_height)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        newId("pay"),
        input.grantId,
        input.rail,
        input.idempotencyKey ?? newId("idem"),
        input.amountCents ?? null,
        input.lamports ?? null,
        input.recipient,
        input.signedTx ?? null,
        input.lastValidBlockHeight ?? null,
      ],
    );
    return toAttempt(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new CoreError("conflict", `A ${input.rail} attempt for this grant is already in progress or done`);
    }
    throw err;
  }
}

/** Update an attempt after calling the rail (external ID, final status, error). */
export async function updateAttempt(
  db: Db,
  id: string,
  patch: { status?: AttemptStatus; externalId?: string; error?: string | null },
): Promise<PaymentAttempt> {
  const { rows } = await db.query<AttemptRow>(
    `update payment_attempts
        set status = coalesce($2, status),
            external_id = coalesce($3, external_id),
            error = case when $4::boolean then $5 else error end,
            updated_at = now()
      where id = $1
      returning *`,
    [id, patch.status ?? null, patch.externalId ?? null, patch.error !== undefined, patch.error ?? null],
  );
  if (!rows[0]) throw new CoreError("not_found", "Payment attempt not found");
  return toAttempt(rows[0]);
}

/** Record a public ledger entry for a confirmed Solana receipt (SPEC §8). */
export async function recordReceiptEvent(db: Db, grantRef: string, signature: string): Promise<void> {
  await db.query(
    "insert into fund_events (type, amount_cents, grant_ref, solana_signature) values ('receipt', 0, $1, $2)",
    [grantRef, signature],
  );
}
