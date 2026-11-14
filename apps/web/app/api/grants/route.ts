// POST /api/grants: the patient asks for help with a chosen bill; the request is assessed at once.
// GET /api/grants: caseworkers list by status; a kiosk sees its patient's requests; a provider
// device sees grants for its pharmacy.

import { GRANT_STATUSES, type CreateGrantRequest, type GrantListResponse, type GrantResponse, type GrantStatus } from "@abdulcare/contracts";
import { estimateMonthlyIncomeCents } from "@abdulcare/ai";
import { CoreError, assessGrant, createGrant, getDb, getGrant, getPatientWithProfile, listGrants } from "@abdulcare/core";
import { listIncomeDeposits } from "@abdulcare/payments";
import { optionalSessionPatient, requireDevice, requirePatientSession } from "@/app/api/_lib/auth";
import { needEngine, payments } from "@/app/api/_lib/deps";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const { patient } = await requirePatientSession();
  const body = await readJson<CreateGrantRequest>(req);
  const db = getDb();
  const created = await createGrant(db, {
    patientId: patient.id,
    documentId: String(body.documentId ?? ""),
    providerId: String(body.providerId ?? ""),
    requestedCents: body.requestedCents,
    hardshipNote: typeof body.hardshipNote === "string" ? body.hardshipNote : null,
  });

  // Assess right away so the caseworker queue is ready. A failure here never loses the request:
  // the queue assesses any request on load.
  try {
    let depositIncomeCents: number | null = null;
    const { nessieAccountId } = await getPatientWithProfile(db, patient.id);
    if (nessieAccountId) {
      try {
        depositIncomeCents = estimateMonthlyIncomeCents(await listIncomeDeposits(payments().nessie, nessieAccountId));
      } catch (err) {
        console.error("[api] deposit income estimate unavailable:", (err as Error).message);
      }
    }
    await assessGrant(db, needEngine, created.id, { depositIncomeCents });
  } catch (err) {
    console.error("[api] need assessment deferred:", err);
  }
  return ok<GrantResponse>({ grant: await getGrant(db, created.id) }, 201);
});

export const GET = route(async (req: Request) => {
  const device = await requireDevice(["kiosk", "provider", "reviewer"]);
  const db = getDb();
  if (device.role === "reviewer") {
    const status = new URL(req.url).searchParams.get("status");
    if (status && !GRANT_STATUSES.includes(status as GrantStatus)) throw new CoreError("bad_request", "Unknown status");
    return ok<GrantListResponse>({ grants: await listGrants(db, status ? { status: status as GrantStatus } : {}) });
  }
  if (device.role === "provider") {
    return ok<GrantListResponse>({ grants: await listGrants(db, { providerId: device.providerId ?? "" }) });
  }
  const patient = await optionalSessionPatient(device);
  if (!patient) throw new CoreError("unauthenticated", "No active patient session. Tap the CareCard again.");
  return ok<GrantListResponse>({ grants: await listGrants(db, { patientId: patient.id }) });
});
