// The other lanes' server packages, wired for route handlers. Payments needs the Nessie env
// vars; until they are set on Vercel, routes that touch Nessie answer upstream_error.

import type { BillEngine } from "@abdulcare/contracts";
import * as ai from "@abdulcare/ai";
import { estimateMonthlyIncomeCents } from "@abdulcare/ai";
import { CoreError, fallbackBillEngine, getDb, getPatientWithProfile } from "@abdulcare/core";
import { listIncomeDeposits, paymentsFromEnv, type PaymentsDeps } from "@abdulcare/payments";

export { needEngine } from "@abdulcare/ai";

/**
 * Rev 6 policy rules, application text, briefs and explanations. Uses @abdulcare/ai's engine once
 * it exports `billEngine`; until then, core's deterministic fallback keeps the pipeline running.
 */
export const billEngine: BillEngine =
  (ai as unknown as { billEngine?: BillEngine }).billEngine ?? fallbackBillEngine;

export function payments(): PaymentsDeps {
  try {
    return paymentsFromEnv(getDb());
  } catch (err) {
    console.error("[api] payments not configured:", (err as Error).message);
    throw new CoreError("upstream_error", "Banking is not configured on this deployment yet");
  }
}

/** Monthly income from the patient's last 90 days of Nessie deposits, or null if unavailable. */
export async function depositIncomeCents(patientId: string): Promise<number | null> {
  try {
    const { nessieAccountId } = await getPatientWithProfile(getDb(), patientId);
    if (!nessieAccountId) return null;
    return estimateMonthlyIncomeCents(await listIncomeDeposits(payments().nessie, nessieAccountId));
  } catch (err) {
    console.error("[api] deposit income estimate unavailable:", (err as Error).message);
    return null;
  }
}

/** Demo conversion for devnet SOL donations (devnet SOL has no real value; SPEC §8). */
export function centsPerDevnetSol(): number {
  const value = Number(process.env.SOL_DONATION_CENTS_PER_SOL ?? 10_000);
  return Number.isFinite(value) && value > 0 ? value : 10_000;
}
