// npm run payments:smoke -w @abdulcare/payments
// End-to-end check against the LIVE Nessie API and Solana devnet, using an embedded database
// instead of Tiger Cloud. It pays a $1 grant for a throwaway "Smoke Test" patient (never the demo
// patients' bills) and makes a $1 card donation, then repeats both to prove nothing doubles.

import { getLiveAttempt } from "@abdulcare/core";
import { createTestDb, seedBasics } from "../../core/src/test-helpers";
import { donateByCard } from "../src/donations";
import { NessieClient } from "../src/nessie";
import { reconcileGrant, redeemGrant, type PaymentsDeps } from "../src/redeem";
import { explorerTxUrl, solanaFromEnv } from "../src/solana";
import { loadEnv } from "./env-file";

const ADDRESS = { street_number: "1", street_name: "Main St", city: "Amherst", state: "MA", zip: "01002" };

async function main() {
  loadEnv();
  const fundAccountId = process.env.NESSIE_FUND_ACCOUNT_ID;
  const merchantId = process.env.NESSIE_PROVIDER_MERCHANT_ID;
  if (!fundAccountId || !merchantId) throw new Error("Run npm run nessie:seed first");

  const nessie = NessieClient.fromEnv();
  // The embedded database is throwaway, so it never needs the real pepper (often blank in .env).
  process.env.CARD_TOKEN_PEPPER ||= "smoke-test-pepper";
  const db = await createTestDb();
  await seedBasics(db);
  const solana = solanaFromEnv();
  const deps: PaymentsDeps = { db, nessie, fundAccountId, solana, log: (m) => console.log(`  (log) ${m}`) };
  let ok = true;
  const check = (label: string, pass: boolean) => {
    console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
    ok &&= pass;
  };

  // A throwaway patient with a $1 bill, so the demo data stays untouched.
  const customer = await nessie.createCustomer({ firstName: "Smoke", lastName: "Test (fictional)", address: ADDRESS });
  const account = await nessie.createAccount(customer._id, { nickname: "Smoke test checking", balanceCents: 0 });
  const bill = await nessie.createBill(account._id, { payee: "Pioneer Valley Community Pharmacy", nickname: "Smoke test", amountCents: 100 });

  await db.query("update providers set nessie_merchant_id = $1, solana_wallet = $2 where id = 'prv_1'", [
    merchantId,
    process.env.PROVIDER_SOLANA_WALLET ?? null,
  ]);
  await db.query(
    `insert into documents (id, patient_id, source, nessie_id, merchant, amount_cents, category)
     values ('doc_smoke', 'pat_1', 'nessie_bill', $1, 'Pioneer Valley Community Pharmacy', 100, 'pharmacy')`,
    [bill._id],
  );
  await db.query(
    `insert into grants (id, patient_id, document_id, provider_id, requested_cents, approved_cents, status)
     values ('grt_smoke', 'pat_1', 'doc_smoke', 'prv_1', 100, 100, 'approved')`,
  );
  await db.query("update fund set reserved_cents = reserved_cents + 100 where id = 'community'");

  console.log("\nRedeeming a $1 grant against live Nessie...");
  const input = { grantId: "grt_smoke", providerId: "prv_1", patientId: "pat_1" };
  const first = await redeemGrant(deps, input);
  console.log(`  payout: ${first.payout}, grant: ${first.grant.status}, Nessie purchase: ${first.grant.receipt?.nessiePaymentId}`);
  const second = await redeemGrant(deps, input);
  const polled = await reconcileGrant(deps, "grt_smoke");
  check("grant is paid", polled.status === "paid");
  check("repeat tap didn't pay again", second.grant.receipt?.nessiePaymentId === first.grant.receipt?.nessiePaymentId);

  const key0 = (await getLiveAttempt(db, "grt_smoke", "nessie"))?.idempotencyKey ?? "missing";
  const payouts = (await nessie.listPurchases(fundAccountId)).filter((p) => p.description?.includes(key0));
  check("exactly one Nessie purchase for this grant", payouts.length === 1);
  check("patient's bill is marked completed", (await nessie.getBill(bill._id)).status === "completed");

  const receipt = await getLiveAttempt(db, "grt_smoke", "solana");
  if (!solana) console.log("SKIP  Solana receipt (TREASURY_SECRET_KEY not set)");
  else if (receipt?.status === "confirmed") check(`Solana receipt confirmed: ${explorerTxUrl(receipt.externalId ?? "")}`, true);
  else console.log(`WARN  Solana receipt is ${receipt?.status ?? "missing"} (fund the treasury at faucet.solana.com)`);

  console.log("\nDonating $1 by card, twice with the same key...");
  const key = `smoke-${Date.now()}`;
  const d1 = await donateByCard(deps, { amountCents: 100, idempotencyKey: key });
  const d2 = await donateByCard(deps, { amountCents: 100, idempotencyKey: key });
  check("donation recorded once", d1.donation.id === d2.donation.id && d2.duplicate);
  check("donation amount is $1.00", d1.donation.amountCents === 100);

  console.log(ok ? "\nLive smoke test passed." : "\nLive smoke test FAILED.");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
