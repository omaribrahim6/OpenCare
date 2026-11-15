import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackBillEngine } from "./bill-fallback";
import { issueCard } from "./cards";
import { pairDevice } from "./devices";
import { completePayout, decideGrant, getGrant } from "./grants";
import { recordKioskCharge } from "./kiosk-charge";
import {
  PORTAL_MAX_FAILURES,
  endPortalSession,
  getPortalOverview,
  getPortalPatient,
  normalizeAccountCode,
  payPatientBalance,
  setPatientAccount,
  signInToPortal,
} from "./portal";
import { createTestDb, seedBasics } from "./test-helpers";
import { CoreError } from "./util";

async function setup() {
  const db = await createTestDb();
  await seedBasics(db);
  await setPatientAccount(db, "pat_1", { accountCode: "otc7-jd4-rx19", birthDate: "1999-01-01" });
  return db;
}

const code = (err: unknown) => (err instanceof CoreError ? err.code : String(err));

test("account IDs match regardless of case, dashes and o/0, i/l/1 mix-ups", () => {
  assert.equal(normalizeAccountCode("otc7-jd4-rx19"), normalizeAccountCode("0TC7 JD4 RX19"));
  assert.equal(normalizeAccountCode("OTC7-JD4-RXl9"), "0tc7jd4rx19");
});

test("signs in with the printed account ID and birth date, and the session resolves", async () => {
  const db = await setup();
  const { patient, secret } = await signInToPortal(db, { accountCode: "0TC7-JD4-RX19", birthDate: "1999-01-01" });
  assert.equal(patient.id, "pat_1");
  assert.equal(patient.accountCode, "otc7-jd4-rx19");
  assert.equal(patient.birthYear, 1999);
  assert.equal((await getPortalPatient(db, secret))?.id, "pat_1");

  await endPortalSession(db, secret);
  assert.equal(await getPortalPatient(db, secret), null);
});

test("a wrong birth date or unknown account gets the same refusal", async () => {
  const db = await setup();
  for (const input of [
    { accountCode: "otc7-jd4-rx19", birthDate: "1999-01-02" },
    { accountCode: "nope-nope-00", birthDate: "1999-01-01" },
  ]) {
    await assert.rejects(signInToPortal(db, input), (err) => code(err) === "unauthenticated");
  }
  await assert.rejects(signInToPortal(db, { accountCode: "otc7-jd4-rx19", birthDate: "1999-02-30" }), (err) => code(err) === "bad_request");
});

test("sign-in pauses after too many wrong birth dates", async () => {
  const db = await setup();
  for (let i = 0; i < PORTAL_MAX_FAILURES; i++) {
    await assert.rejects(signInToPortal(db, { accountCode: "otc7-jd4-rx19", birthDate: `1990-01-0${i + 1}` }));
  }
  await assert.rejects(
    signInToPortal(db, { accountCode: "otc7-jd4-rx19", birthDate: "1999-01-01" }),
    (err) => code(err) === "forbidden",
  );
});

test("a CareCard tap on the patient's own phone signs in with the birth date", async () => {
  const db = await setup();
  const { token } = await issueCard(db, "pat_1");
  const { patient } = await signInToPortal(db, { cardToken: token, birthDate: "1999-01-01" });
  assert.equal(patient.id, "pat_1");
  await assert.rejects(signInToPortal(db, { cardToken: token, birthDate: "2000-01-01" }), (err) => code(err) === "unauthenticated");
});

test("the overview lists only the patient's own bills and claims", async () => {
  const db = await setup();
  for (const [visit, patient] of [["visit_mine", "pat_1"], ["visit_other", "pat_2"]]) {
    await db.query(
      `insert into visits (id, patient_id, hospital_id, category, description, line_items, total_cents, attested_by, idempotency_key)
       values ($1, $2, 'prv_1', 'emergency', 'Car accident', '[{"description":"Craniotomy","cents":10000}]', 10000, 'Hospital', $1)`,
      [visit, patient],
    );
    await db.query(
      `insert into bill_events (id, visit_id, type, amount_cents, source_kind, source_label, label, seq)
       values ($1, $2, 'charge', 10000, 'hospital', 'Hospital', 'Charge', 1)`,
      [`event_${visit}`, visit],
    );
    await db.query(
      `insert into grants (id, patient_id, visit_id, provider_id, requested_cents, status)
       values ($1, $2, $3, 'prv_1', 10000, 'pending_review')`,
      [`grant_${visit}`, patient, visit],
    );
  }
  const { patient } = await signInToPortal(db, { accountCode: "otc7-jd4-rx19", birthDate: "1999-01-01" });
  const overview = await getPortalOverview(db, patient);
  assert.deepEqual(overview.bills.map((b) => b.visit.id), ["visit_mine"]);
  assert.equal(overview.bills[0].remainingCents, 10000);
  assert.deepEqual(overview.claims.map((g) => g.id), ["grant_visit_mine"]);
});

// A kiosk charge leaves $1,234.56 for the fund, so partial approvals and paying the rest can be tested.
async function claimSetup() {
  const db = await createTestDb();
  await seedBasics(db, 1_000_000);
  await db.query("insert into providers (id, name, kind) values ('prv_demo_hospital', 'Valley General Hospital', 'hospital')");
  const { device: kiosk } = await pairDevice(db, { role: "kiosk", label: "Kiosk phone", pin: "4242" });
  const { device: reviewer } = await pairDevice(db, { role: "reviewer", label: "Caseworker", pin: "4242" });
  const rec = await recordKioskCharge(
    db,
    { device: kiosk, patientId: "pat_1", items: [{ label: "ER visit", cents: 123_456 }], discounts: [], method: "nfc", preset: null, outcome: "fund_request" },
    { bills: fallbackBillEngine },
  );
  assert.ok(rec.grant);
  return { db, reviewer, grantId: rec.grant.id, visitId: rec.visitId };
}

test("a reviewer can approve part of a request, in cents, and the patient pays the rest", async () => {
  const { db, reviewer, grantId, visitId } = await claimSetup();
  const approved = await decideGrant(db, grantId, reviewer.id, { decision: "approve", approvedCents: 100_050 });
  assert.equal(approved.approvedCents, 100_050);
  assert.equal(approved.requestedCents, 123_456);

  // Still being paid: the patient can't pay yet.
  await assert.rejects(payPatientBalance(db, { patientId: "pat_1", visitId, amountCents: 23_406 }), (err) => code(err) === "invalid_state");

  await db.query("update grants set status = 'payment_pending' where id = $1", [grantId]);
  await completePayout(db, grantId);
  assert.equal((await getGrant(db, grantId)).status, "paid");

  // Someone else, or a stale amount, pays nothing.
  await assert.rejects(payPatientBalance(db, { patientId: "pat_2", visitId, amountCents: 23_406 }), (err) => code(err) === "forbidden");
  await assert.rejects(payPatientBalance(db, { patientId: "pat_1", visitId, amountCents: 23_400 }), (err) => code(err) === "conflict");

  const paid = await payPatientBalance(db, { patientId: "pat_1", visitId, amountCents: 23_406 });
  assert.equal(paid.paidCents, 23_406);
  assert.equal(paid.bill.patientPaidCents, 23_406);
  assert.equal(paid.bill.fundPaidCents, 100_050);
  assert.equal(paid.bill.remainingCents, 0);

  // Paying again does nothing.
  const again = await payPatientBalance(db, { patientId: "pat_1", visitId, amountCents: 23_406 });
  assert.equal(again.paidCents, 0);
  assert.equal(again.bill.patientPaidCents, 23_406);
});

test("after a denial the patient can pay the whole balance out of pocket", async () => {
  const { db, reviewer, grantId, visitId } = await claimSetup();
  await decideGrant(db, grantId, reviewer.id, { decision: "reject" });
  const paid = await payPatientBalance(db, { patientId: "pat_1", visitId, amountCents: 123_456 });
  assert.equal(paid.paidCents, 123_456);
  assert.equal(paid.bill.remainingCents, 0);
  const overview = await getPortalOverview(db, { id: "pat_1", displayName: "Test Patient", accountCode: null, birthYear: null });
  assert.equal(overview.claims[0].status, "rejected");
  assert.equal(overview.bills[0].remainingCents, 0);
});
