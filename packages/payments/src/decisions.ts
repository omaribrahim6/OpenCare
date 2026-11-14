// Devnet receipt for a declined request (fraud resistance): no money moves, but the decision still
// gets a public, memo-only Solana record under the case's opaque reference, so the ledger can show
// that every decision was recorded, not just payouts.

import { payoutReference, type Db } from "@abdulcare/core";
import type { PaymentsDeps } from "./redeem";
import { sendReceipt } from "./solana";

async function caseReference(db: Db, grantId: string, stored: string | null): Promise<string> {
  if (stored) return stored;
  const ref = payoutReference(grantId);
  await db.query("update grants set public_ref = $2 where id = $1 and public_ref is null", [grantId, ref]);
  return ref;
}

/**
 * Record a declined grant's decision on devnet. Safe to call more than once: it does nothing for a
 * grant that isn't rejected or already has a receipt. Never throws; returns the signature or null.
 * Only a confirmed signature is stored, so the ledger never links to a transaction that didn't land
 * (`npm run receipts:backfill` retries the rest).
 */
export async function sendDecisionReceipt(deps: PaymentsDeps, grantId: string): Promise<string | null> {
  if (!deps.solana) return null;
  try {
    const { rows } = await deps.db.query<{ status: string; public_ref: string | null; decision_signature: string | null }>(
      "select status, public_ref, decision_signature from grants where id = $1",
      [grantId],
    );
    const g = rows[0];
    if (!g || g.status !== "rejected") return null;
    if (g.decision_signature) return g.decision_signature;
    const memo = await caseReference(deps.db, grantId, g.public_ref);
    const { signature, status } = await sendReceipt(deps.solana, { memo, lamports: 0 });
    if (status !== "confirmed") return null;
    await deps.db.query("update grants set decision_signature = $2 where id = $1 and decision_signature is null", [grantId, signature]);
    return signature;
  } catch (err) {
    deps.log?.(`decision receipt for ${grantId}: ${(err as Error).message}`);
    return null;
  }
}
