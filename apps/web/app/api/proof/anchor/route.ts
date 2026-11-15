// POST /api/proof/anchor (reviewer) or GET with the cron secret: publish today's anchor. The queue's
// and ledger's Merkle roots, the need formula's hash and the fund's Nessie statement go into one
// public payload; its digest goes into a devnet memo. One anchor per day.

import { CoreError } from "@abdulcare/core";
import { anchorDay, programIdFromEnv } from "@abdulcare/payments";
import { currentDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";
import { FORMULA, isCron, rails, requireSolana } from "@/app/api/_lib/rails";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run(req: Request) {
  if (!isCron(req)) {
    const device = await currentDevice();
    if (device?.role !== "reviewer") throw new CoreError("forbidden", "Only a reviewer or the daily job can publish an anchor");
  }
  const deps = rails();
  requireSolana(deps);
  const anchor = await anchorDay(deps, {
    formula: FORMULA as unknown as { version: string },
    programId: programIdFromEnv()?.toBase58() ?? null,
  });
  const { queue, ledger, ...rest } = anchor.payload;
  return ok({
    anchor: {
      ...anchor,
      payload: { ...rest, queue: { root: queue.root, count: queue.count }, ledger: { root: ledger.root, count: ledger.count } },
    },
  });
}

export const POST = route(run);
export const GET = route(run);
