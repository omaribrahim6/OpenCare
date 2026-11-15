import assert from "node:assert/strict";
import { test } from "node:test";
import { clearDemoData } from "../db/demo-reset";
import { pairDevice } from "./devices";
import { createTestDb, seedBasics } from "./test-helpers";

test("reset preserves the historical ledger and rebuilds the fund from it", async () => {
  const db = await createTestDb();
  await seedBasics(db);
  const { device } = await pairDevice(db, { role: "kiosk", label: "Rehearsal", pin: "4242" });
  await db.query("insert into patients (id, display_name) values ('pat_hist_example', 'Historical example')");

  for (const [kind, patient] of [["hist", "pat_hist_example"], ["demo", "pat_1"]]) {
    const visit = `visit_${kind}`;
    const grant = `grant_${kind}`;
    const reference = `public_${kind}`;
    const donation = `don_${kind}_sample`;
    await db.query(`
      insert into visits (id, patient_id, hospital_id, category, description, line_items, total_cents, attested_by, idempotency_key)
      values ($1, $2, 'prv_1', 'emergency', 'Emergency visit', '[]', 10000, 'Hospital', $1)
    `, [visit, patient]);
    await db.query(`
      insert into bill_events (id, visit_id, type, amount_cents, source_kind, source_label, label, seq)
      values ($1, $2, 'charge', 10000, 'hospital', 'Hospital', 'Charge', 1)
    `, [`event_${kind}`, visit]);
    await db.query(`
      insert into grants (id, patient_id, visit_id, provider_id, requested_cents, approved_cents, status, public_ref)
      values ($1, $2, $3, 'prv_1', 10000, 10000, 'paid', $4)
    `, [grant, patient, visit, reference]);
    await db.query(`
      insert into payment_attempts (id, grant_id, rail, idempotency_key, recipient, external_id, status)
      values ($1, $2, 'solana', $1, 'wallet', $3, 'confirmed')
    `, [`attempt_${kind}`, grant, `signature_${kind}`]);
    await db.query(`
      insert into donations (id, rail, amount_cents, solana_signature)
      values ($1, 'solana', 50000, $2)
    `, [donation, `signature_donation_${kind}`]);
    await db.query(`
      insert into fund_events (type, grant_ref, amount_cents, solana_signature)
      values ('payout', $1, 10000, null), ('receipt', $1, 0, $2), ('donation', $3, 50000, $4)
    `, [reference, `signature_${kind}`, donation, `signature_donation_${kind}`]);
    await db.query(`
      insert into sessions (secret_hash, device_id, patient_id, expires_at)
      values ($1, $2, $3, now() + interval '15 minutes')
    `, [`session_${kind}`, device.id, patient]);
  }
  await db.query(`
    insert into visits (id, patient_id, hospital_id, category, description, line_items, total_cents, attested_by, idempotency_key)
    values ('visit_hist_pending', 'pat_hist_example', 'prv_1', 'emergency', 'Emergency visit', '[]', 5000, 'Hospital', 'hist_pending')
  `);
  await db.query(`
    insert into grants (id, patient_id, visit_id, provider_id, requested_cents, approved_cents, status, public_ref)
    values ('grant_hist_pending', 'pat_hist_example', 'visit_hist_pending', 'prv_1', 5000, 5000, 'payment_pending', 'public_hist_pending')
  `);
  await db.query("update fund set total_cents = 100000, paid_cents = 20000, reserved_cents = 5000");

  await clearDemoData(db);
  await clearDemoData(db);

  const { rows: grants } = await db.query<{ id: string }>("select id from grants order by id");
  assert.deepEqual(grants.map((g) => g.id), ["grant_hist", "grant_hist_pending"]);
  const { rows: attempts } = await db.query<{ external_id: string }>("select external_id from payment_attempts");
  assert.deepEqual(attempts, [{ external_id: "signature_hist" }]);
  const { rows: visits } = await db.query<{ id: string }>("select id from visits order by id");
  assert.deepEqual(visits.map((v) => v.id), ["visit_hist", "visit_hist_pending"]);
  const { rows: billEvents } = await db.query<{ id: string }>("select id from bill_events");
  assert.deepEqual(billEvents, [{ id: "event_hist" }]);
  const { rows: donations } = await db.query<{ id: string }>("select id from donations");
  assert.deepEqual(donations, [{ id: "don_hist_sample" }]);
  const { rows: ledger } = await db.query("select type, grant_ref, solana_signature from fund_events order by type");
  assert.deepEqual(ledger, [
    { type: "donation", grant_ref: "don_hist_sample", solana_signature: "signature_donation_hist" },
    { type: "payout", grant_ref: "public_hist", solana_signature: null },
    { type: "receipt", grant_ref: "public_hist", solana_signature: "signature_hist" },
  ]);
  const { rows: balances } = await db.query(`
    select total_cents::int, paid_cents::int, reserved_cents::int from fund
  `);
  assert.deepEqual(balances, [{ total_cents: 50000, paid_cents: 10000, reserved_cents: 5000 }]);
  const { rows: active } = await db.query("select secret_hash from sessions where ended_at is null");
  assert.deepEqual(active, [{ secret_hash: "session_hist" }]);
});
