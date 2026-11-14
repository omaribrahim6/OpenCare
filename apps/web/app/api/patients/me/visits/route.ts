// GET /api/patients/me/visits: every visit's bill for the checked-in patient, newest first.

import type { PatientVisitsResponse } from "@abdulcare/contracts";
import { getBill, getDb, listPatientVisitIds } from "@abdulcare/core";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  const { patient } = await requirePatientSession();
  const db = getDb();
  const ids = await listPatientVisitIds(db, patient.id);
  const bills = [];
  for (const id of ids) bills.push(await getBill(db, id, { patientId: patient.id }));
  return ok<PatientVisitsResponse>({ bills });
});
