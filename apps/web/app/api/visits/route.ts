// POST /api/visits: a hospital device logs a visit for the tapped (or picked) patient. Insurance
// and every hospital policy run at once; the response is the bill (SPEC §9, rev 6). The same
// idempotencyKey never logs the visit twice.

import type { CreateVisitRequest, VisitResponse } from "@abdulcare/contracts";
import { CoreError, getDb, logVisit } from "@abdulcare/core";
import { optionalSessionPatient, requireDevice } from "@/app/api/_lib/auth";
import { billEngine, depositIncomeCents, needEngine } from "@/app/api/_lib/deps";
import { ok, readJson, route } from "@/app/api/_lib/http";

// Application text may come from Gemini, one call per policy.
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const device = await requireDevice(["hospital", "provider"]);
  const body = await readJson<CreateVisitRequest>(req);
  const tapped = await optionalSessionPatient(device);
  const patientId = typeof body.patientId === "string" && body.patientId ? body.patientId : tapped?.id;
  if (!patientId) throw new CoreError("bad_request", "Tap the patient's CareCard or pick a patient first");

  const bill = await logVisit(
    getDb(),
    { bills: billEngine, need: needEngine },
    {
      templateId: String(body.templateId ?? ""),
      patientId,
      device,
      idempotencyKey: String(body.idempotencyKey ?? ""),
      depositIncomeCents: await depositIncomeCents(patientId),
    },
  );
  return ok<VisitResponse>({ bill }, 201);
});
