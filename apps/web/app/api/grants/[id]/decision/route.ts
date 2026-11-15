// POST /api/grants/:id/decision: a reviewer approves (cents allowed, from $1.00, reserving budget) or rejects.
// One approval is enough at any amount. A rejection sends a devnet decision receipt.
// Rev 6: approval pays the hospital in the same request (Nessie payout, then the Solana receipt);
// there is no provider tap. Repeating an approval retries a payout that didn't finish, and never
// pays twice.

import type { Grant, GrantDecisionRequest, GrantResponse } from "@abdulcare/contracts";
import { CoreError, decideGrant, getDb, getGrant } from "@abdulcare/core";
import { linkGrantRails, redeemGrant, sendDecisionReceipt } from "@abdulcare/payments";
import { after } from "next/server";
import { requireDevice } from "@/app/api/_lib/auth";
import { payments } from "@/app/api/_lib/deps";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";

// Nessie payout plus the devnet receipt confirmation.
export const maxDuration = 120;

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
  // A double click or retry on a grant that's already paid just returns it.
  if (decision.decision === "approve" && grant.visit && grant.status === "paid") return ok<GrantResponse>({ grant });
  const alreadyApproved = grant.status === "approved" || grant.status === "payment_pending";
  if (!(decision.decision === "approve" && alreadyApproved && grant.visit)) {
    grant = await decideGrant(db, id, device.id, decision);
  }
  if (grant.visit && (grant.status === "approved" || grant.status === "payment_pending")) {
    grant = await payHospital(grant);
  }
  if (grant.status === "rejected") {
    // A declined request gets its own devnet receipt so the public ledger shows it as decided.
    // No-op if one exists; never throws.
    await sendDecisionReceipt(payments(), grant.id);
  }
  // Linked rails, after the response: record the decision in the on-chain fund program (and mark it
  // paid with the Nessie purchase fingerprint), and bring the patient's Nessie bill to the new balance.
  const decidedId = grant.id;
  after(async () => {
    try {
      await linkGrantRails(payments(), decidedId);
    } catch (err) {
      console.error("[api] linked rails didn't finish:", (err as Error).message);
    }
  });
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
