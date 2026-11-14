// GET /api/ledger: public. Every donation and every decided case, newest first. No names,
// birth dates, SSNs, addresses or hardship notes; references are opaque (SPEC §2 public audit).

import type { LedgerResponse } from "@abdulcare/contracts";
import { getDb, listLedger } from "@abdulcare/core";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok<LedgerResponse>(await listLedger(getDb())));
