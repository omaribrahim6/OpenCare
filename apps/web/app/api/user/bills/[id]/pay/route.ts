// POST /api/user/bills/:id/pay: the signed-in patient pays what's left on one of their bills, after
// the community fund covered part of it or declined. The body's amountCents must match the balance
// they were shown. Linked rails: the money moves from the patient's Nessie checking to the hospital's
// merchant (one purchase per visit); if banking isn't reachable it's recorded as simulated, as before.

import type { PortalPayRequest, PortalPayResponse } from "@abdulcare/contracts";
import { CoreError, getBill, getDb, payPatientBalance, requirePortalPatient } from "@abdulcare/core";
import { linkVisitRails, payBalanceThroughNessie, type PaymentsDeps } from "@abdulcare/payments";
import { after } from "next/server";
import { payments } from "@/app/api/_lib/deps";
import { ok, readJson, route, type IdParams } from "@/app/api/_lib/http";
import { readPortalCookie } from "../../../portal-cookie";
import { paymentReceipts, recordPaymentOnSolana } from "../../../receipts";

export const maxDuration = 30;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const body = await readJson<Partial<PortalPayRequest>>(req);

  let nessiePurchaseId: string | null = null;
  const bill = await getBill(db, id, { patientId: patient.id });
  if (bill.visit.patient.id !== patient.id) throw new CoreError("forbidden", "Not this patient's visit");
  const { rows: live } = await db.query(
    "select id from grants where visit_id = $1 and status in ('pending_review', 'approved', 'payment_pending')",
    [id],
  );
  // Only move money when core will accept the payment: no live fund request, and the same balance.
  if (!live[0] && bill.remainingCents > 0 && bill.remainingCents === body.amountCents) {
    try {
      nessiePurchaseId = await payBalanceThroughNessie(payments(), { visitId: id, patientId: patient.id, amountCents: bill.remainingCents });
    } catch (err) {
      console.error("[api] patient payment through Nessie didn't go through:", (err as Error).message);
    }
  }
  const result = await payPatientBalance(db, { patientId: patient.id, visitId: id, amountCents: body.amountCents, nessiePurchaseId });

  // The public Solana record of this payment: wait a few seconds so the receipt can show it; if devnet
  // is slower, finish after the response and the account page picks it up on its next load.
  let deps: PaymentsDeps | null = null;
  try {
    deps = payments();
  } catch {
    deps = null;
  }
  if (deps && result.paidCents > 0) {
    const { pending } = await recordPaymentOnSolana(deps, { visitId: id, amountCents: result.paidCents }, 12_000);
    if (pending) after(() => pending);
  }
  const [receipt] = await paymentReceipts(db, patient.id, [result.bill]);
  // After the response, so the pay button never waits on it: close the bill on the patient's
  // Nessie account. Banking not configured or slow: the mirror catches up next time.
  after(async () => {
    try {
      await linkVisitRails(payments(), id);
    } catch (err) {
      console.error("[api] Nessie bill mirror deferred:", (err as Error).message);
    }
  });
  return ok<PortalPayResponse>({ ...result, receipt: receipt ?? null });
});
