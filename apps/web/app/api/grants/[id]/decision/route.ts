// POST /api/grants/:id/decision: a reviewer approves (whole dollars, reserving budget) or rejects.
// Above $500 a second reviewer device must approve the same amount (SPEC §2).
// Rev 6: approval pays the hospital in the same request (Nessie payout, then the Solana receipt);
// there is no provider tap. Repeating an approval retries a payout that didn't finish, and never
// pays twice.

import type { Grant, GrantDecisionRequest, GrantResponse } from "@abdulcare/contracts";
import { CoreError, decideGrant, getDb, getGrant } from "@abdulcare/core";
import { redeemGrant } from "@abdulcare/payments";
import { requireDevice } from "@/app/api/_lib/auth";
import { payments } from "@/app/api/_lib/deps";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";

// Nessie payout plus the devnet receipt confirmation.
export const maxDuration = 60;

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
  const db = getDb();

  let grant = await getGrant(db, id);
  const alreadyApproved = grant.status === "approved" || grant.status === "payment_pending";
  if (!(decision.decision === "approve" && alreadyApproved && grant.visit)) {
    grant = await decideGrant(db, id, device.id, decision);
  }
  if (grant.visit && (grant.status === "approved" || grant.status === "payment_pending")) {
    grant = await payHospital(grant);
  }
  return ok<GrantResponse>({ grant });
});

/**
 * Pay an approved rev 6 grant to its visit's hospital. The approval stands even if banking fails;
 * the reviewer sees "approved" or "payment pending" and approving again retries safely.
 */
async function payHospital(grant: Grant): Promise<Grant> {
  try {
    const { grant: paid } = await redeemGrant(payments(), {
      grantId: grant.id,
      providerId: grant.provider.id,
      patientId: grant.patient.id,
    });
    return paid;
  } catch (err) {
    console.error("[api] payout on approval didn't finish:", (err as Error).message);
    return getGrant(getDb(), grant.id);
  }
}
