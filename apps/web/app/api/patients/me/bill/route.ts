// GET /api/patients/me/bill: the checked-in patient's latest visit, its explanation and their
// fund request for it (SPEC §4 screens 2–4). Polling it moves a pending payout forward.

import type { Grant, PatientBillResponse } from "@abdulcare/contracts";
import { explainBill, getBill, getDb, latestVisitId, listGrants } from "@abdulcare/core";
import { reconcileGrant } from "@abdulcare/payments";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { billEngine, payments } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";

export const maxDuration = 30;

export const GET = route(async () => {
  const { patient } = await requirePatientSession();
  const db = getDb();
  const visitId = await latestVisitId(db, patient.id);
  if (!visitId) return ok<PatientBillResponse>({ bill: null, explanation: null, grant: null });

  let grant: Grant | null = (await listGrants(db, { patientId: patient.id })).find((g) => g.visit?.id === visitId) ?? null;
  if (grant && (grant.status === "payment_pending" || (grant.status === "paid" && grant.receipt?.receiptStatus !== "receipt_confirmed"))) {
    try {
      grant = await reconcileGrant(payments(), grant.id);
    } catch (err) {
      console.error("[api] reconcile failed; returning stored state:", (err as Error).message);
    }
  }
  const bill = await getBill(db, visitId, { patientId: patient.id });
  return ok<PatientBillResponse>({ bill, explanation: await explainBill(db, billEngine, bill), grant });
});
