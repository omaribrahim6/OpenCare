// POST /api/fund/donations: anonymous card donation, as a Nessie deposit into the fund account.
// Whole dollars, $1 to $10,000. The client's idempotencyKey makes a double submit deposit once.

import type { CreateDonationRequest, DonationResponse } from "@abdulcare/contracts";
import { getDb, getFundSummary } from "@abdulcare/core";
import { donateByCard } from "@abdulcare/payments";
import { payments } from "@/app/api/_lib/deps";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const body = await readJson<CreateDonationRequest>(req);
  const { donation, explorerUrl } = await donateByCard(payments(), {
    amountCents: body.amountCents,
    idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
  });
  return ok<DonationResponse>({ donation, explorerUrl, fund: await getFundSummary(getDb()) }, 201);
});
