// npm run db:seed -w @abdulcare/core [-- --new-cards]
// Seeds fictional demo data (SPEC §10) and prints the CareCard URLs to write to the NFC tags.
// Safe to re-run: it only issues cards for patients who have none, unless --new-cards is passed.
// Nessie IDs come from the payments lane's Nessie seed (via env).

import { join } from "node:path";
import { addDonation, createPgDb, issueCard, type Db } from "../src";

try {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));
} catch {
  // No .env file: rely on the environment.
}

const PATIENTS = [
  { id: "pat_demo_alex", name: "Alex Rivera (fictional)", nessieAccount: process.env.NESSIE_PATIENT_ACCOUNT_ID },
  { id: "pat_demo_sam", name: "Sam Patel (fictional)", nessieAccount: undefined },
];

const PROVIDERS = [
  {
    id: "prv_demo_pharmacy",
    name: "Pioneer Valley Community Pharmacy (fictional)",
    kind: "pharmacy",
    merchant: process.env.NESSIE_PROVIDER_MERCHANT_ID,
    wallet: process.env.PROVIDER_SOLANA_WALLET,
  },
];

/** The fund starts with $500.00 of fictional community donations. */
const FUND_START_CENTS = 50_000;

async function seed(db: Db) {
  for (const p of PATIENTS) {
    await db.query(
      `insert into patients (id, display_name, nessie_account_id) values ($1, $2, $3)
       on conflict (id) do update set display_name = excluded.display_name,
         nessie_account_id = coalesce(excluded.nessie_account_id, patients.nessie_account_id)`,
      [p.id, p.name, p.nessieAccount ?? null],
    );
  }
  for (const pr of PROVIDERS) {
    await db.query(
      `insert into providers (id, name, kind, nessie_merchant_id, solana_wallet) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, kind = excluded.kind,
         nessie_merchant_id = coalesce(excluded.nessie_merchant_id, providers.nessie_merchant_id),
         solana_wallet = coalesce(excluded.solana_wallet, providers.solana_wallet)`,
      [pr.id, pr.name, pr.kind, pr.merchant ?? null, pr.wallet ?? null],
    );
  }

  const { rows: fund } = await db.query<{ total_cents: number }>("select total_cents from fund where id = 'community'");
  if (Number(fund[0]?.total_cents ?? 0) === 0) await addDonation(db, FUND_START_CENTS);

  const newCards = process.argv.includes("--new-cards");
  console.log("\nCareCards (write each URL to an NFC tag with NFC Tools, then lock the tag):");
  for (const p of PATIENTS) {
    const { rows } = await db.query("select 1 from card_tokens where patient_id = $1 and status = 'active'", [p.id]);
    if (rows.length > 0 && !newCards) {
      console.log(`  ${p.name}: already has a card (pass --new-cards to issue another)`);
      continue;
    }
    const { url } = await issueCard(db, p.id);
    console.log(`  ${p.name}: ${url}`);
  }
  if (!process.env.PUBLIC_BASE_URL) {
    console.log("\n  Warning: PUBLIC_BASE_URL is not set, so these URLs are relative. Set it to the Vercel URL first.");
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  await seed(createPgDb(url));
  console.log("\nSeed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
