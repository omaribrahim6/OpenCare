// Records as the API returns them (SPEC §9). Database rows live in packages/core.

import type { ConfirmedFields, ExtractionResult } from "./ai";
import type { Cents, GrantStatus, ReceiptStatus } from "./grants";

export interface PatientSummary {
  id: string;
  /** Fictional display name. */
  displayName: string;
}

export interface Provider {
  id: string;
  name: string;
  /** e.g. "pharmacy". */
  kind: string;
}

export const DEVICE_ROLES = ["kiosk", "provider", "reviewer"] as const;
export type DeviceRole = (typeof DEVICE_ROLES)[number];

export interface Device {
  id: string;
  role: DeviceRole;
  label: string;
  /** Set for provider devices. */
  providerId: string | null;
}

export type DocumentSource = "scan" | "nessie_bill" | "nessie_purchase";

export type DocumentStatus = "extracting" | "extracted" | "unreadable" | "confirmed";

export interface DocumentRecord {
  id: string;
  patientId: string;
  source: DocumentSource;
  status: DocumentStatus;
  /** Present once extraction finished. */
  extraction: ExtractionResult | null;
  /** Present once the patient confirmed the fields. */
  confirmed: ConfirmedFields | null;
  /** Authorized URL for the source image (scans only). */
  imageUrl: string | null;
  createdAt: string;
}

/** A likely-medical Nessie bill or purchase offered to the patient (SPEC §4 "Bills found"). */
export interface FoundBill {
  /** Nessie bill or purchase ID. */
  id: string;
  source: Exclude<DocumentSource, "scan">;
  merchant: string;
  date: string | null;
  amountCents: Cents;
  likelyMedical: boolean;
  reason: string;
}

export interface Receipt {
  nessiePaymentId: string | null;
  solanaSignature: string | null;
  /** Explorer link for the devnet signature. */
  explorerUrl: string | null;
  receiptStatus: ReceiptStatus;
}

export interface Grant {
  id: string;
  patient: PatientSummary;
  documentId: string;
  provider: Provider;
  programId: string;
  programName: string;
  requestedCents: Cents;
  approvedCents: Cents | null;
  status: GrantStatus;
  /** What the patient confirmed, shown to the reviewer next to the source. */
  confirmedFields: ConfirmedFields;
  /** Extraction warnings, including the injection flag (SPEC §7). */
  warnings: string[];
  createdAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  /** Present once redemption started. */
  receipt: Receipt | null;
}

export type FundEventType = "donation" | "reservation" | "release" | "payout" | "receipt";

export interface FundLedgerEntry {
  type: FundEventType;
  /** Opaque reference; never a patient identifier. */
  reference: string;
  amountCents: Cents;
  solanaSignature: string | null;
  at: string;
}

export interface FundSummary {
  totalCents: Cents;
  availableCents: Cents;
  reservedCents: Cents;
  paidCents: Cents;
  approvedCount: number;
  paidCount: number;
  /** Daily totals from the TimescaleDB continuous aggregate (empty when not available). */
  daily: { day: string; approvedCents: Cents; paidCents: Cents }[];
  recent: FundLedgerEntry[];
}
