// GET /api/patients: demo patients (names and IDs only) for the hospital intake tab's
// "pick the demo patient" when no card is at hand (SPEC §4 screen 8). Staff devices only.

import type { PatientListResponse } from "@abdulcare/contracts";
import { getDb, listPatients } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  await requireDevice(["hospital", "provider", "reviewer"]);
  return ok<PatientListResponse>({ patients: await listPatients(getDb()) });
});
