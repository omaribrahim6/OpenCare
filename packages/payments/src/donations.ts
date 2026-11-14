// Card donations (SPEC §8): a Nessie deposit into the fund account, recorded as a `donation` fund
// event with a memo-only Solana receipt. No card details ever reach this code: it's mock banking,
// and the donor only picks an amount.

import { createHash, randomBytes } from "node:crypto";
import { addDonation, CoreError } from "@abdulcare/core";
import { dollarsToCents } from "./money";
import type { PaymentsDeps } from "./redeem";
import { explorerTxUrl, sendReceipt, verifySolDonation } from "./solana";

export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 1_000_000;

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface DonationReceipt {
  depositId: string;
  amountCents: number;
  solanaSignature: string | null;
  explorerUrl: string | null;
  /** True when this idempotency key was already used: nothing new was charged or recorded. */
  duplicate: boolean;
}

function donationMemo(key: string): string {
  return `ac_don_${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

/**
 * Donate by card. Pass the same `idempotencyKey` on a retry (e.g. from the form) and the second
 * call returns the first donation instead of depositing twice.
 */
export async function donateByCard(
  deps: PaymentsDeps,
  input: { amountCents: number; idempotencyKey?: string },
): Promise<DonationReceipt> {
  const { amountCents } = input;
  if (!Number.isInteger(amountCents) || amountCents < MIN_DONATION_CENTS || amountCents > MAX_DONATION_CENTS) {
    throw new CoreError("bad_request", "Donations must be between $1 and $10,000, in whole cents");
  }
  if (input.idempotencyKey !== undefined && !KEY_PATTERN.test(input.idempotencyKey)) {
    throw new CoreError("bad_request", "idempotencyKey must be 8–64 letters, digits, _ or -");
  }
  const key = input.idempotencyKey ?? randomBytes(12).toString("base64url");
  const description = `AbdulCare donation ${key}`;

  if (input.idempotencyKey) {
    const existing = (await deps.nessie.listDeposits(deps.fundAccountId)).find((d) => d.description?.includes(key));
    if (existing) {
      return {
        depositId: existing._id,
        amountCents: dollarsToCents(existing.amount),
        solanaSignature: null,
        explorerUrl: null,
        duplicate: true,
      };
    }
  }

  const deposit = await deps.nessie.createDeposit(deps.fundAccountId, { amountCents, description });

  let signature: string | null = null;
  if (deps.solana) {
    try {
      ({ signature } = await sendReceipt(deps.solana, { memo: donationMemo(key), lamports: 0 }));
    } catch (err) {
      deps.log?.(`donation receipt: ${(err as Error).message}`);
    }
  }
  await addDonation(deps.db, amountCents, signature ?? undefined);

  return {
    depositId: deposit._id,
    amountCents,
    solanaSignature: signature,
    explorerUrl: signature ? explorerTxUrl(signature) : null,
    duplicate: false,
  };
}

/**
 * Record a devnet SOL donation the donor already sent to the treasury. `centsPerSol` is the
 * fund's fixed demo rate (devnet SOL has no real value). Each signature counts once.
 */
export async function recordSolDonation(
  deps: PaymentsDeps,
  input: { signature: string; centsPerSol: number },
): Promise<{ lamports: number; amountCents: number; duplicate: boolean }> {
  if (!deps.solana) throw new CoreError("internal", "Solana is not configured");
  const { rows } = await deps.db.query("select 1 from fund_events where type = 'donation' and solana_signature = $1", [
    input.signature,
  ]);
  const found = await verifySolDonation(deps.solana, input.signature);
  if (!found) throw new CoreError("bad_request", "That signature isn't a confirmed transfer to the fund treasury");
  const amountCents = Math.round((found.lamports / 1e9) * input.centsPerSol);
  if (rows[0]) return { lamports: found.lamports, amountCents, duplicate: true };
  if (amountCents > 0) await addDonation(deps.db, amountCents, input.signature);
  return { lamports: found.lamports, amountCents, duplicate: false };
}
