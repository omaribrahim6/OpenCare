// Browser-side API client. NEXT_PUBLIC_API_MODE=live calls the real routes in app/api (cookies
// carry the device pairing and patient session); anything else uses the mocks in ./mock.

import type {
  ApiError,
  BillsResponse,
  CreateDocumentRequest,
  CreateDonationRequest,
  CreateGrantRequest,
  CurrentDeviceResponse,
  DocumentResponse,
  DonationResponse,
  FundSummary,
  GrantDecisionRequest,
  GrantListResponse,
  GrantResponse,
  GrantStatus,
  PairDeviceRequest,
  PairDeviceResponse,
  ProviderListResponse,
  ReviewQueue,
  SolanaDonationRequest,
  TapResult,
} from "@abdulcare/contracts";
import * as mock from "./mock";

export const LIVE = process.env.NEXT_PUBLIC_API_MODE === "live";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? "internal", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const get = <T>(path: string) => call<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => call<T>("POST", path, body);

/** True when the error means "this device has no patient session" (tap the card again). */
export function isNoSession(e: unknown): boolean {
  return e instanceof ApiRequestError && (e.code === "unauthenticated" || e.status === 401);
}

// Devices and sessions --------------------------------------------------------------------------

export const pairDevice = (req: PairDeviceRequest) =>
  LIVE ? post<PairDeviceResponse>("/api/devices/pair", req) : mock.pairDevice(req);

export const currentDevice = () =>
  LIVE ? get<CurrentDeviceResponse>("/api/devices/me") : mock.currentDevice();

/** POST /api/tap: sets the session cookie on a paired device and returns what the tap means. */
export const tap = (token: string) => (LIVE ? post<TapResult>("/api/tap", { token }) : mock.resolveTap(token));

export const endSession = () => (LIVE ? post<{ ok: true }>("/api/session/end") : Promise.resolve({ ok: true as const }));

// Kiosk -----------------------------------------------------------------------------------------

export const getBills = () => (LIVE ? get<BillsResponse>("/api/patients/me/bills") : mock.getBills().then((bills) => ({ bills })));

export const createDocument = (req: CreateDocumentRequest) =>
  LIVE ? post<DocumentResponse>("/api/documents", req) : mock.createDocument(req);

export const listProviders = () =>
  LIVE ? get<ProviderListResponse>("/api/providers") : mock.listProviders();

export const createGrant = (req: CreateGrantRequest) =>
  LIVE ? post<GrantResponse>("/api/grants", req) : mock.createGrant(req);

/** Kiosk: the session patient's requests. Provider device: grants for its pharmacy. */
export const listMyGrants = () => (LIVE ? get<GrantListResponse>("/api/grants") : mock.listMyGrants());

export const getGrant = (id: string) => (LIVE ? get<GrantResponse>(`/api/grants/${encodeURIComponent(id)}`) : mock.getGrantById(id));

// Caseworker ------------------------------------------------------------------------------------

/** formulaFallback only affects mocks (preview of the "formula order" state). */
export const getReviewQueue = (formulaFallback = false) =>
  LIVE ? get<ReviewQueue>("/api/review/queue") : mock.getReviewQueue(formulaFallback);

/** Caseworker: every grant, optionally filtered by status (newest first). */
export const listGrants = (status?: GrantStatus) =>
  LIVE ? get<GrantListResponse>(`/api/grants${status ? `?status=${encodeURIComponent(status)}` : ""}`) : mock.listGrants(status);

export const decideGrant = (id: string, req: GrantDecisionRequest) =>
  LIVE ? post<GrantResponse>(`/api/grants/${encodeURIComponent(id)}/decision`, req) : mock.decideGrant(id, req);

// Provider --------------------------------------------------------------------------------------

export const redeemGrant = (id: string) =>
  LIVE ? post<GrantResponse>(`/api/grants/${encodeURIComponent(id)}/redeem`, { confirm: true }) : mock.redeemGrant(id);

// Fund ------------------------------------------------------------------------------------------

export const getFundSummary = () => (LIVE ? get<FundSummary>("/api/fund/summary") : mock.getFundSummary());

/** Card donation: one idempotencyKey per attempt, reused on retry. */
export type CardDonationRequest = CreateDonationRequest & { idempotencyKey: string };

export const donateByCard = (req: CardDonationRequest) =>
  LIVE ? post<DonationResponse>("/api/fund/donations", req) : mock.donate(req.amountCents);

export const recordSolDonation = (req: SolanaDonationRequest) =>
  LIVE ? post<DonationResponse>("/api/fund/donations/solana", req) : mock.donateSol(req.signature);
