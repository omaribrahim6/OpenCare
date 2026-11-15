// GET /api/solana-pay/status?reference=...: has the donor's wallet sent this donation yet? Once the
// transfer confirms, it's verified against the treasury and recorded once.

import { CoreError } from "@abdulcare/core";
import { confirmDonationRequest, explorerTxUrl } from "@abdulcare/payments";
import { ok, route } from "@/app/api/_lib/http";
import { centsPerDevnetSol, rails, requireSolana } from "@/app/api/_lib/rails";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(reference)) throw new CoreError("bad_request", "reference must be a Solana address");
  const deps = rails();
  requireSolana(deps);
  const result = await confirmDonationRequest(deps, { reference, fallbackCentsPerSol: centsPerDevnetSol() });
  return ok({ ...result, explorerUrl: result.signature ? explorerTxUrl(result.signature) : null });
});
