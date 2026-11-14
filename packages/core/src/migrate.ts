// Applies db/migrations/*.sql in order, once each, recording them in schema_migrations.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db";

export const MIGRATIONS_DIR = join(__dirname, "..", "db", "migrations");

export async function runMigrations(
  db: Db,
  options: { timescale: boolean; dir?: string; log?: (msg: string) => void } = { timescale: true },
): Promise<string[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const log = options.log ?? (() => {});
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const { rows } = await db.query<{ name: string }>("select name from schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    if (!options.timescale && file.includes("timescale")) {
      log(`skip ${file} (TimescaleDB disabled)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    // TimescaleDB continuous aggregates can't be created inside a transaction.
    if (file.includes("timescale")) {
      for (const statement of splitStatements(sql)) await db.query(statement);
      await db.query("insert into schema_migrations (name) values ($1)", [file]);
    } else {
      await db.transaction(async (tx) => {
        for (const statement of splitStatements(sql)) await tx.query(statement);
        await tx.query("insert into schema_migrations (name) values ($1)", [file]);
      });
    }
    log(`applied ${file}`);
    ran.push(file);
  }
  return ran;
}

/** Split a migration on top-level semicolons. Migrations must not contain functions or quoted ';'. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
