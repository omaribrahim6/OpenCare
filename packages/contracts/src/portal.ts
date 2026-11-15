// Patient portal (/user): the patient's own view of their account on their phone.

import type { Bill, InsurancePlan } from "./bills";
import type { Cents } from "./grants";
import type { Grant, PatientProfile } from "./records";

export interface PortalPatient {
  id: string;
  /** Fictional display name. */
  displayName: string;
  /** Public account ID printed on the CareCard, e.g. "otc7-jd4-rx19". */
  accountCode: string | null;
  /** Only the year is shown back, like the masked date on the card. */
  birthYear: number | null;
}

// POST /api/user/session: sign in with the account ID (or the token from a CareCard tap on this
// phone) and the birth date. Sets an httpOnly portal cookie.
export interface PortalSignInRequest {
  accountCode?: string;
  cardToken?: string;
  /** YYYY-MM-DD */
  birthDate: string;
}

// POST and GET /api/user/session
export interface PortalSessionResponse {
  patient: PortalPatient;
}

// GET /api/user/me: everything the signed-in patient can see.
export interface PortalOverviewResponse {
  patient: PortalPatient;
  profile: PatientProfile;
  plan: InsurancePlan | null;
  /** Every visit's bill, newest first. */
  bills: Bill[];
  /** Every request to the community fund, newest first. */
  claims: Grant[];
}

// POST /api/user/bills/:visitId/pay: the signed-in patient pays what's left on a bill out of pocket
// (simulated), e.g. after the fund covered part of it or declined. amountCents must equal the
// balance the patient was shown; if it changed, the server refuses with 409 and nothing is paid.
export interface PortalPayRequest {
  amountCents: Cents;
}

export interface PortalPayResponse {
  bill: Bill;
  /** What this request paid; 0 when the bill was already paid off. */
  paidCents: Cents;
}
