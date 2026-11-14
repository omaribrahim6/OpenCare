// GET /api/fund/summary: public, aggregate only (no patient data), for the fund dashboard.

import type { FundSummaryResponse } from "@abdulcare/contracts";
import { getDb, getFundSummary } from "@abdulcare/core";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok<FundSummaryResponse>(await getFundSummary(getDb())));
