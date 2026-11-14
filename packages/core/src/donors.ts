// Top funders for the public landing page. Named institutions and people who chose to be named
// are listed by their total; everyone else is summed as anonymous. All seeded funders are fictional.

import type { TopDonor, TopDonorsResponse } from "@abdulcare/contracts";
import type { Db } from "./db";

export async function listTopDonors(db: Db, limit = 8): Promise<TopDonorsResponse> {
  const n = Math.min(Math.max(1, Math.floor(limit) || 8), 50);
  const { rows } = await db.query<{
    id: string;
    name: string;
    kind: TopDonor["kind"];
    website: string | null;
    fictional: boolean;
    gifts: number;
    total: number;
  }>(
    `select d.id, d.name, d.kind, d.website, d.fictional,
            count(x.id)::int as gifts, sum(x.amount_cents)::bigint as total
       from donors d
       join donations x on x.donor_id = d.id
      where d.public_name
      group by d.id
      order by total desc, d.name
      limit $1`,
    [n],
  );
  const { rows: anon } = await db.query<{ gifts: number; total: number }>(
    `select count(*)::int as gifts, coalesce(sum(x.amount_cents), 0)::bigint as total
       from donations x
       left join donors d on d.id = x.donor_id
      where d.id is null or not d.public_name`,
  );
  return {
    donors: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      website: r.website,
      totalGivenCents: Number(r.total),
      giftCount: Number(r.gifts),
      fictional: r.fictional,
    })),
    anonymous: { totalCents: Number(anon[0]?.total ?? 0), giftCount: Number(anon[0]?.gifts ?? 0) },
  };
}
