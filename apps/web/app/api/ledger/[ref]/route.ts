// GET /api/ledger/:ref: public. One ledger row in full by its reference.
// A donation (don_…): the donor (unless anonymous), amount, purpose and receipts.
// A decided case: cost of care, itemized bill, insurance, hospital assistance, the hospital paid,
// need score, triage insight, decision and receipts. Patient identity always stays hidden.

import type { LedgerDetailResponse } from "@abdulcare/contracts";
import { getDb, getLedgerDetail } from "@abdulcare/core";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ ref: string }> }) => {
  const { ref } = await params;
  return ok<LedgerDetailResponse>(await getLedgerDetail(getDb(), ref));
});
