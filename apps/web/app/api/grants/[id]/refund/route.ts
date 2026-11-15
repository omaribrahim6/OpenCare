// POST /api/grants/:id/refund { amountCents, reason }: reviewer only. The hospital returns money the
// fund paid (insurance paid late, or a charge was reversed): a Nessie transfer from the hospital back
// to the fund and a public devnet memo under the case's opaque reference. One refund per grant.

import { getDb } from "@abdulcare/core";
import { refundToFund } from "@abdulcare/payments";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";
import { rails } from "@/app/api/_lib/rails";

export const maxDuration = 30;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  await requireDevice(["reviewer"]);
  const body = await readJson<{ amountCents?: number; reason?: string }>(req);
  const refund = await refundToFund({ ...rails(), db: getDb() }, {
    grantId: id,
    amountCents: Number(body.amountCents),
    reason: typeof body.reason === "string" ? body.reason : "Refund",
  });
  return ok({ refund }, 201);
});
