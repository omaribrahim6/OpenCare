// GET /api/fund/donors?limit=8: public. The largest named funders and the anonymous total.

import type { TopDonorsResponse } from "@abdulcare/contracts";
import { getDb, listTopDonors } from "@abdulcare/core";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 8);
  return ok<TopDonorsResponse>(await listTopDonors(getDb(), limit));
});
