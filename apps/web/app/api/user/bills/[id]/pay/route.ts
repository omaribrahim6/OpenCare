// POST /api/user/bills/:id/pay: the signed-in patient pays what's left on one of their bills out of
// pocket (simulated), after the community fund covered part of it or declined. The body's
// amountCents must match the balance they were shown.

import type { PortalPayRequest, PortalPayResponse } from "@abdulcare/contracts";
import { getDb, payPatientBalance, requirePortalPatient } from "@abdulcare/core";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";
import { readPortalCookie } from "../../../portal-cookie";

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const body = await readJson<Partial<PortalPayRequest>>(req);
  return ok<PortalPayResponse>(await payPatientBalance(db, { patientId: patient.id, visitId: id, amountCents: body.amountCents }));
});
