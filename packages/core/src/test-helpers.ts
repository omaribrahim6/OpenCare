// Embedded Postgres (PGlite) for tests: the real schema, no server needed.

import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db } from "./db";
import { runMigrations } from "./migrate";

type Queryable = PGlite | Transaction;

function wrap(conn: Queryable, root: PGlite): Db {
  return {
    // PGlite errors carry the Postgres SQLSTATE in .code, like node-postgres.
    query: async <T>(text: string, params?: unknown[]) => ({
      rows: (await conn.query<T>(text, params as unknown[])).rows,
    }),
    transaction: (fn) =>
      conn === root ? root.transaction((tx) => fn(wrap(tx, root))) : fn(wrap(conn, root)),
  };
}

export async function createTestDb(): Promise<Db> {
  process.env.CARD_TOKEN_PEPPER ??= "test-pepper";
  process.env.PAIRING_PIN ??= "4242";
  process.env.PUBLIC_BASE_URL ??= "https://abdulcare.test";
  const pg = new PGlite();
  const db = wrap(pg, pg);
  await runMigrations(db, { timescale: false });
  return db;
}

/** Seed one patient, one provider, and a funded community fund. */
export async function seedBasics(db: Db, fundCents = 10_000): Promise<void> {
  await db.query("insert into patients (id, display_name) values ('pat_1', 'Test Patient'), ('pat_2', 'Other Patient')");
  await db.query(
    "insert into providers (id, name, kind) values ('prv_1', 'Test Pharmacy', 'pharmacy'), ('prv_2', 'Other Clinic', 'clinic')",
  );
  await db.query("update fund set total_cents = $1 where id = 'community'", [fundCents]);
}
