// GET /api/proof/reconcile: check every money movement on both rails against its records. Totals and
// opaque references only, so it's public.

import { reconcileRails } from "@abdulcare/payments";
import { ok, route } from "@/app/api/_lib/http";
import { rails } from "@/app/api/_lib/rails";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ report: await reconcileRails(rails()) }));
