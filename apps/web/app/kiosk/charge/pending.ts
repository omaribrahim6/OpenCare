// The charge waiting to be paid, kept in this browser between /kiosk/charge (staff press Charge)
// and /kiosk/charge/paid (opened by the reader). Storage can be blocked, so every call is safe.

import type { KioskChargeResult } from "@/lib/api";
import { CAR_ACCIDENT_PRESET, CAR_ACCIDENT_PRESET_ID, discountsFor, total, type ChargeLine, type ChargeMethod } from "./bill";

export type PaidReceipt = {
  no: string;
  paidAt: string;
  method: ChargeMethod;
  /** Null while the receipt is still being sent to admin. */
  sent: KioskChargeResult | null;
};

export type PendingCharge = {
  items: ChargeLine[];
  discounts: ChargeLine[];
  preset: string | null;
  createdAt: string;
  receipt: PaidReceipt | null;
};

const KEY = "abdulcare-kiosk-charge";

/** The fixed page the card reader opens once a card is scanned. */
export const PAID_PATH = "/kiosk/charge/paid";

export function savePending(charge: PendingCharge) {
  try {
    localStorage.setItem(KEY, JSON.stringify(charge));
  } catch {
    // Storage blocked: the paid page falls back to the demo bill.
  }
}

export function loadPending(): PendingCharge | null {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as PendingCharge) : null;
    return data && Array.isArray(data.items) && data.items.length > 0 && Array.isArray(data.discounts) ? data : null;
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

/** What the paid page shows when this browser has no charge waiting: the car accident demo. */
export function demoCharge(): PendingCharge {
  return {
    items: CAR_ACCIDENT_PRESET,
    discounts: discountsFor(total(CAR_ACCIDENT_PRESET)),
    preset: CAR_ACCIDENT_PRESET_ID,
    createdAt: new Date().toISOString(),
    receipt: null,
  };
}
