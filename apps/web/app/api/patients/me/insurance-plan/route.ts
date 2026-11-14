// GET and PUT /api/patients/me/insurance-plan: the checked-in patient's saved plan (fictional,
// patient-reported). It applies to new visits, and to an existing visit at its apply step when
// no savings were applied yet.

import type { InsurancePlanResponse, SaveInsurancePlanRequest } from "@abdulcare/contracts";
import { getDb, getInsurancePlan, setInsurancePlan } from "@abdulcare/core";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  const { patient } = await requirePatientSession();
  return ok<InsurancePlanResponse>({ plan: await getInsurancePlan(getDb(), patient.id) });
});

export const PUT = route(async (req: Request) => {
  const { patient } = await requirePatientSession();
  const body = await readJson<SaveInsurancePlanRequest>(req);
  const db = getDb();
  await setInsurancePlan(db, patient.id, body.plan ?? null);
  return ok<InsurancePlanResponse>({ plan: await getInsurancePlan(db, patient.id) });
});
