// Community fund budget and public summary (SPEC §4 dashboard, §9). Aggregate only: no patient data.

import type { FundEventType, FundSummary } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, isPositiveCents, iso } from "./util";

/** Add money to the fund (seed or a donation). */
export async function addDonation(db: Db, cents: number, solanaSignature?: string): Promise<void> {
  if (!isPositiveCents(cents)) throw new CoreError("bad_request", "Donation must be a positive integer of cents");
  await db.transaction(async (tx) => {
    await tx.query("update fund set total_cents = total_cents + $1 where id = 'community'", [cents]);
    await tx.query(
      "insert into fund_events (type, amount_cents, solana_signature) values ('donation', $1, $2)",
      [cents, solanaSignature ?? null],
    );
  });
}

export async function getFundSummary(db: Db): Promise<FundSummary> {
  const { rows: fund } = await db.query<{ total_cents: number; reserved_cents: number; paid_cents: number }>(
    "select total_cents, reserved_cents, paid_cents from fund where id = 'community'",
  );
  const f = fund[0] ?? { total_cents: 0, reserved_cents: 0, paid_cents: 0 };
  const total = Number(f.total_cents);
  const reserved = Number(f.reserved_cents);
  const paid = Number(f.paid_cents);

  const { rows: counts } = await db.query<{ approved: number; paid: number }>(
    `select count(*) filter (where status in ('approved', 'payment_pending', 'paid'))::int as approved,
            count(*) filter (where status = 'paid')::int as paid
       from grants`,
  );

  const { rows: recent } = await db.query<{
    type: FundEventType;
    grant_ref: string | null;
    amount_cents: number;
    solana_signature: string | null;
    time: Date;
  }>(
    `select type, grant_ref, amount_cents, solana_signature, time
       from fund_events
      where type in ('donation', 'payout', 'receipt')
      order by time desc limit 20`,
  );

  // The continuous aggregate only exists on Tiger Cloud (002_timescale.sql).
  let daily: FundSummary["daily"] = [];
  try {
    const { rows } = await db.query<{ day: Date; approved_cents: number | null; paid_cents: number | null }>(
      `select day, approved_cents, paid_cents from fund_daily
        where day > now() - interval '14 days' order by day`,
    );
    daily = rows.map((r) => ({
      day: iso(r.day).slice(0, 10),
      approvedCents: Number(r.approved_cents ?? 0),
      paidCents: Number(r.paid_cents ?? 0),
    }));
  } catch {
    daily = [];
  }

  return {
    totalCents: total,
    availableCents: total - reserved - paid,
    reservedCents: reserved,
    paidCents: paid,
    approvedCount: counts[0]?.approved ?? 0,
    paidCount: counts[0]?.paid ?? 0,
    daily,
    recent: recent.map((r) => ({
      type: r.type,
      reference: r.grant_ref ?? "donation",
      amountCents: Number(r.amount_cents),
      solanaSignature: r.solana_signature,
      at: iso(r.time),
    })),
  };
}
