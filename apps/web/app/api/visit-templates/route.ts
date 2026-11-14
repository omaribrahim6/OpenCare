// GET /api/visit-templates: the seeded visits this hospital device can log (SPEC §9, rev 6).

import type { VisitTemplatesResponse } from "@abdulcare/contracts";
import { getDb, listVisitTemplates } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  const device = await requireDevice(["hospital", "provider"]);
  return ok<VisitTemplatesResponse>({ templates: await listVisitTemplates(getDb(), device.providerId ?? "") });
});
