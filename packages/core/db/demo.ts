// npm run db:demo -w @abdulcare/core       adds the demo's pending requests and donations
// npm run db:reset -w @abdulcare/core      wipes all activity first, then does the same
//
// Demo data for SPEC §14, on top of db:seed (patients, profiles, the pharmacy, cards):
// - Pending requests for Sam, Jordan and Casey, built from their real Nessie bills, so the
//   caseworker queue has something to rank. Casey's is the tampered request.
// - Alex's $45 pharmacy bill stays unrequested: the presenter requests it live at the kiosk.
// - The fund's starting donations, matching the Nessie seed's deposits into the fund account.
//
// --reset deletes every request, document, approval, payout attempt, donation, fund event and
// cached ranking, ends open kiosk sessions, zeroes the fund and reopens any Nessie bill a
// rehearsal paid. Patients, profiles, cards, providers and paired devices are kept.
//
// This script never calls Gemini: it classifies with the rules and assesses with the formula
// (an offline model client), whatever the environment says.

import { join } from "node:path";
import { classifyTransactions, createNeedEngine, estimateMonthlyIncomeCents, ModelUnavailableError, type ModelClient } from "@abdulcare/ai";
import type { TransactionInput } from "@abdulcare/contracts";
import { assessGrant, createGrant, createNessieDocument, createPgDb, recordDonation, type Db } from "../src";

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

const PROVIDER_ID = "prv_demo_pharmacy";
const DAY = 86_400_000;

/** Requests already waiting when the demo starts. Bills are matched by payee in each Nessie account. */
const REQUESTS = [
  { patientId: "pat_demo_sam", accountEnv: "NESSIE_PATIENT2_ACCOUNT_ID", payee: "Amherst Family Medicine", daysAgo: 1, note: null },
  {
    patientId: "pat_demo_jordan",
    accountEnv: "NESSIE_PATIENT3_ACCOUNT_ID",
    payee: "Valley Regional Hospital ER",
    daysAgo: 4,
    note: "My hours were cut after the ER visit and we are a family of four. Anything helps.",
  },
  { patientId: "pat_demo_casey", accountEnv: "NESSIE_PATIENT4_ACCOUNT_ID", payee: "Valley Urgent Care", daysAgo: 2, note: null },
] as const;

/** Fallback starting donations when the Nessie fund deposits can't be read ($500 total). */
const FALLBACK_DONATIONS_CENTS = [20_000, 15_000, 15_000];

// --- Nessie (read-only here, plus reopening bills on reset) ---

interface NessieBill {
  _id: string;
  status: string;
  payee: string;
  nickname?: string;
  payment_amount: number;
  payment_date?: string;
  creation_date?: string;
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
const ymd = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

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
      where g.status in ('payment_pending', 'paid') and d.source = 'nessie_bill'`,
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

  const counts = await db.transaction(async (tx) => {
    const del = async (table: string) => (await tx.query(`delete from ${table} returning 1`)).rows.length;
    const out = {
      approvals: await del("grant_approvals"),
      assessments: await del("need_assessments"),
      rankings: await del("queue_rankings"),
      attempts: await del("payment_attempts"),
      grants: await del("grants"),
      documents: await del("documents"),
      donations: await del("donations"),
      fundEvents: await del("fund_events"),
    };
    await tx.query("update fund set total_cents = 0, reserved_cents = 0, paid_cents = 0 where id = 'community'");
    await tx.query("update sessions set ended_at = now() where ended_at is null");
    return out;
  });
  console.log(
    `  Deleted ${counts.grants} requests, ${counts.documents} documents, ${counts.approvals} approvals, ` +
      `${counts.attempts} payout attempts, ${counts.donations} donations, ${counts.fundEvents} fund events, ` +
      `${counts.rankings} cached rankings. Fund set to $0 and kiosk sessions ended.`,
  );
}

// --- Demo data ---

async function seedDonations(db: Db) {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from donations");
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

async function seedRequests(db: Db) {
  const { rows: provider } = await db.query("select 1 from providers where id = $1", [PROVIDER_ID]);
  if (!provider[0]) throw new Error(`Provider ${PROVIDER_ID} is missing: run npm run db:seed -w @abdulcare/core first`);

  for (const r of REQUESTS) {
    const accountId = requireEnv(r.accountEnv);
    const bills = await nessie<NessieBill[]>("GET", `/accounts/${encodeURIComponent(accountId)}/bills`);
    const bill = bills.find((b) => b.payee === r.payee && (b.status === "pending" || b.status === "recurring"));
    if (!bill) {
      console.log(`  ${r.patientId}: no open "${r.payee}" bill in Nessie, skipped`);
      continue;
    }
    const txn: TransactionInput = {
      id: bill._id,
      kind: "bill",
      merchant: bill.payee,
      description: bill.nickname,
      amountCents: toCents(bill.payment_amount),
      date: bill.payment_date ?? bill.creation_date,
    };
    const [classification] = await classifyTransactions([txn], { client: offline });
    const doc = await createNessieDocument(db, r.patientId, {
      source: "nessie_bill",
      nessieId: txn.id,
      merchant: txn.merchant,
      description: txn.description ?? null,
      date: ymd(txn.date),
      amountCents: txn.amountCents,
      likelyMedical: classification?.likelyMedical ?? null,
      category: classification?.category ?? null,
    });

    const { rows: existing } = await db.query<{ id: string }>("select id from grants where document_id = $1", [doc.id]);
    if (existing[0]) {
      console.log(`  ${r.patientId}: request already exists, leaving it`);
      continue;
    }
    const grant = await createGrant(db, {
      patientId: r.patientId,
      documentId: doc.id,
      providerId: PROVIDER_ID,
      requestedCents: doc.amountCents,
      hardshipNote: r.note,
    });
    // Backdate so "days waiting" differs between requests, as it would in a real queue.
    await db.query("update grants set created_at = $2 where id = $1", [grant.id, new Date(Date.now() - r.daysAgo * DAY)]);
    const { assessment, suspicious } = await assessGrant(db, engine, grant.id, {
      depositIncomeCents: await depositIncome(accountId),
    });
    console.log(
      `  ${r.patientId}: $${(doc.amountCents / 100).toFixed(2)} ${doc.merchant}, need score ${assessment.score}` +
        (suspicious ? `, flagged as suspicious (${suspicious.field})` : ""),
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
  console.log("\nDemo ready. Alex's $45 pharmacy bill is left for the live kiosk request.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
