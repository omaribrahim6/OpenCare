// GET /api/providers: participating providers, for paired devices.

import type { ProviderListResponse } from "@abdulcare/contracts";
import { getDb, listProviders } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  await requireDevice(["kiosk", "provider", "reviewer"]);
  return ok<ProviderListResponse>({ providers: await listProviders(getDb()) });
});
