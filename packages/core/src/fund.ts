// Community fund budget and public summary (SPEC §4 dashboard, §9). Aggregate only: no patient data.

import { SECOND_APPROVAL_ABOVE_CENTS, type Donation, type FundEventType, type FundSummary } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, isPositiveCents, iso, newId } from "./util";

/** Largest single donation the public form accepts: $10,000. */
export const MAX_DONATION_CENTS = 1_000_000;

interface DonationRow {
  id: string;
  rail: Donation["rail"];
  amount_cents: number;
  nessie_deposit_id: string | null;
  solana_signature: string | null;
  created_at: Date;
}

function toDonation(r: DonationRow): Donation {
  return {
    id: r.id,
    rail: r.rail,
    amountCents: Number(r.amount_cents),
    nessieDepositId: r.nessie_deposit_id,
    solanaSignature: r.solana_signature,
    at: iso(r.created_at),
  };
}

/**
 * Record money that reached the fund: a confirmed Nessie deposit (card donation) or a devnet SOL
 * transfer, or the seed's starting balance (rail "nessie", no external ID). Recording the same
 * deposit ID or signature twice returns the first record and adds nothing (SPEC §8).
 */
export async function recordDonation(
  db: Db,
  input: { rail: Donation["rail"]; amountCents: number; nessieDepositId?: string; solanaSignature?: string },
): Promise<Donation> {
  if (!isPositiveCents(input.amountCents)) {
    throw new CoreError("bad_request", "Donation must be a positive integer of cents");
  }
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<DonationRow>(
      `insert into donations (id, rail, amount_cents, nessie_deposit_id, solana_signature)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing
       returning *`,
      [newId("don"), input.rail, input.amountCents, input.nessieDepositId ?? null, input.solanaSignature ?? null],
    );
    if (!rows[0]) {
      const { rows: existing } = await tx.query<DonationRow>(
        "select * from donations where nessie_deposit_id = $1 or solana_signature = $2",
        [input.nessieDepositId ?? null, input.solanaSignature ?? null],
      );
      return toDonation(existing[0]);
    }
    await tx.query("update fund set total_cents = total_cents + $1 where id = 'community'", [input.amountCents]);
    await tx.query(
      "insert into fund_events (type, amount_cents, grant_ref, solana_signature) values ('donation', $1, $2, $3)",
      [input.amountCents, rows[0].id, input.solanaSignature ?? null],
    );
    return toDonation(rows[0]);
  });
}

/** Attach the Solana memo receipt to a card donation once it is broadcast. */
export async function setDonationReceipt(db: Db, donationId: string, signature: string): Promise<void> {
  await db.query("update donations set solana_signature = $2 where id = $1 and solana_signature is null", [
    donationId,
    signature,
  ]);
  await db.query(
    "update fund_events set solana_signature = $2 where type = 'donation' and grant_ref = $1 and solana_signature is null",
    [donationId, signature],
  );
}

export async function getFundSummary(db: Db): Promise<FundSummary> {
  const { rows: fund } = await db.query<{ total_cents: number; reserved_cents: number; paid_cents: number }>(
    "select total_cents, reserved_cents, paid_cents from fund where id = 'community'",
  );
  const f = fund[0] ?? { total_cents: 0, reserved_cents: 0, paid_cents: 0 };
  const total = Number(f.total_cents);
  const reserved = Number(f.reserved_cents);
  const paid = Number(f.paid_cents);

  const { rows: counts } = await db.query<{ approved: number; paid: number; donations: number }>(
    `select count(*) filter (where status in ('approved', 'payment_pending', 'paid'))::int as approved,
            count(*) filter (where status = 'paid')::int as paid,
            (select count(*)::int from donations) as donations
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
    donationCount: counts[0]?.donations ?? 0,
    rules: { secondApprovalAboveCents: SECOND_APPROVAL_ABOVE_CENTS },
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
