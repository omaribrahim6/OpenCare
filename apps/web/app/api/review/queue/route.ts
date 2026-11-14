// GET /api/review/queue: pending requests for reviewers, freshly assessed, in need-v1 formula
// order, each with its decision brief (SPEC §7, rev 6).

import type { ReviewQueueResponse } from "@abdulcare/contracts";
import { getDb, getReviewQueue } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { billEngine, needEngine } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";

// Gemini writes one brief per new or changed request.
export const maxDuration = 30;

export const GET = route(async () => {
  await requireDevice(["reviewer"]);
  return ok<ReviewQueueResponse>(await getReviewQueue(getDb(), needEngine, { bills: billEngine }));
});
