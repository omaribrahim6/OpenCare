// Grant redemption (SPEC §8): exactly one Nessie payout and one Solana receipt per approved grant.
//
// Every external call is preceded by a payment_attempts row (one live row per grant and rail, enforced
// by the database). Uncertain results are left `pending` and reconciled by reading back, never by
// trying again blindly. The Solana receipt never blocks or repeats the payout.

import type { Grant } from "@abdulcare/contracts";
import {
  claimForRedemption,
  completePayout,
  CoreError,
  createAttempt,
  getGrant,
  getLiveAttempt,
  payoutReference,
  recordReceiptEvent,
  releaseClaim,
  updateAttempt,
  type Db,
  type PaymentAttempt,
} from "@abdulcare/core";
import { dollarsToCents } from "./money";
import { NessieClient, NessieError, type NessiePurchase } from "./nessie";
import { nessieFingerprint, reserveForPayout } from "./rails";
import {
  broadcast,
  buildReceipt,
  checkSignature,
  isRejectedBeforeSend,
  signatureOf,
  solanaFromEnv,
  waitForSignature,
  type SolanaConfig,
} from "./solana";

export interface PaymentsDeps {
  db: Db;
  nessie: NessieClient;
  /** The community fund's Nessie account; every payout and card donation goes through it. */
  fundAccountId: string;
  /** Null when Solana isn't configured: payouts still run, receipts are skipped. */
  solana: SolanaConfig | null;
  /** How long a Nessie attempt with no matching purchase stays `pending` before it counts as failed. */
  nessieGraceMs?: number;
  /**
   * The fund's reserved Nessie account (linked rails). When set, an approval is transferred here
   * first and the hospital is paid from it, so "available" and "reserved" are real accounts.
   */
  reservedAccountId?: string;
  log?: (message: string) => void;
}

export function paymentsFromEnv(db: Db): PaymentsDeps {
  const fundAccountId = process.env.NESSIE_FUND_ACCOUNT_ID;
  if (!fundAccountId) throw new Error("NESSIE_FUND_ACCOUNT_ID is not set (run npm run nessie:seed -w @abdulcare/payments)");
  return {
    db,
    nessie: NessieClient.fromEnv(),
    fundAccountId,
    reservedAccountId: process.env.NESSIE_RESERVED_ACCOUNT_ID || undefined,
    solana: solanaFromEnv(),
    log: (message) => console.error(`[payments] ${message}`),
  };
}

/** Where payouts are paid from: the reserved account when set up, else the fund account. */
function payoutAccount(deps: PaymentsDeps): string {
  return deps.reservedAccountId || deps.fundAccountId;
}

const DEFAULT_GRACE_MS = 2 * 60_000;

export type PayoutState = "paid" | "pending";

export interface RedeemResult {
  grant: Grant;
  /** "pending" means the payout result is uncertain; poll GET /api/grants/:id to reconcile. */
  payout: PayoutState;
}

/**
 * Provider-confirmed redemption. The route handler has already checked the provider device and
 * the patient's card tap; this claims the grant once and pays it. Safe to call repeatedly.
 */
export async function redeemGrant(
  deps: PaymentsDeps,
  input: { grantId: string; providerId: string; patientId: string },
): Promise<RedeemResult> {
  const { grant } = await claimForRedemption(deps.db, input);
  const payout = grant.status === "paid" ? "paid" : await settleNessie(deps, input.grantId);
  if (payout === "paid") await settleReceiptSafely(deps, input.grantId);
  return { grant: await getGrant(deps.db, input.grantId), payout };
}

/**
 * Reconcile a grant's payout and receipt, for status polling (GET /api/grants/:id). Never starts
 * a payout for a grant that wasn't claimed, and never throws for an upstream failure.
 */
export async function reconcileGrant(deps: PaymentsDeps, grantId: string): Promise<Grant> {
  const grant = await getGrant(deps.db, grantId);
  try {
    if (grant.status === "payment_pending") {
      if ((await settleNessie(deps, grantId)) === "paid") await settleReceiptSafely(deps, grantId);
    } else if (grant.status === "paid") {
      await settleReceiptSafely(deps, grantId);
    }
  } catch (err) {
    if (!(err instanceof CoreError && err.code === "upstream_error")) throw err;
    deps.log?.(`reconcile ${grantId}: ${err.message}`);
  }
  return getGrant(deps.db, grantId);
}

// Payout target, always read from approved server records (SPEC §8): never from the client.

interface PayoutTarget {
  status: string;
  approvedCents: number;
  merchantId: string | null;
  solanaWallet: string | null;
  billNessieId: string | null;
}

async function loadTarget(db: Db, grantId: string): Promise<PayoutTarget> {
  const { rows } = await db.query<{
    status: string;
    approved_cents: number | null;
    nessie_merchant_id: string | null;
    solana_wallet: string | null;
    source: string | null;
    nessie_id: string | null;
  }>(
    `select g.status, g.approved_cents, p.nessie_merchant_id, p.solana_wallet, d.source, d.nessie_id
       from grants g
       join providers p on p.id = g.provider_id
       left join documents d on d.id = g.document_id
      where g.id = $1`,
    [grantId],
  );
  const row = rows[0];
  if (!row) throw new CoreError("not_found", "Grant not found");
  return {
    status: row.status,
    approvedCents: Number(row.approved_cents ?? 0),
    merchantId: row.nessie_merchant_id,
    solanaWallet: row.solana_wallet,
    billNessieId: row.source === "nessie_bill" ? row.nessie_id : null,
  };
}

/** Description on the fund's Nessie purchase; carries the idempotency key for reconciliation. */
export function payoutDescription(idempotencyKey: string): string {
  return `AbdulCare grant payout ${idempotencyKey}`;
}

/**
 * What the Nessie purchase moves for an approval. Nessie's sandbox keeps whole dollars only (it
 * truncates cents), so it moves the whole-dollar part; our records keep the exact approved cents,
 * the same split history-seed uses.
 */
export function nessiePayoutCents(approvedCents: number): number {
  return approvedCents - (approvedCents % 100);
}

function matchesPayout(p: NessiePurchase, target: PayoutTarget): boolean {
  const moved = dollarsToCents(p.amount);
  return p.merchant_id === target.merchantId && (moved === nessiePayoutCents(target.approvedCents) || moved === target.approvedCents);
}

// Nessie rail

async function settleNessie(deps: PaymentsDeps, grantId: string): Promise<PayoutState> {
  const { db, nessie } = deps;
  const target = await loadTarget(db, grantId);
  if (target.status === "paid") return "paid";
  if (target.status !== "payment_pending") {
    throw new CoreError("invalid_state", `Grant is ${target.status}; it must be claimed before payout`);
  }
  if (!target.merchantId) throw new CoreError("internal", "The provider has no Nessie merchant on file");

  let attempt = await getLiveAttempt(db, grantId, "nessie");

  if (attempt?.status === "pending") {
    const outcome = await reconcileNessieAttempt(deps, attempt, target);
    if (outcome === "pending") return "pending";
    if (outcome === "failed") {
      await releaseClaim(db, grantId);
      throw new CoreError("upstream_error", "The Nessie payout didn't go through. Tap again to retry.");
    }
    attempt = await getLiveAttempt(db, grantId, "nessie");
  }

  if (!attempt) {
    try {
      attempt = await createAttempt(db, {
        grantId,
        rail: "nessie",
        recipient: target.merchantId,
        amountCents: target.approvedCents,
      });
    } catch (err) {
      // Another request is paying this grant right now; let it finish.
      if (err instanceof CoreError && err.code === "conflict") return "pending";
      throw err;
    }

    // Linked rails: move the approval into the reserved account first (no-op when not set up).
    await reserveForPayout(deps, grantId, target.approvedCents);

    let purchase: NessiePurchase;
    try {
      purchase = await nessie.createPurchase(payoutAccount(deps), {
        merchantId: target.merchantId,
        amountCents: nessiePayoutCents(target.approvedCents),
        description: payoutDescription(attempt.idempotencyKey),
      });
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof NessieError && !err.uncertain) {
        await updateAttempt(db, attempt.id, { status: "failed", error: message });
        await releaseClaim(db, grantId);
        throw new CoreError("upstream_error", "Nessie refused the payout. Tap again to retry.");
      }
      await updateAttempt(db, attempt.id, { error: `uncertain: ${message}` });
      return "pending";
    }

    await updateAttempt(db, attempt.id, { externalId: purchase._id });
    // Nessie has no webhooks: read the purchase back before calling it confirmed.
    try {
      const readBack = await nessie.findPurchase(payoutAccount(deps), purchase._id);
      if (!readBack || !matchesPayout(readBack, target)) {
        await updateAttempt(db, attempt.id, { error: "Read-back doesn't match the approved payout" });
        return "pending";
      }
    } catch {
      return "pending";
    }
    attempt = await updateAttempt(db, attempt.id, { status: "confirmed", error: null });
  }

  if (attempt.status !== "confirmed") return "pending";
  if (target.billNessieId) {
    try {
      await nessie.completeBill(target.billNessieId);
    } catch (err) {
      // The fund has paid; the patient's bill status is cosmetic and safe to retry later.
      deps.log?.(`complete bill for ${grantId}: ${(err as Error).message}`);
    }
  }
  await completePayout(db, grantId);
  return "paid";
}

async function reconcileNessieAttempt(
  deps: PaymentsDeps,
  attempt: PaymentAttempt,
  target: PayoutTarget,
): Promise<"confirmed" | "pending" | "failed"> {
  const { db, nessie } = deps;

  // Nessie can't fetch one purchase by ID, so search the fund's purchases by ID or by key.
  let purchases: NessiePurchase[];
  try {
    // Older payouts were paid from the fund account itself; search both.
    const accounts = [...new Set([payoutAccount(deps), deps.fundAccountId])];
    purchases = (await Promise.all(accounts.map((a) => nessie.listPurchases(a)))).flat();
  } catch {
    return "pending";
  }
  const match = purchases.find(
    (p) => (attempt.externalId && p._id === attempt.externalId) || p.description?.includes(attempt.idempotencyKey),
  );
  if (match && !matchesPayout(match, target)) return "pending";
  if (match) {
    await updateAttempt(db, attempt.id, { status: "confirmed", externalId: match._id, error: null });
    return "confirmed";
  }

  // Not there. Only call it failed once a late write can no longer land.
  const { rows } = await db.query<{ age_ms: number }>(
    "select extract(epoch from now() - created_at) * 1000 as age_ms from payment_attempts where id = $1",
    [attempt.id],
  );
  if (Number(rows[0]?.age_ms ?? 0) < (deps.nessieGraceMs ?? DEFAULT_GRACE_MS)) return "pending";
  await updateAttempt(db, attempt.id, { status: "failed", error: "No Nessie purchase found after the grace period" });
  return "failed";
}

// Solana rail

async function settleReceiptSafely(deps: PaymentsDeps, grantId: string): Promise<void> {
  try {
    await settleReceipt(deps, grantId);
  } catch (err) {
    // The payout is done either way; the next status poll tries the receipt again.
    deps.log?.(`receipt for ${grantId}: ${(err as Error).message}`);
  }
}

async function settleReceipt(deps: PaymentsDeps, grantId: string): Promise<void> {
  const sol = deps.solana;
  if (!sol) return;
  const { db } = deps;

  const live = await getLiveAttempt(db, grantId, "solana");
  if (live?.status === "confirmed") return;
  if (live?.status === "pending") {
    if (!live.signedTx || live.lastValidBlockHeight == null) {
      await updateAttempt(db, live.id, { status: "failed", error: "Attempt has no signed transaction" });
    } else {
      const signature = live.externalId ?? signatureOf(live.signedTx);
      const status = await checkSignature(sol.connection, signature, live.lastValidBlockHeight);
      if (status === "confirmed") return confirmReceipt(db, live.id, grantId, signature);
      if (status === "pending") {
        // Same bytes, same signature: rebroadcasting can't create a second receipt.
        await broadcastOrFail(db, sol, live.id, live.signedTx);
        return;
      }
      await updateAttempt(db, live.id, { status, error: `Receipt ${status}` });
    }
  }

  const target = await loadTarget(db, grantId);
  const recipient = target.solanaWallet ?? sol.defaultRecipient;
  if (!recipient) throw new Error("No receipt recipient: set the provider's wallet or PROVIDER_SOLANA_WALLET");

  // Linked rails: the memo carries a fingerprint of the Nessie purchase that paid the hospital, so
  // anyone holding the Nessie ID can match the public receipt to the bank record.
  const paid = await getLiveAttempt(db, grantId, "nessie");
  const memo = paid?.externalId
    ? `${payoutReference(grantId)}:nx${nessieFingerprint(paid.externalId).slice(0, 16)}`
    : payoutReference(grantId);
  const receipt = await buildReceipt(sol, { recipient, memo });
  let attempt: PaymentAttempt;
  try {
    attempt = await createAttempt(db, {
      grantId,
      rail: "solana",
      recipient: receipt.recipient,
      lamports: receipt.lamports,
      signedTx: receipt.signedTx,
      lastValidBlockHeight: receipt.lastValidBlockHeight,
    });
  } catch (err) {
    if (err instanceof CoreError && err.code === "conflict") return;
    throw err;
  }
  await updateAttempt(db, attempt.id, { externalId: receipt.signature });

  await broadcastOrFail(db, sol, attempt.id, receipt.signedTx);
  const status = await waitForSignature(sol.connection, receipt.signature, receipt.lastValidBlockHeight);
  if (status === "confirmed") return confirmReceipt(db, attempt.id, grantId, receipt.signature);
  if (status !== "pending") await updateAttempt(db, attempt.id, { status, error: `Receipt ${status}` });
}

/** Broadcast; if the node refused it outright, fail the attempt so the next poll can replace it. */
async function broadcastOrFail(db: Db, sol: SolanaConfig, attemptId: string, signedTx: string): Promise<void> {
  try {
    await broadcast(sol.connection, signedTx);
  } catch (err) {
    if (isRejectedBeforeSend(err)) {
      await updateAttempt(db, attemptId, { status: "failed", error: "Receipt rejected before send (is the treasury funded?)" });
    }
    throw err;
  }
}

/** Mark confirmed and write the ledger entry exactly once, even if two polls race. */
async function confirmReceipt(db: Db, attemptId: string, grantId: string, signature: string): Promise<void> {
  const { rows } = await db.query(
    `update payment_attempts set status = 'confirmed', error = null, updated_at = now()
      where id = $1 and status = 'pending' returning id`,
    [attemptId],
  );
  if (rows[0]) await recordReceiptEvent(db, payoutReference(grantId), signature);
}
