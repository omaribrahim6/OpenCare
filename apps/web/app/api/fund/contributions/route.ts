// POST /api/fund/contributions { providerId, amountCents, key? }: reviewer only. A hospital's
// community-benefit contribution: a Nessie transfer from the hospital's checking into the fund,
// recorded as a donation with a public devnet memo receipt. Repeating the same key moves nothing new.

import { randomBytes } from "node:crypto";
import { CoreError } from "@abdulcare/core";
import { contributeFromHospital, explorerTxUrl } from "@abdulcare/payments";
import { requireDevice } from "@/app/api/_lib/auth";
import { ok, readJson, route } from "@/app/api/_lib/http";
import { rails } from "@/app/api/_lib/rails";

export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  await requireDevice(["reviewer"]);
  const body = await readJson<{ providerId?: string; amountCents?: number; key?: string }>(req);
  if (typeof body.providerId !== "string") throw new CoreError("bad_request", "providerId is required");
  const receipt = await contributeFromHospital(rails(), {
    providerId: body.providerId,
    amountCents: Number(body.amountCents),
    key: typeof body.key === "string" ? body.key : `hc-${randomBytes(8).toString("hex")}`,
  });
  return ok({ receipt: { ...receipt, explorerUrl: receipt.signature ? explorerTxUrl(receipt.signature) : null } }, 201);
});
