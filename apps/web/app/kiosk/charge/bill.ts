// The staff itemized bill at /kiosk/charge: line items, the "Car accident demo" preset, and the
// AI discount check that runs after the CareCard tap. Pure functions; every amount is integer cents.

export type ChargeLine = { label: string; cents: number };
export type ChargeMethod = "nfc" | "hold";

/**
 * A severe car crash with brain surgery and facial reconstruction, at real US uninsured
 * (chargemaster) prices (Mohamed's preset). Totals exactly $456,832.16.
 */
export const CAR_ACCIDENT_PRESET: ChargeLine[] = [
  { label: "Ground ambulance, ALS emergency", cents: 387_540 },
  { label: "Trauma team activation", cents: 1_845_000 },
  { label: "ER critical care, level 5", cents: 1_296_000 },
  { label: "CT head, face and cervical spine", cents: 1_184_275 },
  { label: "MRI brain with contrast", cents: 761_520 },
  { label: "Craniotomy, evacuation of subdural hematoma (hospital and OR)", cents: 14_860_000 },
  { label: "Neurosurgeon professional fee", cents: 3_850_000 },
  { label: "Facial reconstruction, orbital and maxillary fracture repair (plates and screws)", cents: 6_430_000 },
  { label: "Plastic surgeon professional fee", cents: 2_175_000 },
  { label: "Anesthesia, two surgeries", cents: 1_948_050 },
  { label: "ICU bed, 4 nights", cents: 5_280_000 },
  { label: "Med-surg bed, 6 nights", cents: 2_790_000 },
  { label: "Bandages and wound dressings", cents: 428_690 },
  { label: "Painkillers (IV morphine, oxycodone)", cents: 391_265 },
  { label: "Labs and blood panels", cents: 641_830 },
  { label: "Physical therapy", cents: 425_000 },
  { label: "Supplies and pharmacy", cents: 989_046 },
];
export const CAR_ACCIDENT_PRESET_ID = "car_accident";

export const MAX_LINES = 60;
export const MAX_LABEL = 100;

export const total = (lines: ChargeLine[]) => lines.reduce((sum, l) => sum + l.cents, 0);

export type CheckStep = {
  id: "selfpay" | "policy" | "discounts";
  title: string;
  /** Shown one after another while this step loads. */
  working: string[];
  /** Shown once it lands. */
  detail: string;
};

/**
 * After the CareCard tap, AI checks the bill in this order (about 20 s in all), each step taking
 * its discount off. The demo patient is uninsured. On the preset: -$54,819.86, -$68,524.82 and
 * -$22,842.48, leaving $310,645.00.
 */
export const CHECK_STEPS: CheckStep[] = [
  {
    id: "selfpay",
    title: "Uninsured self-pay discount",
    working: ["Checking for insurance", "No insurance on file", "Applying the uninsured self-pay rate"],
    detail: "The hospital's rate for patients without insurance (simulated).",
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

/**
 * The discount each check step takes off: 12% self-pay, 15% charity care, and about 5% prompt-pay,
 * rounded so the balance left is whole dollars. Fund payouts move whole dollars only (Nessie), so
 * an approval then closes the bill at $0.
 */
export function discountsFor(originalCents: number): Record<CheckStep["id"], number> {
  const left = Math.floor((originalCents - Math.round(originalCents * 0.32)) / 100) * 100;
  const selfpay = Math.round(originalCents * 0.12);
  const policy = Math.round(originalCents * 0.15);
  return { selfpay, policy, discounts: Math.max(0, originalCents - left - selfpay - policy) };
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

/** Full-cents currency for the bill, receipt and totals: $456,832.16, $18,450.00. */
export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
