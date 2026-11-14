// Participating providers (SPEC §9 Provider). Public fields only; payout IDs stay server-side.

import type { Provider } from "@abdulcare/contracts";
import type { Db } from "./db";

export async function listProviders(db: Db): Promise<Provider[]> {
  const { rows } = await db.query<Provider>("select id, name, kind from providers order by name");
  return rows;
}
