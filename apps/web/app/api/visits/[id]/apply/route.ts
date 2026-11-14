// POST /api/visits/:id/apply: "Apply for savings" from the patient's own kiosk session. Submits
// the prepared hospital policy applications in order; each simulated hospital decision posts a
// confirmed reduction. Repeating it returns the same bill.

import type { VisitResponse } from "@abdulcare/contracts";
import { applyVisitPolicies, getDb } from "@abdulcare/core";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { billEngine, depositIncomeCents } from "@/app/api/_lib/deps";
import { ok, route, type IdParams } from "@/app/api/_lib/http";

// Application text may be rewritten by Gemini, one call per policy.
export const maxDuration = 60;

export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { patient } = await requirePatientSession();
  const bill = await applyVisitPolicies(
    getDb(),
    { bills: billEngine },
    { visitId: id, patientId: patient.id, depositIncomeCents: await depositIncomeCents(patient.id) },
  );
  return ok<VisitResponse>({ bill });
});
