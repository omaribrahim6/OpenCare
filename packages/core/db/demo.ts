// npm run db:demo -w @abdulcare/core       adds the demo's pending requests and donations
// npm run db:reset -w @abdulcare/core      wipes all activity first, then does the same
//
// Demo data for SPEC §14 (rev 6), on top of db:seed (patients, plans, the hospital, its policies
// and visit templates, cards):
// - Visits already logged at Valley General for Alex, Sam and Casey, each run through insurance
//   and the hospital's policies, with a fund request waiting in the reviewer queue. Casey's visit
//   is the tampered one.
// - Jordan has no visit yet: the presenter logs it live at the hospital terminal.
// - The fund's starting donations, matching the Nessie seed's deposits into the fund account.
//
// --reset deletes every visit, bill event, policy application, request, brief, approval, payout
// attempt, donation and fund event, ends open sessions and zeroes the fund. Patients, profiles,
// plans, cards, hospitals, policies, templates and paired devices are kept.
//
// This script never calls Gemini: policies, briefs and scores use the rules and templates
// (core's fallback engine and an offline model client), whatever the environment says.

import { join } from "node:path";
import { clearDemoData } from "./demo-reset";
import { createNeedEngine, estimateMonthlyIncomeCents, ModelUnavailableError, type ModelClient } from "@abdulcare/ai";
import {
  assessGrant,
  createPgDb,
  fallbackBillEngine,
  logVisit,
  recordDonation,
  requestHelp,
  sha256,
  newSecret,
  type Db,
} from "../src";

try {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));
} catch {
  // No .env file: rely on the environment.
}

const offline: ModelClient = {
  model: "offline",
  generateJson: async () => {
    throw new ModelUnavailableError("The demo seed never calls a model");
  },
};
const engine = createNeedEngine({ client: offline });

const HOSPITAL_ID = "prv_demo_hospital";
const SEED_DEVICE_ID = "dev_demo_seed_intake";
const DAY = 86_400_000;

/** Visits already logged and waiting in the reviewer queue when the demo starts. */
const REQUESTS = [
  { patientId: "pat_demo_alex", accountEnv: "NESSIE_PATIENT_ACCOUNT_ID", templateId: "tpl_demo_urgent", daysAgo: 1, note: null },
  {
    patientId: "pat_demo_sam",
    accountEnv: "NESSIE_PATIENT2_ACCOUNT_ID",
    templateId: "tpl_demo_imaging",
    daysAgo: 4,
    note: "My hours were cut after the injury. Anything helps.",
  },
  { patientId: "pat_demo_casey", accountEnv: "NESSIE_PATIENT4_ACCOUNT_ID", templateId: "tpl_demo_tampered", daysAgo: 2, note: null },
] as const;

/** Fallback starting donations when the Nessie fund deposits can't be read ($500 total). */
const FALLBACK_DONATIONS_CENTS = [20_000, 15_000, 15_000];

// --- Nessie (read-only here, plus reopening bills on reset) ---

interface NessieBill {
  _id: string;
  status: string;
}
interface NessieDeposit {
  _id: string;
  status?: string;
  amount: number;
  description?: string;
  transaction_date?: string;
}

async function nessie<T>(method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
  const key = process.env.NESSIE_API_KEY;
  if (!key) throw new Error("NESSIE_API_KEY is not set");
  const base = (process.env.NESSIE_BASE_URL || "https://api.nessieisreal.com").replace(/\/$/, "");
  const res = await fetch(`${base}${path}?key=${encodeURIComponent(key)}`, {
    method,
    headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Nessie ${method} ${path} returned ${res.status}`); // never prints the key
  return (await res.json()) as T;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run the payments lane's nessie:seed first)`);
  return v;
}

// --- Reset ---

async function reset(db: Db) {
  // Bills a rehearsal paid were marked completed in Nessie; reopen them so the kiosk finds them again.
  const { rows: paidBills } = await db.query<{ nessie_id: string }>(
    `select d.nessie_id from grants g join documents d on d.id = g.document_id
      where not starts_with(g.patient_id, 'pat_hist_')
       and g.status in ('payment_pending', 'paid') and d.source = 'nessie_bill'`,
  );
  const alexBill = process.env.NESSIE_DEMO_BILL_ID;
  const toReopen = new Set([...paidBills.map((r) => r.nessie_id), ...(alexBill ? [alexBill] : [])]);
  for (const id of toReopen) {
    try {
      const bill = await nessie<NessieBill>("GET", `/bills/${encodeURIComponent(id)}`);
      if (bill.status === "completed") {
        await nessie("PUT", `/bills/${encodeURIComponent(id)}`, { status: "pending" });
        console.log(`  Reopened Nessie bill ${id}`);
      }
    } catch (err) {
      console.log(`  Could not reopen Nessie bill ${id}: ${(err as Error).message}`);
    }
  }

  await clearDemoData(db);
  console.log("Reset rehearsal data and preserved the historical ledger.");
}

// --- Demo data ---

async function seedDonations(db: Db) {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from donations where not starts_with(id, 'don_hist_')");
  if (rows[0].n > 0) {
    console.log(`  Donations: ${rows[0].n} already recorded, leaving them`);
    return;
  }
  let deposits: NessieDeposit[] = [];
  try {
    const all = await nessie<NessieDeposit[]>("GET", `/accounts/${encodeURIComponent(requireEnv("NESSIE_FUND_ACCOUNT_ID"))}/deposits`);
    deposits = all.filter((d) => d.description?.startsWith("AbdulCare donation seed"));
  } catch (err) {
    console.log(`  Could not read the Nessie fund deposits (${(err as Error).message}); using anonymous starting donations`);
  }
  if (deposits.length > 0) {
    for (const d of deposits) await recordDonation(db, { rail: "nessie", amountCents: toCents(d.amount), nessieDepositId: d._id });
  } else {
    for (const cents of FALLBACK_DONATIONS_CENTS) await recordDonation(db, { rail: "nessie", amountCents: cents });
  }
  const { rows: fund } = await db.query<{ total_cents: number }>("select total_cents from fund where id = 'community'");
  console.log(`  Donations: ${deposits.length || FALLBACK_DONATIONS_CENTS.length} recorded, fund total $${(Number(fund[0].total_cents) / 100).toFixed(2)}`);
}

async function depositIncome(accountId: string): Promise<number | null> {
  try {
    const deposits = await nessie<NessieDeposit[]>("GET", `/accounts/${encodeURIComponent(accountId)}/deposits`);
    // Same window and filter as the payments lane's listIncomeDeposits: the last 90 days.
    const since = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
    return estimateMonthlyIncomeCents(
      deposits
        .filter((d) => d.status !== "cancelled" && d.transaction_date && d.transaction_date >= since)
        .map((d) => ({ date: d.transaction_date!.slice(0, 10), amountCents: toCents(d.amount) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  } catch {
    return null;
  }
}

/** A hospital "device" for the seed's own intake records (never paired to a browser). */
async function seedIntakeDevice(db: Db) {
  await db.query(
    `insert into devices (id, role, label, secret_hash, provider_id)
     values ($1, 'hospital', 'Valley General intake (seeded)', $2, $3)
     on conflict (id) do nothing`,
    [SEED_DEVICE_ID, sha256(newSecret()), HOSPITAL_ID],
  );
  return { id: SEED_DEVICE_ID, label: "Valley General intake (seeded)", providerId: HOSPITAL_ID };
}

async function seedRequests(db: Db) {
  const { rows: hospital } = await db.query("select 1 from providers where id = $1", [HOSPITAL_ID]);
  if (!hospital[0]) throw new Error(`Hospital ${HOSPITAL_ID} is missing: run npm run db:seed -w @abdulcare/core first`);
  const device = await seedIntakeDevice(db);

  for (const r of REQUESTS) {
    const accountId = process.env[r.accountEnv];
    const deposits = accountId ? await depositIncome(accountId) : null;
    const bill = await logVisit(
      db,
      { bills: fallbackBillEngine, need: engine },
      { templateId: r.templateId, patientId: r.patientId, device, idempotencyKey: `demo-seed-${r.patientId}`, depositIncomeCents: deposits },
    );
    if (bill.remainingCents <= 0) {
      console.log(`  ${r.patientId}: nothing left after insurance and hospital assistance, no request`);
      continue;
    }
    const grant = await requestHelp(db, { patientId: r.patientId, visitId: bill.visit.id, hardshipNote: r.note });
    // Backdate so "days waiting" differs between requests, as it would in a real queue.
    const created = new Date(Date.now() - r.daysAgo * DAY);
    await db.query("update grants set created_at = $2 where id = $1 and status = 'pending_review'", [grant.id, created]);
    await db.query("update visits set created_at = $2, visit_date = $3 where id = $1", [
      bill.visit.id,
      created,
      created.toISOString().slice(0, 10),
    ]);
    const { assessment, suspicious } = await assessGrant(db, engine, grant.id, { depositIncomeCents: deposits });
    const path = bill.steps.map((s) => `$${(s.balanceCents / 100).toFixed(2)}`).join(" -> ");
    console.log(
      `  ${r.patientId}: ${path}, request $${(grant.requestedCents / 100).toFixed(2)}, need score ${assessment.score}` +
        (suspicious || bill.suspiciousContent ? ", flagged as suspicious" : ""),
    );
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  const db = createPgDb(url);
  if (process.argv.includes("--reset")) {
    console.log("Resetting demo activity...");
    await reset(db);
  }
  console.log("Adding demo data...");
  await seedDonations(db);
  await seedRequests(db);
  console.log("\nDemo ready. Jordan has no visit yet: log the ER visit live at the hospital terminal.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
