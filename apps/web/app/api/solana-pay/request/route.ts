// POST /api/solana-pay/request { rail: "sol" | "usdc", amount }: a Solana Pay URL (for a QR code)
// that sends a devnet donation to the fund's treasury, tagged with a one-time reference key.

import { CoreError } from "@abdulcare/core";
import { createDonationRequest } from "@abdulcare/payments";
import { ok, readJson, route } from "@/app/api/_lib/http";
import { centsPerDevnetSol, rails, requireSolana } from "@/app/api/_lib/rails";

export const POST = route(async (req: Request) => {
  const body = await readJson<{ rail?: string; amount?: number }>(req);
  if (body.rail !== "sol" && body.rail !== "usdc") throw new CoreError("bad_request", "rail must be sol or usdc");
  const deps = rails();
  requireSolana(deps);
  const request = await createDonationRequest(deps, { rail: body.rail, amount: Number(body.amount), fallbackCentsPerSol: centsPerDevnetSol() });
  return ok({ request }, 201);
});
