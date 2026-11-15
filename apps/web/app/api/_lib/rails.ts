// Shared plumbing for the linked-rails routes (Nessie holds the dollars, Solana the rules and proof).

import { FORMULA } from "@abdulcare/ai";
import { CoreError } from "@abdulcare/core";
import type { PaymentsDeps } from "@abdulcare/payments";
import { centsPerDevnetSol, payments } from "./deps";

export { FORMULA, centsPerDevnetSol };

/** Payments deps, or a clear upstream_error when banking or Solana isn't configured. */
export function rails(): PaymentsDeps {
  return payments();
}

export function requireSolana(deps: PaymentsDeps): void {
  if (!deps.solana) throw new CoreError("upstream_error", "Solana is not configured on this deployment yet");
}

/** The public origin of this request, for links handed to wallets (Blinks, Solana Pay). */
export function baseUrl(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Vercel cron calls carry `Authorization: Bearer $CRON_SECRET`. */
export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
