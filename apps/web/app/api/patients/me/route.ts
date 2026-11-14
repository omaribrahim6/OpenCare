// GET /api/patients/me: the checked-in patient and their need profile from enrollment (read-only).

import type { CurrentPatientResponse } from "@abdulcare/contracts";
import { getDb, getPatientWithProfile } from "@abdulcare/core";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  const { patient } = await requirePatientSession();
  const { profile } = await getPatientWithProfile(getDb(), patient.id);
  return ok<CurrentPatientResponse>({ patient, profile });
});
