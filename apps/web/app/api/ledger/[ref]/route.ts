// GET /api/ledger/:ref: one ledger row in full by its reference.
// A donation (don_…): public. The donor (unless anonymous), amount, purpose and receipts.
// A decided case: caseworker devices only. Cost of care, itemized bill, insurance, hospital
// assistance, need score, triage insight and decision are not public (Omar's /fund decision); the
// public ledger shows a case's publishable fields from GET /api/ledger instead. Patient identity
// always stays hidden here; revealing it is a separate, logged endpoint.

import type { LedgerDetailResponse } from "@abdulcare/contracts";
import { getDb, getLedgerDetail } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ ref: string }> }) => {
  const { ref } = await params;
  const detail = await getLedgerDetail(getDb(), ref);
  if (detail.case) await requireDevice(["reviewer"]);
  return ok<LedgerDetailResponse>(detail);
});
