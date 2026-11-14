// GET /api/visit-templates: the seeded visits this device can log (SPEC §9, rev 6). A hospital
// device sees its own hospital's; the admin panel's intake tab (reviewer device) sees every hospital's.

import type { VisitTemplatesResponse } from "@abdulcare/contracts";
import { getDb, listVisitTemplates } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  const device = await requireDevice(["hospital", "provider", "reviewer"]);
  const hospitalId = device.role === "reviewer" ? null : (device.providerId ?? "");
  return ok<VisitTemplatesResponse>({ templates: await listVisitTemplates(getDb(), hospitalId) });
});
