// POST /api/grants/:id/cancel: a caseworker cancels an approved grant before payment starts,
// releasing its reserved budget.

import type { GrantResponse } from "@abdulcare/contracts";
import { cancelGrant, getDb } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route, type IdParams } from "@/app/api/_lib/http";

export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  await requireDevice(["reviewer"]);
  return ok<GrantResponse>({ grant: await cancelGrant(getDb(), id) });
});
