// npm run db:migrate -w @abdulcare/core [-- --no-timescale]
// Reads DATABASE_URL from the repo-root .env.

import { join } from "node:path";
import { createPgDb } from "../src/db";
import { runMigrations } from "../src/migrate";

try {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));
} catch {
  // No .env file: rely on the environment.
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
  const db = createPgDb(url);
  const ran = await runMigrations(db, {
    timescale: !process.argv.includes("--no-timescale"),
    log: (msg) => console.log(msg),
  });
  console.log(ran.length ? `Done: ${ran.length} migration(s) applied.` : "Already up to date.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
