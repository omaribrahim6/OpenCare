// Receipts for the bills a patient paid themselves on /user: the bank transaction (Nessie purchase)
// and the public Solana record of the payment, joined from bill_events and rail_links.

import type { Bill, PortalPaymentReceipt } from "@abdulcare/contracts";
import { getPatientWithProfile, type Db } from "@abdulcare/core";
import { explorerTxUrl, patientPaymentLinks, sendPatientPaymentReceipt, type PaymentsDeps } from "@abdulcare/payments";

export const maskAccount = (nessieAccountId: string): string => `Checking ••${nessieAccountId.slice(-4).toUpperCase()}`;

/** The masked account the patient pays from, for the confirmation sheet. */
export async function payFromLabel(db: Db, patientId: string): Promise<string | null> {
  const { nessieAccountId } = await getPatientWithProfile(db, patientId);
  return nessieAccountId ? maskAccount(nessieAccountId) : null;
}

const paidEvent = (b: Bill) =>
  [...b.events].reverse().find((e) => e.type === "patient_payment" && e.status === "confirmed") ?? null;

export async function paymentReceipts(db: Db, patientId: string, bills: Bill[]): Promise<PortalPaymentReceipt[]> {
  const paid = bills.filter((b) => paidEvent(b));
  if (paid.length === 0) return [];
  const [links, { nessieAccountId }] = await Promise.all([
    patientPaymentLinks(db, paid.map((b) => b.visit.id)),
    getPatientWithProfile(db, patientId),
  ]);
  return paid
    .map((b) => {
      const ev = paidEvent(b)!;
      const link = links.get(b.visit.id);
      const bankTransactionId = ev.reference ?? link?.nessieId ?? null;
      const signature = link?.signature ?? null;
      return {
        visitId: b.visit.id,
        amountCents: ev.amountCents,
        paidAt: ev.createdAt,
        hospital: b.visit.hospital.name,
        fromAccount: bankTransactionId && nessieAccountId ? maskAccount(nessieAccountId) : null,
        bankTransactionId,
        solanaSignature: signature,
        explorerUrl: signature ? explorerTxUrl(signature) : null,
      };
    })
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

/** Record the payment on Solana, waiting up to `waitMs`. Returns the signature, or null and the
 *  still-running promise so the caller can finish it after the response. */
export async function recordPaymentOnSolana(
  deps: PaymentsDeps,
  input: { visitId: string; amountCents: number },
  waitMs: number,
): Promise<{ signature: string | null; pending: Promise<unknown> | null }> {
  const sending = sendPatientPaymentReceipt(deps, input);
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), waitMs));
  const first = await Promise.race([sending, timeout]);
  return first === "timeout" ? { signature: null, pending: sending } : { signature: first, pending: null };
}
