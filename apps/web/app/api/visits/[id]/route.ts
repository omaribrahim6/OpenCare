// GET /api/visits/:id: a visit's bill, for the hospital that logged it or a reviewer.

import type { VisitResponse } from "@abdulcare/contracts";
import { CoreError, getBill, getDb } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route, type IdParams } from "@/app/api/_lib/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const device = await requireDevice(["hospital", "provider", "reviewer"]);
  const bill = await getBill(getDb(), id);
  if (device.role !== "reviewer" && bill.visit.hospital.id !== device.providerId) {
    throw new CoreError("forbidden", "This visit belongs to another hospital");
  }
  return ok<VisitResponse>({ bill });
});
