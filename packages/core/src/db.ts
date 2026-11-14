// Minimal database interface so core logic runs on Tiger Cloud (node-postgres) in production
// and on embedded Postgres (PGlite) in tests.

import pg from "pg";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs fn in one transaction; commits if it resolves, rolls back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

// bigint (int8) and numeric come back as strings by default; cents always fit in a JS number.
pg.types.setTypeParser(20, (v: string) => Number(v));

function wrapClient(client: pg.PoolClient): Db {
  return {
    query: async <T>(text: string, params?: unknown[]) => {
      const res = await client.query(text, params as unknown[]);
      return { rows: res.rows as T[] };
    },
    transaction: (fn) => fn(wrapClient(client)), // already inside a transaction
  };
}

export function createPgDb(connectionString: string): Db {
  // Small pool: every Vercel function instance opens its own, so use Tiger Cloud's pooler URL.
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 });
  return {
    query: async <T>(text: string, params?: unknown[]) => {
      const res = await pool.query(text, params as unknown[]);
      return { rows: res.rows as T[] };
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrapClient(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

const globalForDb = globalThis as unknown as { __abdulcareDb?: Db };

/** Shared production connection, reused across hot reloads and warm function invocations. */
export function getDb(): Db {
  if (!globalForDb.__abdulcareDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__abdulcareDb = createPgDb(url);
  }
  return globalForDb.__abdulcareDb;
}
