// GET /api/proof/anchors/:day: the full public payload of one day's anchor, leaves included, so
// anyone can recompute both Merkle roots and the digest in the devnet memo.

import { CoreError, getDb } from "@abdulcare/core";
import { anchorMemo, canonicalJson, getAnchor, merkleRoot, sha256Hex } from "@abdulcare/payments";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ day: string }> }) => {
  const { day } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CoreError("bad_request", "day must be YYYY-MM-DD");
  const anchor = await getAnchor(getDb(), day);
  if (!anchor) throw new CoreError("not_found", "No anchor for that day");
  return ok({
    anchor,
    checks: {
      digestMatches: sha256Hex(canonicalJson(anchor.payload)) === anchor.digest,
      queueRootMatches: merkleRoot(anchor.payload.queue.leaves) === anchor.payload.queue.root,
      ledgerRootMatches: merkleRoot(anchor.payload.ledger.leaves) === anchor.payload.ledger.root,
      expectedMemo: anchorMemo(anchor.day, anchor.digest),
    },
  });
});
