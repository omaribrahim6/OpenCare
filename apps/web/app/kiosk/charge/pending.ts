// The bill waiting for the patient, kept in this browser between /kiosk/charge (staff press
// Charge) and /kiosk/charge/card (opened by the card scan). Storage can be blocked, so every call
// is safe.

import type { KioskChargeResult } from "@/lib/api";
import { CAR_ACCIDENT_PRESET, CAR_ACCIDENT_PRESET_ID, type ChargeLine, type ChargeMethod } from "./bill";

/** How the patient settled the remaining balance. */
export type ChargeOutcome = {
  kind: "paid" | "fund_request";
  no: string;
  at: string;
  method: ChargeMethod;
  discounts: ChargeLine[];
  /** Paid by card, or asked of the community care fund. */
  cents: number;
  /** Null while it is still being sent to admin. */
  sent: KioskChargeResult | null;
};

export type PendingCharge = {
  items: ChargeLine[];
  preset: string | null;
  createdAt: string;
  outcome: ChargeOutcome | null;
};

const KEY = "abdulcare-kiosk-charge";

/** The fixed page a card scan opens. */
export const CARD_PATH = "/kiosk/charge/card";

export function savePending(charge: PendingCharge) {
  try {
    localStorage.setItem(KEY, JSON.stringify(charge));
  } catch {
    // Storage blocked: the card page falls back to the demo bill.
  }
}

export function loadPending(): PendingCharge | null {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as PendingCharge) : null;
    return data && Array.isArray(data.items) && data.items.length > 0 ? { ...data, outcome: data.outcome ?? null } : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** What the card page uses when this browser has no bill waiting: the car accident demo. */
export function demoCharge(): PendingCharge {
  return { items: CAR_ACCIDENT_PRESET, preset: CAR_ACCIDENT_PRESET_ID, createdAt: new Date().toISOString(), outcome: null };
}
