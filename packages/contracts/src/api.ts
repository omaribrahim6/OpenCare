// Request and response bodies for the routes in SPEC §9 (rev 5).
// Routes live in apps/web/app/api/. Every error response is ApiError with a non-2xx status.

import type { Explanation } from "./ai";
import type { Cents } from "./grants";
import type {
  Device,
  DeviceRole,
  DocumentRecord,
  DocumentSource,
  Donation,
  FoundBill,
  FundSummary,
  Grant,
  PatientProfile,
  PatientSummary,
  Provider,
  ReviewQueue,
} from "./records";

export type ErrorCode =
  | "bad_request"
  | "unauthenticated" // no or invalid device cookie
  | "forbidden" // wrong device role, or not this patient's / provider's record
  | "not_found"
  | "invalid_state" // e.g. redeeming a grant that isn't approved
  | "insufficient_funds"
  | "conflict" // e.g. a payout for this grant is already in progress
  | "upstream_error" // Gemini, Nessie or Solana failed
  | "internal";

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// Card tap: /t/[token] page (server component calls core directly; no HTTP route)

export type TapResult =
  /** Paired kiosk: a patient session started (cookie set). */
  | { kind: "session"; patient: PatientSummary }
  /** Paired provider device: patient identified for redemption (cookie set). */
  | { kind: "redemption"; patient: PatientSummary; redeemableGrants: Grant[] }
  /** Paired device, but the token isn't an active card. */
  | { kind: "unknown_card" }
  /** Not a paired device: show "Tap at a participating kiosk", never patient data. */
  | { kind: "unpaired_device" };

// POST /api/tap: the /t/[token] page sends the token from its URL; the server checks this
// browser's device cookie, sets the session cookie when a session starts, and returns TapResult.
export interface TapRequest {
  token: string;
}
export type TapResponse = TapResult;

// ---------------------------------------------------------------------------
// Devices

// POST /api/devices/pair: staff pairs this browser as a kiosk, provider or caseworker device.
export interface PairDeviceRequest {
  role: DeviceRole;
  pin: string;
  label: string;
  /** Required when role is "provider". */
  providerId?: string;
}
/** The device secret is set as an httpOnly cookie, never returned in the body. */
export interface PairDeviceResponse {
  device: Device;
}

// GET /api/devices/me
export interface CurrentDeviceResponse {
  device: Device | null;
}

// POST /api/session/end: clears the patient session on a kiosk (idle timeout or "Done").
export interface EndSessionResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// Patient (kiosk, active patient session)

// GET /api/patients/me: who is checked in, and their profile from enrollment (read-only).
export interface CurrentPatientResponse {
  patient: PatientSummary;
  profile: PatientProfile;
}

// GET /api/patients/me/bills: likely medical Nessie bills and purchases, classified.
export interface BillsResponse {
  bills: FoundBill[];
}

// ---------------------------------------------------------------------------
// POST /api/documents (kiosk session): copy the chosen Nessie item; the server re-reads it
// from Nessie, so the client only sends its ID.

export interface CreateDocumentRequest {
  source: DocumentSource;
  nessieId: string;
}
export interface DocumentResponse {
  document: DocumentRecord;
  explanation: Explanation;
}

// GET /api/documents/:id (owner session or caseworker) -> { document }

// ---------------------------------------------------------------------------
// Grants

// POST /api/grants (kiosk session): creates the request and its need assessment.
export interface CreateGrantRequest {
  documentId: string;
  providerId: string;
  requestedCents: Cents;
  /** Optional, at most MAX_HARDSHIP_NOTE_CHARS. Untrusted: never scored or ranked. */
  hardshipNote?: string;
}
export interface GrantResponse {
  grant: Grant;
}

// GET /api/grants?status=… (caseworker device) or the session patient's own grants (kiosk)
export interface GrantListResponse {
  grants: Grant[];
}

// GET /api/grants/:id (kiosk owner, caseworker, or the grant's provider device)
// -> GrantResponse. Polling this reconciles a pending payout or receipt.

// POST /api/grants/:id/decision (caseworker device)
// Above SECOND_APPROVAL_ABOVE_CENTS, the first approval leaves the grant pending_review with
// awaitingSecondApproval = true; a second caseworker device approving the same amount approves it.
export type GrantDecisionRequest =
  | { decision: "approve"; approvedCents: Cents; note?: string }
  | { decision: "reject"; note?: string };
// -> GrantResponse

// POST /api/grants/:id/cancel (caseworker device; only before payment starts) -> GrantResponse

// POST /api/grants/:id/redeem (provider device, after the patient's card tap)
export interface RedeemGrantRequest {
  /** Must be true: the provider explicitly confirmed (SPEC §8). */
  confirm: true;
}
// -> GrantResponse (status payment_pending or paid). Repeating the call never pays twice.

// ---------------------------------------------------------------------------
// GET /api/review/queue (caseworker device): Gemini-ranked pending requests (SPEC §7 job 3).

export type ReviewQueueResponse = ReviewQueue;

// ---------------------------------------------------------------------------
// Fund (public, aggregate only)

// GET /api/fund/summary
export type FundSummaryResponse = FundSummary;

// POST /api/fund/donations: anonymous card donation, a Nessie deposit into the fund account.
export interface CreateDonationRequest {
  /** Between $1 and $10,000. */
  amountCents: Cents;
  /** Client-generated (e.g. crypto.randomUUID()) so a double submit deposits once. */
  idempotencyKey?: string;
}
export interface DonationResponse {
  donation: Donation;
  /** Devnet explorer link for the donation's memo receipt, once broadcast. */
  explorerUrl?: string | null;
  fund: FundSummary;
}

// POST /api/fund/donations/solana: record a devnet SOL transfer to the treasury (verified on-chain).
export interface SolanaDonationRequest {
  signature: string;
}
// -> DonationResponse

// GET /api/providers (public): providers a patient can choose or a provider device pairs with.
export interface ProviderListResponse {
  providers: Provider[];
}
