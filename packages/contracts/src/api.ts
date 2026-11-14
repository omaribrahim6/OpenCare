// Request and response bodies for the routes in SPEC §9 (rev 6; rev 5 routes marked deprecated).
// Routes live in apps/web/app/api/. Every error response is ApiError with a non-2xx status.

import type { Explanation } from "./ai";
import type { Bill, CaseDetail, InsurancePlan, VisitTemplate } from "./bills";
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
  /** Revision 6, paired hospital device: patient selected for intake (cookie set). */
  | { kind: "intake"; patient: PatientSummary; plan: InsurancePlan | null }
  /** @deprecated Revision 5 provider redemption. */
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

// POST /api/devices/pair: staff pairs this browser as a kiosk, hospital or reviewer device.
export interface PairDeviceRequest {
  role: DeviceRole;
  pin: string;
  label: string;
  /** Required when role is "hospital" (or the legacy "provider"): GET /api/providers lists them. */
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

// GET /api/patients/me/bill (rev 6): the latest visit's bill, its explanation and any fund request.
export interface PatientBillResponse {
  /** Null when no visit has been logged for this patient. */
  bill: Bill | null;
  /** Null when there is no bill. Template fallback when Gemini fails. */
  explanation: Explanation | null;
  /** The newest fund request for this visit, if any. */
  grant: Grant | null;
}

/** @deprecated Revision 5 Nessie bill discovery (GET /api/patients/me/bills), removed in revision 6. */
export interface BillsResponse {
  bills: FoundBill[];
}

// ---------------------------------------------------------------------------
// Hospital intake (rev 6, paired hospital device)

// GET /api/visit-templates: the seeded visits this hospital can log.
export interface VisitTemplatesResponse {
  templates: VisitTemplate[];
}

// GET /api/patients (hospital or reviewer device): demo patients, for "pick the demo patient"
// when no card is at hand. Names and IDs only.
export interface PatientListResponse {
  patients: PatientSummary[];
}

// POST /api/visits (hospital device): log a visit for the patient selected by the last card tap
// on this device (or patientId). Runs insurance and every hospital policy, then returns the bill.
export interface CreateVisitRequest {
  templateId: string;
  /** Optional when a card tap on this device selected the patient. */
  patientId?: string;
  /** Client-generated (crypto.randomUUID()) so a double submit logs one visit. */
  idempotencyKey: string;
}
export interface VisitResponse {
  bill: Bill;
}

// GET /api/visits/:id (the hospital device that logged it, or a reviewer) -> VisitResponse

// ---------------------------------------------------------------------------
// @deprecated POST /api/documents (rev 5), removed in revision 6.

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

// POST /api/grants (kiosk session): request help with the visit's remaining balance. The server
// sets the amount (the remaining balance) and the recipient (the visit's hospital); the client
// sends neither. Creates the need assessment and the decision brief. Repeating it returns the
// existing pending request for the visit.
export interface RequestHelpRequest {
  visitId: string;
  /** Optional, at most MAX_HARDSHIP_NOTE_CHARS. Untrusted: never scored or ranked. */
  hardshipNote?: string;
}

/** @deprecated Revision 5 body (a Nessie document and a chosen provider). Use RequestHelpRequest. */
export interface CreateGrantRequest {
  documentId: string;
  providerId: string;
  requestedCents: Cents;
  hardshipNote?: string;
}

export interface GrantResponse {
  grant: Grant;
  /** Rev 6, reviewer devices only: the case screen (brief, bill, profile, factors). */
  case?: CaseDetail;
  /** Rev 6, the patient's own session: the updated bill. */
  bill?: Bill;
}

// GET /api/grants?status=… (caseworker device) or the session patient's own grants (kiosk)
export interface GrantListResponse {
  grants: Grant[];
}

// GET /api/grants/:id (kiosk owner or reviewer) -> GrantResponse, with `case` for reviewers and
// `bill` for the patient. Polling this reconciles a pending payout or receipt.

// POST /api/grants/:id/decision (reviewer device)
// Rev 6: approval (whole dollars, at most the remaining balance and the available budget) starts
// the Nessie payout to the hospital and the Solana receipt in the same request; the response shows
// payment_pending or paid. Above SECOND_APPROVAL_ABOVE_CENTS, the first approval leaves the grant
// pending_review with awaitingSecondApproval = true; a second reviewer device approving the same
// amount approves it.
export type GrantDecisionRequest =
  | { decision: "approve"; approvedCents: Cents; note?: string }
  | { decision: "reject"; note?: string };
// -> GrantResponse

// POST /api/grants/:id/cancel (caseworker device; only before payment starts) -> GrantResponse

// @deprecated POST /api/grants/:id/redeem (rev 5 provider tap), removed in revision 6.
export interface RedeemGrantRequest {
  /** Must be true: the provider explicitly confirmed (SPEC §8). */
  confirm: true;
}
// -> GrantResponse (status payment_pending or paid). Repeating the call never pays twice.

// ---------------------------------------------------------------------------
// GET /api/review/queue (reviewer device): pending requests in need-v1 formula order, each with
// its decision brief, path and remaining balance, plus the available budget.

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

// GET /api/providers (public): the hospitals a hospital device can pair with.
export interface ProviderListResponse {
  providers: Provider[];
}
