// npm run rails:smoke -w @abdulcare/payments
// Live check of the linked rails against the real Nessie sandbox, Solana devnet and the database:
// syncs the latest decided grants into the on-chain program, publishes today's anchor, runs the
// reconciliation, prepares (but doesn't pay) a Solana Pay request, and runs one bank check.
// Prints opaque references and totals only.

import { FORMULA } from "@abdulcare/ai";
import { createPgDb } from "@abdulcare/core";
import { anchorDay, caseProof } from "../src/proofs";
import { linkGrantRails, reconcileRails } from "../src/linked";
import { bankCheck } from "../src/rails";
import { createDonationRequest } from "../src/solana-pay";
import { paymentsFromEnv } from "../src/redeem";
import { programIdFromEnv } from "../src/program";
import { loadEnv } from "./env-file";

async function main() {
  loadEnv();
  const db = createPgDb(process.env.DATABASE_URL as string);
  const deps = paymentsFromEnv(db);

  const { rows: decided } = await db.query<{ id: string; status: string }>(
    "select id, status from grants where visit_id is not null and status in ('paid', 'rejected') order by decided_at desc nulls last limit 3",
  );
  for (const g of decided) {
    const r = await linkGrantRails(deps, g.id);
    console.log(`grant …${g.id.slice(-6)} (${g.status}): on chain ${r.chain?.account?.status ?? "none"}, nessie bill ${r.nessieBillId ? "synced" : "none"}${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`);
  }

  const anchor = await anchorDay(deps, { formula: FORMULA as unknown as { version: string }, programId: programIdFromEnv()?.toBase58() ?? null });
  console.log(`anchor ${anchor.day}: ${anchor.status}, queue ${anchor.payload.queue.count}, ledger ${anchor.payload.ledger.count}, ${anchor.explorerUrl ?? "no signature"}`);

  const { rows: pending } = await db.query<{ id: string }>("select id from grants where status = 'pending_review' limit 1");
  if (pending[0]) {
    const proof = await caseProof(db, pending[0].id);
    console.log(`queue proof for …${pending[0].id.slice(-6)}: rank ${proof?.rank}/${proof?.outOf}, verified ${proof?.verified}`);
  }

  const report = await reconcileRails(deps);
  for (const c of report.checks) console.log(`reconcile: ${c.ok ? "OK " : "BAD"} ${c.name} (${c.checked} checked, ${c.mismatches} off)`);

  const req = await createDonationRequest(deps, { rail: "sol", amount: 0.05, fallbackCentsPerSol: 10_000 });
  console.log(`solana pay: 0.05 SOL ≈ $${(req.usdCents / 100).toFixed(2)} (price from ${req.priceSource})`);

  const account = process.env.NESSIE_PATIENT_ACCOUNT_ID;
  if (account) {
    const check = await bankCheck(deps.nessie, account);
    console.log(`bank check: in $${(check.monthlyDepositsCents / 100).toFixed(0)}/mo, spending $${(check.monthlySpendingCents / 100).toFixed(0)}/mo, share ${check.spendingShare}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
