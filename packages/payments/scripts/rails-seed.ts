// npm run rails:seed -w @abdulcare/payments [-- --contribute]
// Sets up the linked rails (Nessie holds the dollars, Solana holds the rules and the proof):
// - Nessie: the fund's reserved account (writes NESSIE_RESERVED_ACCOUNT_ID to .env), a checking
//   account for every hospital (saved in rail_links), and a few fictional donor accounts.
// - Solana: the opencare_fund program's config (the published fund rules) and an attestation for
//   every hospital wallet, linked to the hash of its Nessie merchant ID.
// - With --contribute: one community-benefit contribution from each hospital into the fund.
// Safe to re-run: it reuses everything that already exists.

import { createPgDb } from "@abdulcare/core";
import { NessieClient, type NessieAddress } from "../src/nessie";
import { ensureFundConfig, ensureHospitalAttested, FUND_RULES, programIdFromEnv } from "../src/program";
import { contributeFromHospital, getLink, saveLink } from "../src/rails";
import { paymentsFromEnv } from "../src/redeem";
import { loadEnv, setEnv } from "./env-file";

const ADDRESS: NessieAddress = { street_number: "1", street_name: "Main St", city: "Amherst", state: "MA", zip: "01002" };

const DONORS = ["Pioneer Valley Credit Union", "Hampshire Mutual Aid", "Connecticut River Foundation"];

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createPgDb(url);
  const nessie = NessieClient.fromEnv();
  const fundId = process.env.NESSIE_FUND_ACCOUNT_ID;
  if (!fundId) throw new Error("NESSIE_FUND_ACCOUNT_ID is not set (run npm run nessie:seed first)");

  // 1. The fund's reserved account, under the fund's own Nessie customer.
  if (!process.env.NESSIE_RESERVED_ACCOUNT_ID) {
    const fund = await nessie.getAccount(fundId);
    const reserved = await nessie.createAccount(fund.customer_id, { nickname: "OpenCare Community Fund (reserved)", balanceCents: 0, type: "Savings" });
    setEnv("NESSIE_RESERVED_ACCOUNT_ID", reserved._id);
    console.log("Created the fund's reserved account.");
  } else {
    console.log("Reserved account already set.");
  }

  // 2. A checking account for every hospital.
  const { rows: hospitals } = await db.query<{ id: string; name: string; nessie_merchant_id: string | null; solana_wallet: string | null }>(
    "select id, name, nessie_merchant_id, solana_wallet from providers order by name",
  );
  for (const h of hospitals) {
    if (await getLink(db, "hospital_account", h.id)) continue;
    const customer = await nessie.createCustomer({ firstName: h.name.slice(0, 40), lastName: "(hospital, fictional)", address: ADDRESS });
    const account = await nessie.createAccount(customer._id, { nickname: `${h.name} operating`, balanceCents: 25_000_000 });
    await saveLink(db, { kind: "hospital_account", ref: h.id, nessieId: account._id, detail: { name: h.name } });
    console.log(`  ${h.name}: Nessie checking created`);
  }

  // 3. Fictional donor accounts (their gifts arrive by transfer, so both sides show them).
  for (const name of DONORS) {
    const key = `donor:${name}`;
    if (await getLink(db, "hospital_account", key)) continue;
    const customer = await nessie.createCustomer({ firstName: name.slice(0, 40), lastName: "(donor, fictional)", address: ADDRESS });
    const account = await nessie.createAccount(customer._id, { nickname: `${name} giving`, balanceCents: 5_000_000 });
    await saveLink(db, { kind: "hospital_account", ref: key, nessieId: account._id, detail: { name, donor: true } });
    console.log(`  ${name}: donor account created`);
  }

  // 4. The on-chain fund program: rules and hospital attestations.
  const deps = paymentsFromEnv(db);
  const programId = programIdFromEnv();
  if (programId && deps.solana) {
    const { config, signature } = await ensureFundConfig(deps.solana, programId);
    console.log(`Program config ${signature ? "published" : "already current"}: largest grant $${(config.maxGrantCents / 100).toFixed(0)}, rules v${config.rulesVersion}`);
    for (const h of hospitals) {
      const wallet = h.solana_wallet ?? process.env.PROVIDER_SOLANA_WALLET;
      if (!wallet) continue;
      try {
        await ensureHospitalAttested(deps, programId, { providerId: h.id, wallet, merchantId: h.nessie_merchant_id ?? h.id });
        console.log(`  ${h.name}: attested on chain`);
      } catch (err) {
        console.log(`  ${h.name}: attestation skipped (${(err as Error).message})`);
      }
    }
    console.log(`Rules published: ${FUND_RULES.text.length} rules.`);
  } else {
    console.log("OPENCARE_PROGRAM_ID or the treasury isn't set; skipping the on-chain setup.");
  }

  // 5. Optional: one community-benefit contribution per hospital.
  if (process.argv.includes("--contribute")) {
    for (const h of hospitals) {
      try {
        const r = await contributeFromHospital(deps, { providerId: h.id, amountCents: 50_000, key: `hc-seed-${h.id}`.slice(0, 64) });
        console.log(`  ${h.name}: contributed $500 (${r.duplicate ? "already done" : "new"})`);
      } catch (err) {
        console.log(`  ${h.name}: contribution skipped (${(err as Error).message})`);
      }
    }
  }

  console.log("Done. Copy NESSIE_RESERVED_ACCOUNT_ID and OPENCARE_PROGRAM_ID to Vercel.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
