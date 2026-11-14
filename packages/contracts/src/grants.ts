// Grant and payment states (SPEC §8). All money is integer cents.

export type Cents = number;

export const GRANT_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "canceled",
  "payment_pending",
  "paid",
] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/** Allowed transitions. The server rejects anything else. */
export const GRANT_TRANSITIONS: Readonly<Record<GrantStatus, readonly GrantStatus[]>> = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: ["payment_pending", "canceled"],
  rejected: [],
  canceled: [],
  // Back to approved only when the payout attempt conclusively failed and was reconciled.
  payment_pending: ["paid", "approved"],
  paid: [],
};

export function canTransition(from: GrantStatus, to: GrantStatus): boolean {
  return GRANT_TRANSITIONS[from].includes(to);
}

export const PAYMENT_RAILS = ["nessie", "solana"] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

export const ATTEMPT_STATUSES = ["pending", "confirmed", "failed", "expired"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export type ReceiptStatus = "receipt_pending" | "receipt_confirmed";

/** @deprecated No longer enforced: one caseworker approval is enough at any amount. */
export const SECOND_APPROVAL_ABOVE_CENTS: Cents = 50_000;

/** Longest hardship note a patient can attach to a request. */
export const MAX_HARDSHIP_NOTE_CHARS = 500;
