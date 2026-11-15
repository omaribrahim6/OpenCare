// The staff itemized bill at /kiosk/charge: line items, the "Car accident demo" preset, and the
// scripted discount search. Pure functions; every amount is integer cents.

export type ChargeLine = { label: string; cents: number };
export type ChargeMethod = "nfc" | "hold";

/** A car accident bill, at a tenth of what a US hospital charges. Totals $45,683.23. */
export const CAR_ACCIDENT_PRESET: ChargeLine[] = [
  { label: "Trauma team activation", cents: 184_500 },
  { label: "ALS ambulance", cents: 38_754 },
  { label: "ER level 5 critical care", cents: 129_600 },
  { label: "CT head + C-spine", cents: 98_428 },
  { label: "MRI brain w/ contrast", cents: 76_152 },
  { label: "Cranioplasty (skull reconstruction)", cents: 1_984_000 },
  { label: "OR time, 6 h", cents: 423_000 },
  { label: "Anesthesia", cents: 167_805 },
  { label: "Neurosurgeon fee", cents: 385_000 },
  { label: "ICU bed, 4 nights", cents: 528_000 },
  { label: "Med-surg bed, 6 nights", cents: 279_000 },
  { label: "Bandages and wound dressings", cents: 42_869 },
  { label: "Painkillers (IV morphine, oxycodone)", cents: 39_127 },
  { label: "Labs and blood panels", cents: 64_183 },
  { label: "Physical therapy", cents: 42_500 },
  { label: "Supplies and pharmacy misc", cents: 85_405 },
];
export const CAR_ACCIDENT_PRESET_ID = "car_accident";

export const MAX_LINES = 60;
export const MAX_LABEL = 80;

export const total = (lines: ChargeLine[]) => lines.reduce((sum, l) => sum + l.cents, 0);

export type CheckStep = {
  id: "insurance" | "policy" | "discounts";
  title: string;
  /** Shown one after another while this step loads. */
  working: string[];
  /** Shown once it lands. */
  detail: string;
};

/**
 * After the card is scanned the bill is checked in this order (about 20 s in all), each step
 * taking its discount off. Together they take 32% off: on the preset, -$14,618.63.
 */
export const CHECK_STEPS: CheckStep[] = [
  {
    id: "insurance",
    title: "Insurance",
    working: ["Matching insurance", "Checking auto policy med-pay coverage", "Comparing negotiated rates"],
    detail: "Auto med-pay and the plan's negotiated rate (simulated).",
  },
  {
    id: "policy",
    title: "Hospital financial assistance policy",
    working: ["Checking charity care", "Screening income against the hospital's policy", "Applying charity care"],
    detail: "Charity care under the hospital's policy (simulated).",
  },
  {
    id: "discounts",
    title: "Prompt-pay discount",
    working: ["Applying discounts", "Checking self-pay discounts"],
    detail: "Self-pay discount for paying today (simulated).",
  },
];
export const CHECK_STEP_MS = 6000;
export const CHECK_MESSAGE_MS = 2000;

/** The discount each check step takes off: 12% insurance, 15% charity care, the rest prompt-pay. */
export function discountsFor(originalCents: number): Record<CheckStep["id"], number> {
  const all = Math.round(originalCents * 0.32);
  const insurance = Math.round(originalCents * 0.12);
  const policy = Math.round(originalCents * 0.15);
  return { insurance, policy, discounts: all - insurance - policy };
}

/** Parses "12,960.00" or "$3,875.4" into cents; null if it isn't a positive amount. */
export function parseCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
}

/** Cents as an input value: 1296000 -> "12,960.00". */
export const centsText = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Full-cents currency for the bill, receipt and totals: $45,683.23, $1,845.00. */
export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
