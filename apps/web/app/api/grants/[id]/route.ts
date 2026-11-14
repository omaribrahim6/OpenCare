// GET /api/grants/:id: status and receipt. Polling this reconciles a pending payout (SPEC §5).
// Allowed: reviewers (with the case screen), the grant's hospital device, and the patient's own
// kiosk session (with the updated bill).

import type { GrantResponse } from "@abdulcare/contracts";
import { CoreError, getBill, getCaseDetail, getDb, getGrant } from "@abdulcare/core";
import { reconcileGrant } from "@abdulcare/payments";
import { optionalSessionPatient, requireDevice } from "@/app/api/_lib/auth";
import { billEngine, needEngine, payments } from "@/app/api/_lib/deps";
import { ok, route, type IdParams } from "@/app/api/_lib/http";

export const maxDuration = 30;

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const device = await requireDevice(["kiosk", "hospital", "provider", "reviewer"]);
  const db = getDb();
  let grant = await getGrant(db, id);

  if ((device.role === "provider" || device.role === "hospital") && grant.provider.id !== device.providerId) {
    throw new CoreError("forbidden", "This grant is for another hospital");
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

  const body: GrantResponse = { grant };
  if (grant.visit && device.role === "reviewer") {
    body.case = (await getCaseDetail(db, { need: needEngine, bills: billEngine }, id)) ?? undefined;
  } else if (grant.visit && device.role === "kiosk") {
    body.bill = await getBill(db, grant.visit.id, { patientId: grant.patient.id });
  }
  return ok<GrantResponse>(body);
});
