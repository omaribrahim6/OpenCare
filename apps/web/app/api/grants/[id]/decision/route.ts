// POST /api/grants/:id/decision: a caseworker approves (whole dollars, reserving budget) or
// rejects. Above $500 a second caseworker device must approve the same amount (SPEC §2).

import type { GrantDecisionRequest, GrantResponse } from "@abdulcare/contracts";
import { CoreError, decideGrant, getDb } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const device = await requireDevice(["reviewer"]);
  const body = await readJson<GrantDecisionRequest>(req);
  if (body.decision !== "approve" && body.decision !== "reject") {
    throw new CoreError("bad_request", "decision must be approve or reject");
  }
  const note = typeof body.note === "string" ? body.note : undefined;
  const decision: GrantDecisionRequest =
    body.decision === "approve" ? { decision: "approve", approvedCents: body.approvedCents, note } : { decision: "reject", note };
  return ok<GrantResponse>({ grant: await decideGrant(getDb(), id, device.id, decision) });
});
