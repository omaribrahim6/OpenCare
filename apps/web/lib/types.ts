// UI types. Every API shape comes from @abdulcare/contracts; only display helpers live here.

import type { ExpenseCategory, InsuranceStatus, PatientSummary } from "@abdulcare/contracts";

export type {
  Cents,
  DocumentRecord,
  DonationResponse,
  Explanation,
  ExpenseCategory,
  FoundBill,
  FundSummary,
  Grant,
  GrantStatus,
  InsuranceStatus,
  NeedAssessment,
  NeedFactor,
  PatientProfile,
  PatientSummary,
  Provider,
  QueueItem,
  Receipt,
  ReviewQueue,
  SuspiciousContent,
} from "@abdulcare/contracts";

export { MAX_HARDSHIP_NOTE_CHARS, SECOND_APPROVAL_ABOVE_CENTS } from "@abdulcare/contracts";

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  pharmacy: "Pharmacy",
  emergency: "Emergency",
  hospital: "Hospital",
  primary_care: "Primary care",
  dental_vision: "Dental / vision",
  other_medical: "Other medical",
};

export const INSURANCE_LABEL: Record<InsuranceStatus, string> = {
  uninsured: "Uninsured",
  underinsured: "Underinsured",
  insured: "Insured",
};

export const SUSPICIOUS_FIELD_LABEL = {
  merchant: "merchant name",
  description: "bill description",
  hardship_note: "hardship note",
} as const;

/** Kiosk-only tap outcomes (the provider's "redemption" outcome is handled on /provider). */
export type KioskTapResult =
  | { kind: "session"; patient: PatientSummary }
  | { kind: "unknown_card" }
  | { kind: "unpaired_device" };
