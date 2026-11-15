// GET /api/user/bills/:id/plan: the visit's payment plan, or a suggested one.
// POST /api/user/bills/:id/plan { months: 3 | 6 | 12 }: put what's left on an interest-free monthly
// plan, a recurring Nessie bill from the patient's checking to the hospital.

import { getBill, getDb, getPatientWithProfile, requirePortalPatient } from "@abdulcare/core";
import { affordableMonthlyCents, getPaymentPlan, PLAN_MONTHS, startPaymentPlan, suggestPlanMonths } from "@abdulcare/payments";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";
import { rails } from "@/app/api/_lib/rails";
import { readPortalCookie } from "../../../portal-cookie";

export const maxDuration = 30;

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const bill = await getBill(db, id, { patientId: patient.id });
  const { profile } = await getPatientWithProfile(db, patient.id);
  const plan = await getPaymentPlan(db, id);
  const months = suggestPlanMonths(bill.remainingCents, profile.monthlyIncomeCents);
  return ok({
    plan,
    suggestion: {
      months,
      monthlyCents: Math.ceil(bill.remainingCents / months / 100) * 100,
      affordableMonthlyCents: affordableMonthlyCents(profile.monthlyIncomeCents),
      options: PLAN_MONTHS.map((m) => ({ months: m, monthlyCents: Math.ceil(bill.remainingCents / m / 100) * 100 })),
    },
  });
});

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const body = await readJson<{ months?: number }>(req);
  const plan = await startPaymentPlan(rails(), { visitId: id, patientId: patient.id, months: Number(body.months) });
  return ok({ plan }, 201);
});
