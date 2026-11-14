// POST /api/ledger/:ref/identity: reviewer devices only. Reveals who a public ledger case belongs
// to (from Tiger Data) and logs the reveal; the public case page shows how many reveals happened.

import type { IdentityRevealRequest, IdentityRevealResponse } from "@abdulcare/contracts";
import { getDb, revealIdentity } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, { params }: { params: Promise<{ ref: string }> }) => {
  const { ref } = await params;
  const device = await requireDevice(["reviewer"]);
  let body: IdentityRevealRequest = {};
  try {
    body = (await req.json()) as IdentityRevealRequest;
  } catch {
    // A reason is optional.
  }
  const reason = typeof body?.reason === "string" ? body.reason : null;
  return ok<IdentityRevealResponse>(await revealIdentity(getDb(), ref, device, reason));
});
