// GET /api/user/me: the signed-in patient's account for /user: profile, insurance, every bill and
// every claim. A claim whose payout is still settling is reconciled first, so the status is fresh.

import type { PortalOverviewResponse } from "@abdulcare/contracts";
import { getDb, getPortalOverview, requirePortalPatient } from "@abdulcare/core";
import { reconcileGrant } from "@abdulcare/payments";
import { payments } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";
import { readPortalCookie } from "../portal-cookie";

export const maxDuration = 30;

export const GET = route(async () => {
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const overview = await getPortalOverview(db, patient);

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
  return ok<PortalOverviewResponse>(await getPortalOverview(db, patient));
});
