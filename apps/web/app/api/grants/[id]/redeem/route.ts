// POST /api/grants/:id/redeem: at the provider's counter, after the patient's card tap on the
// provider device and an explicit confirmation. Repeating it never pays twice (SPEC §8).

import type { GrantResponse, RedeemGrantRequest } from "@abdulcare/contracts";
import { CoreError } from "@abdulcare/core";
import { redeemGrant } from "@abdulcare/payments";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { payments } from "@/app/api/_lib/deps";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { device, patient } = await requirePatientSession(["provider"]);
  const body = await readJson<RedeemGrantRequest>(req);
  if (body.confirm !== true) throw new CoreError("bad_request", "The provider must confirm the payment");
  if (!device.providerId) throw new CoreError("forbidden", "This device isn't linked to a provider");
  const { grant } = await redeemGrant(payments(), { grantId: id, providerId: device.providerId, patientId: patient.id });
  return ok<GrantResponse>({ grant });
});
