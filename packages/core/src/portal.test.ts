import assert from "node:assert/strict";
import { test } from "node:test";
import { issueCard } from "./cards";
import {
  PORTAL_MAX_FAILURES,
  endPortalSession,
  getPortalOverview,
  getPortalPatient,
  normalizeAccountCode,
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
