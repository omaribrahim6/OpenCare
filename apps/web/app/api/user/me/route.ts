// GET /api/user/me: the signed-in patient's account for /user: profile, insurance, every bill and
// every claim. A claim whose payout is still settling is reconciled first, so the status is fresh.

import type { PortalOverviewResponse } from "@abdulcare/contracts";
import { getDb, getPortalOverview, requirePortalPatient } from "@abdulcare/core";
import { reconcileGrant, sendPatientPaymentReceipt } from "@abdulcare/payments";
import { after } from "next/server";
import { payments } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";
import { readPortalCookie } from "../portal-cookie";
import { payFromLabel, paymentReceipts } from "../receipts";

export const maxDuration = 30;

export const GET = route(async () => {
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const overview = await withReceipts(await getPortalOverview(db, patient));

  const settling = overview.claims.filter(
    (g) => g.status === "payment_pending" || (g.status === "paid" && g.receipt?.receiptStatus !== "receipt_confirmed"),
  );
  if (settling.length === 0) return ok<PortalOverviewResponse>(overview);

  for (const g of settling.slice(0, 3)) {
    try {
      await reconcileGrant(payments(), g.id);
    } catch (err) {
      console.error("[api] portal reconcile failed; showing stored state:", (err as Error).message);
    }
  }
  return ok<PortalOverviewResponse>(await withReceipts(await getPortalOverview(db, patient)));
});

/** Adds the patient's payment receipts. A payment still missing its Solana record gets one after the
 *  response (two at most per load), so it shows on the next visit. */
async function withReceipts(overview: PortalOverviewResponse): Promise<PortalOverviewResponse> {
  try {
    const [receipts, payFrom] = await Promise.all([
      paymentReceipts(getDb(), overview.patient.id, overview.bills),
      payFromLabel(getDb(), overview.patient.id),
    ]);
    const missing = receipts.filter((r) => !r.solanaSignature).slice(0, 2);
    if (missing.length > 0) {
      after(async () => {
        try {
          const deps = payments();
          for (const r of missing) await sendPatientPaymentReceipt(deps, { visitId: r.visitId, amountCents: r.amountCents });
        } catch (err) {
          console.error("[api] payment receipt backfill deferred:", (err as Error).message);
        }
      });
    }
    return { ...overview, receipts, payFrom };
  } catch (err) {
    console.error("[api] payment receipts unavailable:", (err as Error).message);
    return overview;
  }
}
