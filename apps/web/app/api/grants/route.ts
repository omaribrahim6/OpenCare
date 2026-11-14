// POST /api/grants: rev 6, the patient asks the fund for help with a visit's remaining balance
// (RequestHelpRequest); the server sets the amount and the hospital. The rev 5 body (a Nessie
// document) still works until the old screens are gone. The request is assessed at once.
// GET /api/grants: caseworkers list by status; a kiosk sees its patient's requests; a provider
// device sees grants for its pharmacy.

import {
  GRANT_STATUSES,
  type CreateGrantRequest,
  type GrantListResponse,
  type GrantResponse,
  type GrantStatus,
  type RequestHelpRequest,
} from "@abdulcare/contracts";
import { CoreError, assessGrant, createGrant, getBill, getDb, getGrant, listGrants, requestHelp } from "@abdulcare/core";
import { optionalSessionPatient, requireDevice, requirePatientSession } from "@/app/api/_lib/auth";
import { billEngine, depositIncomeCents, needEngine } from "@/app/api/_lib/deps";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const { patient } = await requirePatientSession();
  const body = await readJson<Partial<RequestHelpRequest & CreateGrantRequest>>(req);
  const db = getDb();
  const hardshipNote = typeof body.hardshipNote === "string" ? body.hardshipNote : null;
  const created = body.visitId
    ? await requestHelp(db, { patientId: patient.id, visitId: String(body.visitId), hardshipNote }, { bills: billEngine })
    : await createGrant(db, {
        patientId: patient.id,
        documentId: String(body.documentId ?? ""),
        providerId: String(body.providerId ?? ""),
        requestedCents: Number(body.requestedCents),
        hardshipNote,
      });

  // Assess right away so the caseworker queue is ready. A failure here never loses the request:
  // the queue assesses any request on load.
  try {
    await assessGrant(db, needEngine, created.id, { depositIncomeCents: await depositIncomeCents(patient.id) });
  } catch (err) {
    console.error("[api] need assessment deferred:", err);
  }
  const grant = await getGrant(db, created.id);
  const bill = grant.visit ? await getBill(db, grant.visit.id, { patientId: patient.id }) : undefined;
  return ok<GrantResponse>({ grant, bill }, 201);
});

export const GET = route(async (req: Request) => {
  const device = await requireDevice(["kiosk", "hospital", "provider", "reviewer"]);
  const db = getDb();
  if (device.role === "reviewer") {
    const status = new URL(req.url).searchParams.get("status");
    if (status && !GRANT_STATUSES.includes(status as GrantStatus)) throw new CoreError("bad_request", "Unknown status");
    return ok<GrantListResponse>({ grants: await listGrants(db, status ? { status: status as GrantStatus } : {}) });
  }
  if (device.role === "provider" || device.role === "hospital") {

    return ok<GrantListResponse>({ grants: await listGrants(db, { providerId: device.providerId ?? "" }) });
  }
  const patient = await optionalSessionPatient(device);
  if (!patient) throw new CoreError("unauthenticated", "No active patient session. Tap the CareCard again.");
  return ok<GrantListResponse>({ grants: await listGrants(db, { patientId: patient.id }) });
});
