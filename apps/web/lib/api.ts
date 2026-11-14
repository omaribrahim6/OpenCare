// Client-side API calls. NEXT_PUBLIC_API_MODE=live calls the real routes in app/api;
// anything else (the default until the routes land) uses the mocks in ./mock.

import type { ApiError, CreateDonationRequest, DonationResponse, TapResult } from "@abdulcare/contracts";
import * as mock from "./mock";

export const LIVE = process.env.NEXT_PUBLIC_API_MODE === "live";

/** Card donation body. idempotencyKey is being added to the contract with the api lane's routes PR. */
export type CardDonationRequest = CreateDonationRequest & { idempotencyKey: string };

/** POST /api/fund/donations/solana (api lane): verifies a devnet transfer to the treasury. */
export interface SolDonationRequest {
  signature: string;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? "internal", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** POST /api/tap: sets the session cookie on a paired device and returns what the tap means. */
export function tap(token: string): Promise<TapResult> {
  return LIVE ? post<TapResult>("/api/tap", { token }) : mock.resolveTap(token);
}

export function donateByCard(req: CardDonationRequest): Promise<DonationResponse> {
  return LIVE ? post<DonationResponse>("/api/fund/donations", req) : mock.donate(req.amountCents);
}

export function recordSolDonation(req: SolDonationRequest): Promise<DonationResponse> {
  return LIVE ? post<DonationResponse>("/api/fund/donations/solana", req) : mock.donateSol(req.signature);
}
