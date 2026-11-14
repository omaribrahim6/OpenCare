// POST /api/fund/donations/solana: record a devnet SOL transfer to the fund treasury, verified
// on-chain and counted once per signature. Devnet SOL has no real value; the dollar figure uses a
// fixed demo rate (SOL_DONATION_CENTS_PER_SOL).

import type { DonationResponse, SolanaDonationRequest } from "@abdulcare/contracts";
import { CoreError, getDb, getFundSummary } from "@abdulcare/core";
import { recordSolDonation } from "@abdulcare/payments";
import { centsPerDevnetSol, payments } from "@/app/api/_lib/deps";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const { signature } = await readJson<SolanaDonationRequest>(req);
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) {
    throw new CoreError("bad_request", "signature must be a Solana transaction signature");
  }
  const { donation } = await recordSolDonation(payments(), { signature, centsPerSol: centsPerDevnetSol() });
  return ok<DonationResponse>(
    {
      donation,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      fund: await getFundSummary(getDb()),
    },
    201,
  );
});
