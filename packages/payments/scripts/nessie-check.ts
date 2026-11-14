// npm run nessie:check -w @abdulcare/payments
// Confirms NESSIE_API_KEY works and shows what the seeded accounts hold. Prints no secrets.

import { NessieClient } from "../src/nessie";
import { listIncomeDeposits, listPatientTransactions } from "../src/transactions";
import { loadEnv } from "./env-file";

async function main() {
  loadEnv();
  if (!process.env.NESSIE_API_KEY) throw new Error("NESSIE_API_KEY is not set in .env");
  const nessie = NessieClient.fromEnv();

  const customers = await nessie.listCustomers();
  console.log(`Nessie key works: ${customers.length} customer(s) visible.`);

  const fundId = process.env.NESSIE_FUND_ACCOUNT_ID;
  if (!fundId) {
    console.log("No fund account yet. Run: npm run nessie:seed -w @abdulcare/payments");
    return;
  }
  const fund = await nessie.getAccount(fundId);
  console.log(`Fund "${fund.nickname}": $${fund.balance}`);

  const patientId = process.env.NESSIE_PATIENT_ACCOUNT_ID;
  if (patientId) {
    const txns = await listPatientTransactions(nessie, patientId);
    const deposits = await listIncomeDeposits(nessie, patientId);
    console.log(`Demo patient: ${txns.length} open bill(s) and purchase(s), ${deposits.length} deposit(s) in 90 days`);
    for (const t of txns) console.log(`  ${t.kind.padEnd(8)} $${(t.amountCents / 100).toFixed(2).padStart(8)}  ${t.merchant}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
