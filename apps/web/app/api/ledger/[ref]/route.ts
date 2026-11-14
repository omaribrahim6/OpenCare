// GET /api/ledger/:ref: public. One decided case by its opaque reference: cost of care, itemized
// bill, insurance, hospital assistance, need score, decision and receipts. Identity stays hidden.

import type { LedgerCase } from "@abdulcare/contracts";
import { getDb, getLedgerCase } from "@abdulcare/core";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ ref: string }> }) => {
  const { ref } = await params;
  return ok<{ case: LedgerCase }>({ case: await getLedgerCase(getDb(), ref) });
});
