// Kiosk charges (/kiosk/charge): staff build an itemized bill, the patient taps their CareCard, the
// kiosk takes off the discounts, and the patient sends the rest to the community fund. This turns
// that into the real records: a visit with the itemized lines and one event per discount, then a
// fund request for what's left (requestHelp), so it is ranked in the admin queue, paid out through
// payments on approval, and shown in the patient's /user.

import type { BillEngine, Device, Grant } from "@abdulcare/contracts";
import type { Db } from "./db";
import { getGrant, requestHelp } from "./grants";
import { CoreError, newId, sha256 } from "./util";
import { getBill } from "./visits";

export const KIOSK_CHARGE_MAX_ITEMS = 60;
export const KIOSK_CHARGE_MAX_DISCOUNTS = 10;
const MAX_LABEL = 120;
/** A resend of the same bill for the same patient within this window returns the first result. */
const DEDUPE_MINUTES = 10;
/** Who a kiosk charge bills when no CareCard was tapped (the presenter's hold fallback). */
export const KIOSK_CHARGE_FALLBACK_PATIENT = "pat_demo_john";

export interface KioskChargeLine {
  label: string;
  cents: number;
}

export interface KioskChargeInput {
  device: Device;
  patientId: string;
  items: unknown;
  discounts: unknown;
  method: unknown;
  preset: unknown;
  outcome: unknown;
}

export interface KioskChargeRecord {
  /** The fund request's ID for 'fund_request', otherwise the visit's. */
  id: string;
  visitId: string;
  patientId: string;
  outcome: "fund_request" | "paid";
  originalCents: number;
  discountCents: number;
  remainingCents: number;
  grant: Grant | null;
}

function lines(value: unknown, what: string, max: number, min: number): KioskChargeLine[] {
  if (!Array.isArray(value)) throw new CoreError("bad_request", `${what} must be a list`);
  if (value.length < min || value.length > max) throw new CoreError("bad_request", `${what}: ${min} to ${max} lines`);
  return value.map((raw, i) => {
    const label = typeof raw?.label === "string" ? raw.label.trim() : "";
    const cents = raw?.cents;
    if (!label || label.length > MAX_LABEL) throw new CoreError("bad_request", `${what} line ${i + 1} needs a label up to ${MAX_LABEL} characters`);
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new CoreError("bad_request", `${what} line ${i + 1} needs a positive amount in cents`);
    return { label, cents };
  });
}

/** The hospital kiosk charges are billed for: the demo hospital, or the first hospital on file. */
async function chargeHospital(db: Db): Promise<{ id: string; name: string }> {
  const { rows } = await db.query<{ id: string; name: string }>(
    "select id, name from providers where kind = 'hospital' order by (id = 'prv_demo_hospital') desc, id limit 1",
  );
  if (!rows[0]) throw new CoreError("invalid_state", "No hospital is set up to bill");
  return rows[0];
}

export async function recordKioskCharge(
  db: Db,
  input: KioskChargeInput,
  engines: { bills: BillEngine },
): Promise<KioskChargeRecord> {
  const items = lines(input.items, "Items", KIOSK_CHARGE_MAX_ITEMS, 1);
  const discounts = lines(input.discounts ?? [], "Discounts", KIOSK_CHARGE_MAX_DISCOUNTS, 0);
  const outcome = input.outcome === "paid" ? "paid" : input.outcome === "fund_request" ? "fund_request" : null;
  if (!outcome) throw new CoreError("bad_request", "outcome must be 'fund_request' or 'paid'");
  const method = input.method === "nfc" || input.method === "hold" ? input.method : "hold";
  const preset = typeof input.preset === "string" ? input.preset.slice(0, 40) : null;

  const originalCents = items.reduce((s, l) => s + l.cents, 0);
  const discountCents = discounts.reduce((s, l) => s + l.cents, 0);
  if (discountCents >= originalCents) throw new CoreError("bad_request", "Discounts must leave something to pay");
  const remainingCents = originalCents - discountCents;

  // Same device, patient and bill within the window: a resend (reload, double tap), not a new visit.
  const bucket = Math.floor(Date.now() / (DEDUPE_MINUTES * 60_000));
  const key = `kiosk:${sha256(JSON.stringify([input.device.id, input.patientId, items, discounts, outcome, bucket]))}`;
  const { rows: prior } = await db.query<{ id: string }>("select id from visits where idempotency_key = $1", [key]);

  let visitId = prior[0]?.id;
  if (!visitId) {
    const hospital = await chargeHospital(db);
    const carAccident = preset === "car_accident";
    visitId = newId("vis");
    const id = visitId;
    await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into visits (id, patient_id, hospital_id, category, description, line_items, total_cents,
                             device_id, attested_by, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (idempotency_key) do nothing
         returning id`,
        [
          id,
          input.patientId,
          hospital.id,
          carAccident ? "emergency" : "hospital",
          carAccident ? "Car accident: brain surgery and facial reconstruction" : "Hospital stay",
          JSON.stringify(items.map((l) => ({ description: l.label, cents: l.cents }))),
          originalCents,
          input.device.id,
          `${input.device.label} (kiosk charge, simulated hospital intake, ${method === "nfc" ? "CareCard tap" : "hold to tap"})`,
          key,
        ],
      );
      if (!rows[0]) return; // A concurrent resend won; read its visit below.

      let seq = 0;
      const post = (type: string, amount: number, kind: string, sourceLabel: string, reference: string | null, label: string, simulated: boolean) =>
        tx.query(
          `insert into bill_events (id, visit_id, type, amount_cents, source_kind, source_label, source_id,
                                    status, simulated, reference, label, seq)
           values ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10, $11)`,
          [newId("bev"), id, type, amount, kind, sourceLabel, kind === "patient" ? null : hospital.id, simulated, reference, label, ++seq],
        );
      await post("charge", originalCents, "hospital", hospital.name, null, `Itemized bill at ${hospital.name} (hospital-attested)`, false);
      for (const [i, d] of discounts.entries()) {
        await post("hospital_assistance", d.cents, "policy", hospital.name, `kiosk_discount_${i + 1}`, `${d.label} (simulated)`, true);
      }
      if (outcome === "paid") {
        await post("patient_payment", remainingCents, "patient", "Patient", null, "Paid at the kiosk (simulated)", true);
      }
    });
    visitId = (await db.query<{ id: string }>("select id from visits where idempotency_key = $1", [key])).rows[0]?.id ?? id;
  }

  if (outcome === "paid") {
    return { id: visitId, visitId, patientId: input.patientId, outcome, originalCents, discountCents, remainingCents, grant: null };
  }

  // requestHelp returns the live request if this visit already has one, so a resend is safe.
  const bill = await getBill(db, visitId, { patientId: input.patientId });
  const grant =
    bill.remainingCents > 0
      ? await requestHelp(db, { patientId: input.patientId, visitId }, engines)
      : await (async () => {
          const { rows } = await db.query<{ id: string }>("select id from grants where visit_id = $1 order by created_at desc limit 1", [visitId]);
          if (!rows[0]) throw new CoreError("invalid_state", "Nothing is left to pay on this bill");
          return getGrant(db, rows[0].id);
        })();
  return { id: grant.id, visitId, patientId: input.patientId, outcome, originalCents, discountCents, remainingCents, grant };
}
