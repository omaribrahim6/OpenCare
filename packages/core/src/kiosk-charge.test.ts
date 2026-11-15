import assert from "node:assert/strict";
import { test } from "node:test";
import { assessNeed } from "@abdulcare/ai";
import type { NeedEngine } from "@abdulcare/contracts";
import { fallbackBillEngine } from "./bill-fallback";
import { pairDevice } from "./devices";
import { KIOSK_CHARGE_FALLBACK_PATIENT, kioskChargePatient, recordKioskCharge } from "./kiosk-charge";
import { assessGrant } from "./need";
import { getPortalOverview, setPatientAccount, signInToPortal } from "./portal";
import { setPatientProfile } from "./profiles";
import { createTestDb, seedBasics } from "./test-helpers";
import { CoreError } from "./util";

// The severe crash preset: $456,832.16, three discounts, $310,645.00 left (whole dollars).
const items = [
  { label: "Craniotomy, evacuation of subdural hematoma", cents: 14_860_000 },
  { label: "Facial reconstruction, orbital and maxillary repair", cents: 6_430_000 },
  { label: "Everything else", cents: 24_393_216 },
];
const discounts = [
  { label: "Uninsured self-pay discount", cents: 5_481_986 },
  { label: "Hospital financial assistance policy", cents: 6_852_482 },
  { label: "Prompt-pay discount", cents: 2_284_248 },
];
const engines = { bills: fallbackBillEngine };

async function setup() {
  const db = await createTestDb();
  await seedBasics(db);
  await db.query("insert into providers (id, name, kind) values ('prv_demo_hospital', 'Valley General Hospital', 'hospital')");
  await db.query("insert into patients (id, display_name) values ('pat_demo_john', 'John Doe (fictional)')");
  await setPatientProfile(db, "pat_demo_john", { householdSize: 4, monthlyIncomeCents: 65_000, insurance: "uninsured" });
  await setPatientAccount(db, "pat_demo_john", { accountCode: "otc7-jd4-rx19", birthDate: "1999-01-01" });
  const { device } = await pairDevice(db, { role: "kiosk", label: "Kiosk phone", pin: "4242" });
  return { db, device };
}

const charge = (device: Awaited<ReturnType<typeof setup>>["device"], extra: Record<string, unknown> = {}) => ({
  device,
  patientId: "pat_demo_john",
  items,
  discounts,
  method: "nfc",
  preset: "car_accident",
  outcome: "fund_request",
  ...extra,
});

test("a fund request bills the tapped patient: itemized visit, discounts, and a claim for the rest", async () => {
  const { db, device } = await setup();
  const rec = await recordKioskCharge(db, charge(device), engines);

  assert.equal(rec.originalCents, 45_683_216);
  assert.equal(rec.remainingCents, 31_064_500);
  assert.ok(rec.grant);
  assert.equal(rec.id, rec.grant.id);
  assert.equal(rec.grant.status, "pending_review");
  assert.equal(rec.grant.requestedCents, 31_064_500);
  assert.equal(rec.grant.provider.id, "prv_demo_hospital");

  // It shows up in the patient's own portal with the steps the kiosk showed.
  const { patient } = await signInToPortal(db, { accountCode: "otc7-jd4-rx19", birthDate: "1999-01-01" });
  const overview = await getPortalOverview(db, patient);
  assert.deepEqual(overview.claims.map((g) => g.id), [rec.grant.id]);
  const bill = overview.bills[0];
  assert.equal(bill.visit.category, "emergency");
  assert.equal(bill.visit.lineItems.length, 3);
  assert.equal(bill.remainingCents, 31_064_500);
  assert.deepEqual(
    bill.steps.slice(1).map((s) => s.reductionCents),
    discounts.map((d) => d.cents),
  );
});

test("John Doe's kiosk claim scores 90 on the real need formula", async () => {
  const { db, device } = await setup();
  const rec = await recordKioskCharge(db, charge(device), engines);
  const need = { assessNeed } as unknown as NeedEngine;
  const { assessment } = await assessGrant(db, need, rec.id, { depositIncomeCents: null });
  assert.equal(assessment.score, 90);
});

test("a resend of the same charge returns the same claim instead of a second one", async () => {
  const { db, device } = await setup();
  const first = await recordKioskCharge(db, charge(device), engines);
  const again = await recordKioskCharge(db, charge(device), engines);
  assert.equal(again.id, first.id);
  assert.equal(again.visitId, first.visitId);
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from grants where patient_id = 'pat_demo_john'");
  assert.equal(Number(rows[0].n), 1);
});

test("'paid' records the payment and opens no claim", async () => {
  const { db, device } = await setup();
  const rec = await recordKioskCharge(db, charge(device, { outcome: "paid" }), engines);
  assert.equal(rec.grant, null);
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from grants");
  assert.equal(Number(rows[0].n), 0);
});

test("bad bills are refused", async () => {
  const { db, device } = await setup();
  const bad = (err: unknown) => err instanceof CoreError && err.code === "bad_request";
  await assert.rejects(recordKioskCharge(db, charge(device, { items: [] }), engines), bad);
  await assert.rejects(recordKioskCharge(db, charge(device, { items: [{ label: "x", cents: -5 }] }), engines), bad);
  await assert.rejects(recordKioskCharge(db, charge(device, { discounts: [{ label: "All of it", cents: 45_683_216 }] }), engines), bad);
  await assert.rejects(recordKioskCharge(db, charge(device, { outcome: "maybe" }), engines), bad);
});

test("the kiosk app must have a tapped card; the web hold demo still bills the demo patient", () => {
  assert.equal(kioskChargePatient("pat_1", { requireCard: true }), "pat_1");
  assert.equal(kioskChargePatient("pat_1", { requireCard: false }), "pat_1");
  assert.equal(kioskChargePatient(null, { requireCard: false }), KIOSK_CHARGE_FALLBACK_PATIENT);
  assert.throws(
    () => kioskChargePatient(null, { requireCard: true }),
    (err) => err instanceof CoreError && err.code === "unauthenticated",
  );
  assert.throws(() => kioskChargePatient(undefined, { requireCard: true }), CoreError);
});
