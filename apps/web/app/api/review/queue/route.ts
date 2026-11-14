// GET /api/review/queue: pending requests for caseworkers, freshly assessed and in Gemini's
// order (validated, cached), or formula order on fallback (SPEC §7 job 3).

import type { ReviewQueueResponse } from "@abdulcare/contracts";
import { getDb, getReviewQueue } from "@abdulcare/core";
import { requireDevice } from "@/app/api/_lib/auth";
import { needEngine } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";

// Gemini ranking can take a few seconds on a cold queue.
export const maxDuration = 30;

export const GET = route(async () => {
  await requireDevice(["reviewer"]);
  return ok<ReviewQueueResponse>(await getReviewQueue(getDb(), needEngine));
});
