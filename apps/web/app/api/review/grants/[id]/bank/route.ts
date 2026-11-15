// GET /api/review/grants/:id/bank: the caseworker's bank check. The patient's last 90 days of
// Nessie activity as monthly totals only (money in, spending, recurring bills), next to the income
// on their profile. Informational: it never changes the score, the order or the amount.

import { CoreError, getDb, getGrant, getPatientWithProfile } from "@abdulcare/core";
import { bankCheck } from "@abdulcare/payments";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route, type IdParams } from "@/app/api/_lib/http";
import { rails } from "@/app/api/_lib/rails";

export const maxDuration = 30;

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  await requireDevice(["reviewer"]);
  const db = getDb();
  const grant = await getGrant(db, id);
  const { profile, nessieAccountId } = await getPatientWithProfile(db, grant.patient.id);
  if (!nessieAccountId) throw new CoreError("not_found", "This patient has no bank account on file");
  const check = await bankCheck(rails().nessie, nessieAccountId);
  const stated = profile.monthlyIncomeCents;
  return ok({
    check,
    statedMonthlyIncomeCents: stated,
    incomeMatches: stated ? Math.abs(check.monthlyDepositsCents - stated) <= stated * 0.2 : null,
  });
});
