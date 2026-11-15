// Linked rails, the Nessie side: every dollar in the story is a Nessie transaction, on every party's
// account. The patient's hospital bill lives on their Nessie account and shrinks as payers post; the
// patient pays the rest (or a monthly plan) from their checking; the fund moves an approval into a
// reserved account before paying the hospital; hospitals and donors fund it by transfer; refunds
// come back by transfer. Each movement is recorded once in rail_links, keyed so retries never repeat
// it, and the Solana side (proofs.ts, program.ts) points back at the Nessie ID.

import { createHash } from "node:crypto";
import {
  CoreError,
  getBill,
  getPatientWithProfile,
  newId,
  payoutReference,
  recordDonation,
  setDonationReceipt,
  type Db,
} from "@abdulcare/core";
import { dollarsToCents } from "./money";
import type { NessieClient, NessiePurchase, NessieTransfer } from "./nessie";
import type { PaymentsDeps } from "./redeem";
import { sendReceipt } from "./solana";

// ---------------------------------------------------------------------------
// rail_links: one row per (kind, ref), so every movement happens once
// ---------------------------------------------------------------------------

export type RailKind =
  | "payout"
  | "patient_payment"
  | "reserve"
  | "contribution"
  | "donor_transfer"
  | "refund"
  | "plan"
  | "bill_sync"
  | "hospital_account"
  | "program_approve"
  | "program_decline"
  | "program_paid"
  | "attest";

export interface RailLink {
  kind: RailKind;
  ref: string;
  nessieId: string | null;
  signature: string | null;
  amountCents: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

interface RailLinkRow {
  kind: RailKind;
  ref: string;
  nessie_id: string | null;
  signature: string | null;
  amount_cents: string | number | null;
  detail: Record<string, unknown> | null;
  created_at: string | Date;
}

function toLink(r: RailLinkRow): RailLink {
  return {
    kind: r.kind,
    ref: r.ref,
    nessieId: r.nessie_id,
    signature: r.signature,
    amountCents: r.amount_cents == null ? null : Number(r.amount_cents),
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function getLink(db: Db, kind: RailKind, ref: string): Promise<RailLink | null> {
  const { rows } = await db.query<RailLinkRow>("select * from rail_links where kind = $1 and ref = $2", [kind, ref]);
  return rows[0] ? toLink(rows[0]) : null;
}

export async function listLinks(db: Db, kind?: RailKind, limit = 200): Promise<RailLink[]> {
  const { rows } = kind
    ? await db.query<RailLinkRow>("select * from rail_links where kind = $1 order by created_at desc limit $2", [kind, limit])
    : await db.query<RailLinkRow>("select * from rail_links order by created_at desc limit $1", [limit]);
  return rows.map(toLink);
}

/** Insert or fill in a link. Fields already set are kept unless a new value is given. */
export async function saveLink(
  db: Db,
  input: {
    kind: RailKind;
    ref: string;
    nessieId?: string | null;
    signature?: string | null;
    amountCents?: number | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<RailLink> {
  const { rows } = await db.query<RailLinkRow>(
    `insert into rail_links (id, kind, ref, nessie_id, signature, amount_cents, detail)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (kind, ref) do update set
       nessie_id    = coalesce(excluded.nessie_id, rail_links.nessie_id),
       signature    = coalesce(excluded.signature, rail_links.signature),
       amount_cents = coalesce(excluded.amount_cents, rail_links.amount_cents),
       detail       = coalesce(excluded.detail, rail_links.detail),
       updated_at   = now()
     returning *`,
    [
      newId("rl"),
      input.kind,
      input.ref,
      input.nessieId ?? null,
      input.signature ?? null,
      input.amountCents ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
    ],
  );
  return toLink(rows[0]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Nessie keeps whole dollars: the part of an amount it can move. */
export function wholeDollarPart(cents: number): number {
  return Math.max(0, cents - (cents % 100));
}

/** Short public fingerprint of a Nessie ID, for memos and on-chain records. */
export function nessieFingerprint(nessieId: string): string {
  return createHash("sha256").update(`nessie:${nessieId}`).digest("hex");
}

/** The account a payout is paid from: the reserved account when one is set up, else the fund. */
export function payoutAccountId(deps: PaymentsDeps): string {
  return deps.reservedAccountId || deps.fundAccountId;
}

async function findPurchaseByKey(nessie: NessieClient, accountId: string, key: string): Promise<NessiePurchase | null> {
  return (await nessie.listPurchases(accountId)).find((p) => p.description?.includes(key)) ?? null;
}

async function findTransferByKey(nessie: NessieClient, accountId: string, key: string): Promise<NessieTransfer | null> {
  return (await nessie.listTransfers(accountId)).find((t) => t.description?.includes(key)) ?? null;
}

interface VisitBank {
  visitId: string;
  patientId: string;
  patientAccountId: string | null;
  hospitalId: string;
  hospitalName: string;
  merchantId: string | null;
  remainingCents: number;
}

async function visitBank(db: Db, visitId: string): Promise<VisitBank> {
  const bill = await getBill(db, visitId);
  const { nessieAccountId } = await getPatientWithProfile(db, bill.visit.patient.id);
  const { rows } = await db.query<{ nessie_merchant_id: string | null }>(
    "select nessie_merchant_id from providers where id = $1",
    [bill.visit.hospital.id],
  );
  return {
    visitId,
    patientId: bill.visit.patient.id,
    patientAccountId: nessieAccountId,
    hospitalId: bill.visit.hospital.id,
    hospitalName: bill.visit.hospital.name,
    merchantId: rows[0]?.nessie_merchant_id ?? process.env.NESSIE_PROVIDER_MERCHANT_ID ?? null,
    remainingCents: bill.remainingCents,
  };
}

// ---------------------------------------------------------------------------
// The patient's hospital bill, mirrored on their Nessie account
// ---------------------------------------------------------------------------

export const visitBillKey = (visitId: string) => `OpenCare visit ${visitId}`;

/**
 * Create or update the Nessie bill for a visit so the patient's bank shows what they owe right now:
 * created when the visit has a balance, lowered as insurance, the hospital and the fund post, and
 * marked completed at $0. Safe to call any number of times. Returns the Nessie bill ID or null when
 * the patient has no Nessie account.
 */
export async function syncNessieBill(deps: PaymentsDeps, visitId: string): Promise<string | null> {
  const v = await visitBank(deps.db, visitId);
  if (!v.patientAccountId) return null;
  const owed = wholeDollarPart(v.remainingCents);
  const link = await getLink(deps.db, "bill_sync", visitId);

  if (link?.nessieId) {
    if (link.amountCents === owed) return link.nessieId;
    if (owed === 0) await deps.nessie.updateBill(link.nessieId, { status: "completed" });
    else await deps.nessie.updateBill(link.nessieId, { amountCents: owed, status: "pending" });
    await saveLink(deps.db, { kind: "bill_sync", ref: visitId, amountCents: owed, detail: { status: owed === 0 ? "completed" : "pending" } });
    return link.nessieId;
  }

  // Look for a bill a previous, interrupted call created before saving its link.
  const key = visitBillKey(visitId);
  const existing = (await deps.nessie.listBills(v.patientAccountId)).find((b) => b.nickname?.includes(key));
  if (!existing && owed === 0) return null;
  const bill =
    existing ??
    (await deps.nessie.createBill(v.patientAccountId, {
      payee: v.hospitalName,
      nickname: key,
      amountCents: owed,
      paymentDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    }));
  if (existing && dollarsToCents(existing.payment_amount) !== owed) {
    if (owed === 0) await deps.nessie.updateBill(existing._id, { status: "completed" });
    else await deps.nessie.updateBill(existing._id, { amountCents: owed });
  }
  await saveLink(deps.db, {
    kind: "bill_sync",
    ref: visitId,
    nessieId: bill._id,
    amountCents: owed,
    detail: { status: owed === 0 ? "completed" : "pending", accountTail: v.patientAccountId.slice(-4) },
  });
  return bill._id;
}

// ---------------------------------------------------------------------------
// The patient pays the rest from their own checking account
// ---------------------------------------------------------------------------

export const patientPaymentKey = (visitId: string) => `OpenCare patient payment ${visitId}`;

/**
 * Pay `amountCents` of a visit from the patient's Nessie checking to the hospital's merchant. One
 * purchase per visit, however often it's called. Returns the Nessie purchase ID, or null when the
 * patient or hospital has no Nessie account (the caller then records the payment as simulated).
 */
export async function payBalanceThroughNessie(
  deps: PaymentsDeps,
  input: { visitId: string; patientId: string; amountCents: number },
): Promise<string | null> {
  const done = await getLink(deps.db, "patient_payment", input.visitId);
  if (done?.nessieId) return done.nessieId;
  const v = await visitBank(deps.db, input.visitId);
  if (v.patientId !== input.patientId) throw new CoreError("forbidden", "Not this patient's visit");
  if (!v.patientAccountId || !v.merchantId) return null;
  const moved = wholeDollarPart(input.amountCents);
  if (moved < 100) return null;

  const key = patientPaymentKey(input.visitId);
  const purchase =
    (await findPurchaseByKey(deps.nessie, v.patientAccountId, key)) ??
    (await deps.nessie.createPurchase(v.patientAccountId, { merchantId: v.merchantId, amountCents: moved, description: key }));
  await saveLink(deps.db, {
    kind: "patient_payment",
    ref: input.visitId,
    nessieId: purchase._id,
    amountCents: input.amountCents,
    detail: { movedCents: moved, merchantId: v.merchantId },
  });
  return purchase._id;
}

/**
 * Public devnet receipt for a patient paying the rest of a bill: memo-only, under an opaque hash of
 * the visit (no patient data). Safe to call again: returns the stored signature when there is one.
 * Never throws; null when Solana isn't configured or the transaction didn't confirm. Only a confirmed
 * signature is stored, so the account page never links to a transaction that didn't land.
 */
export async function sendPatientPaymentReceipt(
  deps: PaymentsDeps,
  input: { visitId: string; amountCents: number },
): Promise<string | null> {
  try {
    const done = await getLink(deps.db, "patient_payment", input.visitId);
    if (done?.signature) return done.signature;
    if (!deps.solana) return null;
    const memo = `${memoFor("oc_pp", patientPaymentKey(input.visitId))}:${input.amountCents}`;
    const { signature, status } = await sendReceipt(deps.solana, { memo, lamports: 0 });
    if (status !== "confirmed") return null;
    await saveLink(deps.db, { kind: "patient_payment", ref: input.visitId, signature, amountCents: input.amountCents });
    return signature;
  } catch (err) {
    deps.log?.(`patient payment receipt for ${input.visitId}: ${(err as Error).message}`);
    return null;
  }
}

/** Patient payment links for these visits, by visit ID (Nessie purchase and Solana signature). */
export async function patientPaymentLinks(db: Db, visitIds: string[]): Promise<Map<string, RailLink>> {
  if (visitIds.length === 0) return new Map();
  const { rows } = await db.query<RailLinkRow>(
    "select * from rail_links where kind = 'patient_payment' and ref = any($1::text[])",
    [visitIds],
  );
  return new Map(rows.map((r) => [r.ref, toLink(r)]));
}

// ---------------------------------------------------------------------------
// Payment plans: a recurring Nessie bill instead of "pay it all now"
// ---------------------------------------------------------------------------

export const PLAN_MONTHS = [3, 6, 12] as const;
export type PlanMonths = (typeof PLAN_MONTHS)[number];

export interface PaymentPlan {
  visitId: string;
  months: number;
  monthlyCents: number;
  totalCents: number;
  firstDue: string;
  nessieBillId: string;
  /** Monthly payment as a share of the patient's monthly income, when known (0–1). */
  incomeShare: number | null;
}

/** The most a plan should ask per month: 5% of monthly income, never under $10. */
export function affordableMonthlyCents(monthlyIncomeCents: number | null): number | null {
  if (!monthlyIncomeCents || monthlyIncomeCents <= 0) return null;
  return Math.max(1_000, Math.floor((monthlyIncomeCents * 0.05) / 100) * 100);
}

/** The shortest offered plan whose monthly payment fits the affordable amount (or 12 months). */
export function suggestPlanMonths(remainingCents: number, monthlyIncomeCents: number | null): PlanMonths {
  const cap = affordableMonthlyCents(monthlyIncomeCents);
  if (cap === null) return 6;
  for (const m of PLAN_MONTHS) if (Math.ceil(remainingCents / m / 100) * 100 <= cap) return m;
  return 12;
}

export async function getPaymentPlan(db: Db, visitId: string): Promise<PaymentPlan | null> {
  const link = await getLink(db, "plan", visitId);
  if (!link?.nessieId || !link.detail) return null;
  const d = link.detail as { months: number; monthlyCents: number; firstDue: string; incomeShare: number | null };
  return {
    visitId,
    months: d.months,
    monthlyCents: d.monthlyCents,
    totalCents: link.amountCents ?? d.months * d.monthlyCents,
    firstDue: d.firstDue,
    nessieBillId: link.nessieId,
    incomeShare: d.incomeShare ?? null,
  };
}

/**
 * Put what's left of a visit on an interest-free monthly plan: one recurring Nessie bill from the
 * patient's checking to the hospital. One plan per visit.
 */
export async function startPaymentPlan(
  deps: PaymentsDeps,
  input: { visitId: string; patientId: string; months: number },
): Promise<PaymentPlan> {
  if (!PLAN_MONTHS.includes(input.months as PlanMonths)) throw new CoreError("bad_request", "Plans run 3, 6 or 12 months");
  const existing = await getPaymentPlan(deps.db, input.visitId);
  if (existing) return existing;
  const v = await visitBank(deps.db, input.visitId);
  if (v.patientId !== input.patientId) throw new CoreError("forbidden", "Not this patient's visit");
  if (!v.patientAccountId) throw new CoreError("invalid_state", "This patient has no bank account on file");
  if (v.remainingCents < 100 * input.months) throw new CoreError("invalid_state", "The balance is too small for a plan");
  const { rows: live } = await deps.db.query(
    "select id from grants where visit_id = $1 and status in ('pending_review', 'approved', 'payment_pending')",
    [input.visitId],
  );
  if (live[0]) throw new CoreError("invalid_state", "The community fund is still deciding or paying this bill.");

  const monthlyCents = Math.ceil(v.remainingCents / input.months / 100) * 100;
  const first = new Date();
  first.setUTCMonth(first.getUTCMonth() + 1, 1);
  const firstDue = first.toISOString().slice(0, 10);
  const { profile } = await getPatientWithProfile(deps.db, input.patientId);
  const income = profile.monthlyIncomeCents ?? null;
  const key = `OpenCare plan ${input.visitId}`;
  const found = (await deps.nessie.listBills(v.patientAccountId)).find((b) => b.nickname?.includes(key));
  const bill =
    found ??
    (await deps.nessie.createBill(v.patientAccountId, {
      payee: v.hospitalName,
      nickname: `${key}: ${input.months} monthly payments`,
      amountCents: monthlyCents,
      status: "recurring",
      paymentDate: firstDue,
    }));
  const incomeShare = income ? Math.round((monthlyCents / income) * 1000) / 1000 : null;
  await saveLink(deps.db, {
    kind: "plan",
    ref: input.visitId,
    nessieId: bill._id,
    amountCents: monthlyCents * input.months,
    detail: { months: input.months, monthlyCents, firstDue, incomeShare },
  });
  return { visitId: input.visitId, months: input.months, monthlyCents, totalCents: monthlyCents * input.months, firstDue, nessieBillId: bill._id, incomeShare };
}

// ---------------------------------------------------------------------------
// The fund's reserved account: approval moves the money aside before the hospital is paid
// ---------------------------------------------------------------------------

export const reserveKey = (grantId: string) => `OpenCare reserve ${grantId}`;

/**
 * Move an approved amount from the fund's available account to its reserved account. Does nothing
 * when no reserved account is set up, and moves each grant once. Never throws for a Nessie failure:
 * the payout still runs, and the next call tries again.
 */
export async function reserveForPayout(deps: PaymentsDeps, grantId: string, approvedCents: number): Promise<string | null> {
  if (!deps.reservedAccountId) return null;
  const done = await getLink(deps.db, "reserve", grantId);
  if (done?.nessieId) return done.nessieId;
  try {
    const key = reserveKey(grantId);
    const moved = wholeDollarPart(approvedCents);
    if (moved < 100) return null;
    const transfer =
      (await findTransferByKey(deps.nessie, deps.fundAccountId, key)) ??
      (await deps.nessie.createTransfer(deps.fundAccountId, { payeeAccountId: deps.reservedAccountId, amountCents: moved, description: key }));
    await saveLink(deps.db, { kind: "reserve", ref: grantId, nessieId: transfer._id, amountCents: moved });
    return transfer._id;
  } catch (err) {
    deps.log?.(`reserve ${grantId}: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hospitals and donors fund the fund by transfer; refunds come back by transfer
// ---------------------------------------------------------------------------

/** A hospital's own Nessie checking account (set by the seed script), or null. */
export async function hospitalAccountId(db: Db, providerId: string): Promise<string | null> {
  return (await getLink(db, "hospital_account", providerId))?.nessieId ?? null;
}

function memoFor(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

export interface FundTransferReceipt {
  transferId: string;
  donationId: string;
  signature: string | null;
  duplicate: boolean;
}

/**
 * Move money into the fund from another Nessie account (a hospital's community-benefit
 * contribution, or a donor's checking) and record it as a donation with a memo receipt.
 */
export async function transferIntoFund(
  deps: PaymentsDeps,
  input: { kind: "contribution" | "donor_transfer"; fromAccountId: string; amountCents: number; key: string; label: string },
): Promise<FundTransferReceipt> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(input.key)) throw new CoreError("bad_request", "key must be 6–64 letters, digits, _ or -");
  const moved = wholeDollarPart(input.amountCents);
  if (moved < 100 || moved !== input.amountCents) throw new CoreError("bad_request", "Transfers into the fund are whole dollars from $1");
  const prior = await getLink(deps.db, input.kind, input.key);
  const description = `OpenCare ${input.label} ${input.key}`;
  const transfer =
    (prior?.nessieId ? { _id: prior.nessieId, amount: moved / 100 } : null) ??
    (await findTransferByKey(deps.nessie, input.fromAccountId, input.key)) ??
    (await deps.nessie.createTransfer(input.fromAccountId, { payeeAccountId: deps.fundAccountId, amountCents: moved, description }));

  let donation = await recordDonation(deps.db, { rail: "nessie", amountCents: dollarsToCents(transfer.amount), nessieDepositId: transfer._id });
  let signature = donation.solanaSignature ?? null;
  if (!signature && deps.solana) {
    try {
      signature = (await sendReceipt(deps.solana, { memo: memoFor(input.kind === "contribution" ? "oc_hc" : "oc_dt", input.key), lamports: 0 })).signature;
      await setDonationReceipt(deps.db, donation.id, signature);
      donation = { ...donation, solanaSignature: signature };
    } catch (err) {
      deps.log?.(`${input.kind} receipt: ${(err as Error).message}`);
    }
  }
  await saveLink(deps.db, { kind: input.kind, ref: input.key, nessieId: transfer._id, signature, amountCents: moved, detail: { label: input.label } });
  return { transferId: transfer._id, donationId: donation.id, signature, duplicate: Boolean(prior) };
}

/** A hospital's community-benefit contribution into the fund. */
export async function contributeFromHospital(
  deps: PaymentsDeps,
  input: { providerId: string; amountCents: number; key: string },
): Promise<FundTransferReceipt> {
  const from = await hospitalAccountId(deps.db, input.providerId);
  if (!from) throw new CoreError("invalid_state", "This hospital has no Nessie account (run npm run rails:seed -w @abdulcare/payments)");
  return transferIntoFund(deps, { kind: "contribution", fromAccountId: from, amountCents: input.amountCents, key: input.key, label: "hospital contribution" });
}

export interface RefundReceipt {
  grantId: string;
  transferId: string;
  amountCents: number;
  signature: string | null;
}

/**
 * The hospital returns money the fund paid (insurance paid late, or a charge was reversed): a
 * transfer from the hospital's Nessie account back to the fund, a public memo receipt under the
 * case's opaque reference, and the fund's total goes back up. One refund per grant.
 */
export async function refundToFund(
  deps: PaymentsDeps,
  input: { grantId: string; amountCents: number; reason: string },
): Promise<RefundReceipt> {
  const prior = await getLink(deps.db, "refund", input.grantId);
  if (prior?.nessieId) {
    return { grantId: input.grantId, transferId: prior.nessieId, amountCents: prior.amountCents ?? 0, signature: prior.signature };
  }
  const { rows } = await deps.db.query<{ status: string; approved_cents: string | null; provider_id: string; public_ref: string | null }>(
    "select status, approved_cents, provider_id, public_ref from grants where id = $1",
    [input.grantId],
  );
  const g = rows[0];
  if (!g) throw new CoreError("not_found", "Grant not found");
  if (g.status !== "paid") throw new CoreError("invalid_state", "Only a paid grant can be refunded");
  const moved = wholeDollarPart(input.amountCents);
  if (moved < 100 || moved > Number(g.approved_cents ?? 0)) throw new CoreError("bad_request", "Refund must be whole dollars, up to what the fund paid");
  const from = await hospitalAccountId(deps.db, g.provider_id);
  if (!from) throw new CoreError("invalid_state", "This hospital has no Nessie account (run npm run rails:seed -w @abdulcare/payments)");

  const key = `OpenCare refund ${input.grantId}`;
  const transfer =
    (await findTransferByKey(deps.nessie, from, key)) ??
    (await deps.nessie.createTransfer(from, { payeeAccountId: deps.fundAccountId, amountCents: moved, description: key }));
  await saveLink(deps.db, { kind: "refund", ref: input.grantId, nessieId: transfer._id, amountCents: moved, detail: { reason: input.reason.slice(0, 120) } });
  await deps.db.transaction(async (tx) => {
    const { rows: fresh } = await tx.query<{ detail: { counted?: boolean } | null }>(
      "select detail from rail_links where kind = 'refund' and ref = $1 for update",
      [input.grantId],
    );
    if (fresh[0]?.detail?.counted) return;
    await tx.query("update fund set total_cents = total_cents + $1 where id = 'community'", [moved]);
    await tx.query("insert into fund_events (type, amount_cents, grant_ref) values ('refund', $1, $2)", [moved, input.grantId]);
    await tx.query(
      "update rail_links set detail = coalesce(detail, '{}'::jsonb) || '{\"counted\": true}'::jsonb where kind = 'refund' and ref = $1",
      [input.grantId],
    );
  });

  let signature: string | null = null;
  if (deps.solana) {
    try {
      const ref = g.public_ref ?? payoutReference(input.grantId);
      signature = (await sendReceipt(deps.solana, { memo: `${ref}:refund`, lamports: 0 })).signature;
      await saveLink(deps.db, { kind: "refund", ref: input.grantId, signature });
    } catch (err) {
      deps.log?.(`refund receipt: ${(err as Error).message}`);
    }
  }
  return { grantId: input.grantId, transferId: transfer._id, amountCents: moved, signature };
}

// ---------------------------------------------------------------------------
// The bank check for caseworkers: totals only, never line items
// ---------------------------------------------------------------------------

export interface BankCheck {
  days: number;
  monthlyDepositsCents: number;
  monthlySpendingCents: number;
  monthlyBillsCents: number;
  /** Spending plus bills as a share of deposits (1 = spends everything that comes in). */
  spendingShare: number | null;
}

/**
 * A patient's last `days` days of Nessie activity, reduced to monthly totals. Only totals leave this
 * function: no merchants, descriptions or dates, so nothing personal reaches the score or the screen.
 */
export async function bankCheck(nessie: NessieClient, accountId: string, days = 90, now = new Date()): Promise<BankCheck> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const [deposits, purchases, bills] = await Promise.all([
    nessie.listDeposits(accountId),
    nessie.listPurchases(accountId),
    nessie.listBills(accountId),
  ]);
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + dollarsToCents(x.amount), 0);
  const perMonth = (cents: number) => Math.round((cents * 30) / days);
  const inDeposits = perMonth(sum(deposits.filter((d) => d.status !== "cancelled" && (d.transaction_date ?? "") >= since)));
  const spending = perMonth(sum(purchases.filter((p) => p.status !== "cancelled" && (p.purchase_date ?? "") >= since)));
  const recurring = bills
    .filter((b) => b.status === "recurring" || b.status === "pending")
    .reduce((s, b) => s + dollarsToCents(b.payment_amount), 0);
  const monthlyBills = perMonth(recurring);
  return {
    days,
    monthlyDepositsCents: inDeposits,
    monthlySpendingCents: spending,
    monthlyBillsCents: monthlyBills,
    spendingShare: inDeposits > 0 ? Math.round(((spending + monthlyBills) / inDeposits) * 100) / 100 : null,
  };
}
