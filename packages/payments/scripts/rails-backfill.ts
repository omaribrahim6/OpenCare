// npm run rails:backfill -w @abdulcare/payments [-- --concurrency 4]
// Records every decided grant from before the opencare_fund program went live, so the program's
// counts match the public ledger: approve (or decline) once per case, then mark paid with the
// fingerprint of the Nessie payment. Safe to re-run: grants already on chain are skipped.
// Prints counts only.

import { createPgDb } from "@abdulcare/core";
import { fetchConfig, programIdFromEnv, syncGrantOnChain } from "../src/program";
import { paymentsFromEnv } from "../src/redeem";
import { loadEnv } from "./env-file";

async function main() {
  loadEnv();
  const db = createPgDb(process.env.DATABASE_URL as string);
  const deps = { ...paymentsFromEnv(db), log: undefined };
  const programId = programIdFromEnv();
  if (!programId || !deps.solana) throw new Error("OPENCARE_PROGRAM_ID and the treasury must be set");
  const i = process.argv.indexOf("--concurrency");
  const concurrency = Math.max(1, Number(i > 0 ? process.argv[i + 1] : 4) || 4);

  const { rows } = await db.query<{ id: string; status: string }>(
    `select id, status from grants
      where visit_id is not null and status in ('paid', 'rejected')
      order by decided_at asc nulls first`,
  );
  console.log(`${rows.length} decided grants to check (${concurrency} at a time)`);

  let done = 0;
  let failed = 0;
  const errors = new Map<string, number>();
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const g = rows[next++];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await syncGrantOnChain(deps, g.id);
          done++;
          break;
        } catch (err) {
          if (attempt === 3) {
            failed++;
            const key = (err as Error).message.split("\n")[0].slice(0, 80);
            errors.set(key, (errors.get(key) ?? 0) + 1);
          } else {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
      if ((done + failed) % 25 === 0) console.log(`  ${done + failed}/${rows.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const config = await fetchConfig(deps.solana.connection, programId);
  console.log(`Done: ${done} synced, ${failed} failed.`);
  for (const [message, n] of errors) console.log(`  ${n}x ${message}`);
  console.log(`On chain now: ${config?.grantsApproved} approved, ${config?.grantsDeclined} declined, $${((config?.centsPaid ?? 0) / 100).toFixed(2)} paid`);
  console.log(`Treasury: ${(await deps.solana.connection.getBalance(deps.solana.treasury.publicKey)) / 1e9} SOL`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
