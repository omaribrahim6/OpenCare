// GET /api/grants/:id: status and receipt. Polling this reconciles a pending payout (SPEC §5).
// Allowed: caseworkers, the grant's provider device, and the patient's own kiosk session.

import type { GrantResponse } from "@abdulcare/contracts";
import { CoreError, getDb, getGrant } from "@abdulcare/core";
import { reconcileGrant } from "@abdulcare/payments";
import { optionalSessionPatient, requireDevice } from "@/app/api/_lib/auth";
import { payments } from "@/app/api/_lib/deps";
import { ok, route, type IdParams } from "@/app/api/_lib/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const device = await requireDevice(["kiosk", "provider", "reviewer"]);
  let grant = await getGrant(getDb(), id);

  if (device.role === "provider" && grant.provider.id !== device.providerId) {
    throw new CoreError("forbidden", "This grant is for another provider");
  }
  if (device.role === "kiosk") {
    const patient = await optionalSessionPatient(device);
    if (!patient) throw new CoreError("unauthenticated", "No active patient session. Tap the CareCard again.");
    if (patient.id !== grant.patient.id) throw new CoreError("forbidden", "Not this patient's request");
  }

  if (grant.status === "payment_pending" || (grant.status === "paid" && grant.receipt?.receiptStatus !== "receipt_confirmed")) {
    try {
      grant = await reconcileGrant(payments(), id);
    } catch (err) {
      console.error("[api] reconcile failed; returning stored state:", (err as Error).message);
    }
  }
  return ok<GrantResponse>({ grant });
});
