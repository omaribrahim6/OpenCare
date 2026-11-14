// The other lanes' server packages, wired for route handlers. Payments needs the Nessie env
// vars; until they are set on Vercel, routes that touch Nessie answer upstream_error.

import { CoreError, getDb } from "@abdulcare/core";
import { paymentsFromEnv, type PaymentsDeps } from "@abdulcare/payments";

export { needEngine } from "@abdulcare/ai";

export function payments(): PaymentsDeps {
  try {
    return paymentsFromEnv(getDb());
  } catch (err) {
    console.error("[api] payments not configured:", (err as Error).message);
    throw new CoreError("upstream_error", "Banking is not configured on this deployment yet");
  }
}

/** Demo conversion for devnet SOL donations (devnet SOL has no real value; SPEC §8). */
export function centsPerDevnetSol(): number {
  const value = Number(process.env.SOL_DONATION_CENTS_PER_SOL ?? 10_000);
  return Number.isFinite(value) && value > 0 ? value : 10_000;
}
