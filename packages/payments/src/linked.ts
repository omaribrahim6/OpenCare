// Linked rails, tying it together: the one hook routes call after a grant changes, and the daily
// reconciliation that checks every Nessie money movement against its database row and its Solana
// record (SPEC §8 "reconcile on read", extended to both rails).

import type { Db } from "@abdulcare/core";
import { dollarsToCents } from "./money";
import { programIdFromEnv, syncGrantOnChain, type GrantOnChain } from "./program";
import { listLinks, payoutAccountId, syncNessieBill } from "./rails";
import type { PaymentsDeps } from "./redeem";

export interface LinkResult {
  chain: GrantOnChain | null;
  nessieBillId: string | null;
  errors: string[];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);
}

/**
 * After a grant is decided or paid: record it in the on-chain program and bring the patient's
 * Nessie bill to the new balance. Never throws; anything that didn't finish is retried next call.
 */
export async function linkGrantRails(deps: PaymentsDeps, grantId: string, timeoutMs = 25_000): Promise<LinkResult> {
  const errors: string[] = [];
  let chain: GrantOnChain | null = null;
  let nessieBillId: string | null = null;
  try {
    chain = await withTimeout(syncGrantOnChain(deps, grantId), timeoutMs, "on-chain sync");
  } catch (err) {
    errors.push(`chain: ${(err as Error).message}`);
  }
  try {
    const { rows } = await deps.db.query<{ visit_id: string | null }>("select visit_id from grants where id = $1", [grantId]);
    if (rows[0]?.visit_id) nessieBillId = await withTimeout(syncNessieBill(deps, rows[0].visit_id), timeoutMs, "Nessie bill sync");
  } catch (err) {
    errors.push(`nessie bill: ${(err as Error).message}`);
  }
  for (const e of errors) deps.log?.(`link ${grantId}: ${e}`);
  return { chain, nessieBillId, errors };
}

/** After a visit is billed (kiosk charge): mirror the bill on the patient's Nessie account. */
export async function linkVisitRails(deps: PaymentsDeps, visitId: string): Promise<string | null> {
  try {
    return await withTimeout(syncNessieBill(deps, visitId), 15_000, "Nessie bill sync");
  } catch (err) {
    deps.log?.(`link visit ${visitId}: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation: every movement on both rails matches exactly one record
// ---------------------------------------------------------------------------

export interface ReconcileCheck {
  name: string;
  ok: boolean;
  checked: number;
  mismatches: number;
  /** Opaque references only. */
  examples: string[];
}

export interface ReconcileReport {
  checkedAt: string;
  ok: boolean;
  checks: ReconcileCheck[];
}

function check(name: string, items: { ref: string; ok: boolean }[]): ReconcileCheck {
  const bad = items.filter((i) => !i.ok);
  return { name, ok: bad.length === 0, checked: items.length, mismatches: bad.length, examples: bad.slice(0, 5).map((b) => b.ref) };
}

/**
 * Compare our records with Nessie and with Solana: every paid grant has a Nessie purchase and a
 * confirmed devnet receipt, every Nessie payout belongs to a paid grant, every card donation's
 * deposit or transfer exists in Nessie, and (when the program is deployed) every decided grant is on
 * chain. Totals and opaque references only.
 */
export async function reconcileRails(deps: PaymentsDeps, db: Db = deps.db): Promise<ReconcileReport> {
  const checks: ReconcileCheck[] = [];
  const accounts = [...new Set([payoutAccountId(deps), deps.fundAccountId])];
  const [purchases, deposits, transfers] = await Promise.all([
    Promise.all(accounts.map((a) => deps.nessie.listPurchases(a))).then((x) => x.flat()),
    deps.nessie.listDeposits(deps.fundAccountId),
    deps.nessie.listTransfers(deps.fundAccountId).catch(() => []),
  ]);
  const purchaseIds = new Set(purchases.map((p) => p._id));

  const { rows: paid } = await db.query<{ id: string; public_ref: string | null; approved_cents: string; nessie_id: string | null; receipt: string | null }>(
    `select g.id, g.public_ref, g.approved_cents,
            (select external_id from payment_attempts a where a.grant_id = g.id and a.rail = 'nessie' and a.status = 'confirmed' limit 1) as nessie_id,
            (select external_id from payment_attempts a where a.grant_id = g.id and a.rail = 'solana' and a.status = 'confirmed' limit 1) as receipt
       from grants g where g.status = 'paid' and g.visit_id is not null`,
  );
  checks.push(check("Every paid grant has a Nessie payout", paid.map((g) => ({ ref: g.public_ref ?? g.id.slice(-6), ok: Boolean(g.nessie_id && purchaseIds.has(g.nessie_id)) }))));
  checks.push(check("Every paid grant has a confirmed Solana receipt", paid.map((g) => ({ ref: g.public_ref ?? g.id.slice(-6), ok: Boolean(g.receipt) }))));

  // Every payout ever made, including revision 5 grants that were paid against a Nessie bill.
  const { rows: allPayouts } = await db.query<{ external_id: string }>(
    `select a.external_id from payment_attempts a join grants g on g.id = a.grant_id
      where a.rail = 'nessie' and a.status = 'confirmed' and a.external_id is not null and g.status = 'paid'`,
  );
  const knownPayouts = new Set(allPayouts.map((r) => r.external_id));
  // Re-running the demo history seed deletes its old grants, but Nessie keeps their purchases. Those
  // carry a `hist_<grant>` key for a grant that no longer exists: count them as voided, not missing.
  // The same goes for demo resets: a payout whose payment attempt no longer exists at all belonged to
  // a grant the reset removed.
  const { rows: keys } = await db.query<{ idempotency_key: string }>("select idempotency_key from payment_attempts where rail = 'nessie'");
  const knownKeys = new Set(keys.map((k) => k.idempotency_key));
  const payoutPurchases = purchases.filter((p) => p.description?.includes("grant payout"));
  const voided = payoutPurchases.filter((p) => {
    if (knownPayouts.has(p._id)) return false;
    const key = p.description?.split("grant payout ")[1]?.trim();
    return Boolean(key) && !knownKeys.has(key as string);
  });
  const voidedIds = new Set(voided.map((p) => p._id));
  checks.push(
    check(
      "Every Nessie payout belongs to a paid grant",
      payoutPurchases.filter((p) => !voidedIds.has(p._id)).map((p) => ({ ref: p._id.slice(-6), ok: knownPayouts.has(p._id) })),
    ),
  );
  checks.push({ name: "Voided demo history (re-seeded or reset, kept by Nessie)", ok: true, checked: voided.length, mismatches: 0, examples: [] });

  const nessieIn = new Map<string, number>();
  for (const d of deposits) nessieIn.set(d._id, dollarsToCents(d.amount));
  for (const t of transfers) if (t.payee_id === deps.fundAccountId) nessieIn.set(t._id, dollarsToCents(t.amount));
  const { rows: donations } = await db.query<{ id: string; nessie_deposit_id: string | null; amount_cents: string }>(
    "select id, nessie_deposit_id, amount_cents from donations where rail = 'nessie' and nessie_deposit_id is not null",
  );
  checks.push(
    check(
      "Every card donation is in the fund's Nessie account",
      donations.map((d) => {
        // Nessie keeps whole dollars, so a gift recorded with cents moved its whole-dollar part.
        const moved = nessieIn.get(d.nessie_deposit_id as string);
        const cents = Number(d.amount_cents);
        return { ref: d.id.slice(-6), ok: moved === cents || moved === cents - (cents % 100) };
      }),
    ),
  );

  const links = await listLinks(db, undefined, 1000);
  const transferIds = new Set(transfers.map((t) => t._id));
  const moved = links.filter((l) => ["reserve", "contribution", "donor_transfer", "refund"].includes(l.kind) && l.nessieId);
  checks.push(
    check(
      "Every fund transfer is in Nessie",
      moved.map((l) => ({ ref: `${l.kind}:${l.ref.slice(-6)}`, ok: l.kind === "reserve" || l.kind === "refund" ? true : transferIds.has(l.nessieId as string) })),
    ),
  );

  if (programIdFromEnv()) {
    // Grants decided since the program went live (its first hospital attestation).
    const { rows: decided } = await db.query<{ id: string; public_ref: string | null }>(
      `select id, public_ref from grants
        where visit_id is not null and status in ('paid', 'rejected')
          and decided_at >= coalesce((select min(created_at) from rail_links where kind = 'attest'), now())`,
    );
    const onChain = new Set(links.filter((l) => l.kind === "program_approve" || l.kind === "program_decline").map((l) => l.ref));
    checks.push(check("Every decided grant is in the on-chain program", decided.map((g) => ({ ref: g.public_ref ?? g.id.slice(-6), ok: onChain.has(g.id) }))));
  }

  return { checkedAt: new Date().toISOString(), ok: checks.every((c) => c.ok), checks };
}
