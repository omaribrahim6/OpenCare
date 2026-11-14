// GET /api/providers: participating providers (public: names and kinds only, no payout IDs).
// Public so a phone being paired as a provider terminal can pick its pharmacy.

import type { ProviderListResponse } from "@abdulcare/contracts";
import { getDb, listProviders } from "@abdulcare/core";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok<ProviderListResponse>({ providers: await listProviders(getDb()) }));
