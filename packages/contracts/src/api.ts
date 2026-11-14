// Request and response bodies for the routes in SPEC §9.
// Routes live in apps/web/app/api/. Every error response is ApiError with a non-2xx status.

import type { ConfirmedFields, Explanation, PatientInfo, ProgramMatch } from "./ai";
import type { Cents } from "./grants";
import type {
  Device,
  DeviceRole,
  DocumentRecord,
  FoundBill,
  FundSummary,
  Grant,
  PatientSummary,
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

// ---------------------------------------------------------------------------
// POST /api/devices/pair: staff pairs this browser as a kiosk, provider or reviewer device.

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
// GET /api/patients/me/bills (kiosk, active patient session)

export interface BillsResponse {
  bills: FoundBill[];
}

// ---------------------------------------------------------------------------
// POST /api/documents (kiosk, active patient session)

export type CreateDocumentRequest =
  | {
      source: "scan";
      /** JPEG/PNG as base64 (no data: prefix). Keep under 4 MB (Vercel body limit 4.5 MB). */
      imageBase64: string;
      mimeType: "image/jpeg" | "image/png";
    }
  | { source: "nessie_bill" | "nessie_purchase"; nessieId: string };

export interface DocumentResponse {
  document: DocumentRecord;
}

// GET /api/documents/:id
// -> DocumentResponse

// GET /api/documents/:id/image (kiosk session owner or reviewer): the raw image bytes.

// PATCH /api/documents/:id/review (kiosk, owner session)
export interface ReviewDocumentRequest {
  confirmed: ConfirmedFields;
  patientInfo?: PatientInfo;
}
export interface ReviewDocumentResponse {
  document: DocumentRecord;
  explanation: Explanation;
  matches: ProgramMatch[];
}

// ---------------------------------------------------------------------------
// POST /api/grants (kiosk, owner session)

export interface CreateGrantRequest {
  documentId: string;
  providerId: string;
  programId: string;
  requestedCents: Cents;
}
export interface GrantResponse {
  grant: Grant;
}

// GET /api/grants?status=pending_review (reviewer device)
export interface GrantListResponse {
  grants: Grant[];
}

// GET /api/grants/:id (kiosk owner, reviewer, or the grant's provider device)
// -> GrantResponse. Polling this reconciles a pending payout or receipt.

// POST /api/grants/:id/decision (reviewer device)
export type GrantDecisionRequest =
  | { decision: "approve"; approvedCents: Cents; note?: string }
  | { decision: "reject"; note?: string };
// -> GrantResponse

// POST /api/grants/:id/cancel (reviewer device; only before payment starts)
// -> GrantResponse

// POST /api/grants/:id/redeem (provider device, after the patient's card tap)
export interface RedeemGrantRequest {
  /** Must be true: the provider explicitly confirmed (SPEC §8). */
  confirm: true;
}
// -> GrantResponse (status payment_pending or paid). Repeating the call never pays twice.

// ---------------------------------------------------------------------------
// GET /api/fund/summary (public, aggregate only)

export type FundSummaryResponse = FundSummary;

// GET /api/providers (paired devices): providers a patient can choose.
export interface ProviderListResponse {
  providers: { id: string; name: string; kind: string }[];
}
