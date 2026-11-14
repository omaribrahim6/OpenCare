// Patient bill, purchase and deposit import (SPEC §3 "Bill discovery", §7 income estimate).
// Payments fetches and normalizes; the ai lane classifies and does the income math.

import type { TransactionInput } from "@abdulcare/contracts";
import { dollarsToCents } from "./money";
import type { NessieClient } from "./nessie";

/**
 * The patient's open bills and recent purchases, normalized for the ai classifier. Merchant
 * names and descriptions are untrusted text (SPEC §7): pass them on, never act on them.
 */
export async function listPatientTransactions(nessie: NessieClient, accountId: string): Promise<TransactionInput[]> {
  const [bills, purchases] = await Promise.all([nessie.listBills(accountId), nessie.listPurchases(accountId)]);

  const fromBills: TransactionInput[] = bills
    .filter((b) => b.status === "pending" || b.status === "recurring")
    .map((b) => ({
      id: b._id,
      kind: "bill",
      merchant: b.payee,
      description: b.nickname,
      amountCents: dollarsToCents(b.payment_amount),
      date: b.payment_date ?? b.creation_date,
    }));

  const fromPurchases: TransactionInput[] = await Promise.all(
    purchases
      .filter((p) => p.status !== "cancelled")
      .map(async (p) => ({
        id: p._id,
        kind: "purchase" as const,
        merchant: await nessie.merchantName(p.merchant_id),
        description: p.description,
        amountCents: dollarsToCents(p.amount),
        date: p.purchase_date,
      })),
  );

  return [...fromBills, ...fromPurchases].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export interface IncomeDeposit {
  date: string;
  amountCents: number;
}

/**
 * Deposits into the patient's account over the last `days` days, for the ai lane's
 * deposit-based income estimate. Deposit descriptions are dropped: only dates and amounts count.
 */
export async function listIncomeDeposits(
  nessie: NessieClient,
  accountId: string,
  options: { days?: number; now?: Date } = {},
): Promise<IncomeDeposit[]> {
  const days = options.days ?? 90;
  const since = new Date((options.now ?? new Date()).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const deposits = await nessie.listDeposits(accountId);
  return deposits
    .filter((d) => d.status !== "cancelled" && d.transaction_date && d.transaction_date >= since)
    .map((d) => ({ date: d.transaction_date as string, amountCents: dollarsToCents(d.amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
