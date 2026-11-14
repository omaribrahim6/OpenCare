// GET /api/patients/me/bills: likely medical bills and purchases from the patient's linked
// Nessie account, classified by the ai lane (SPEC §3 "Bill discovery").

import type { BillsResponse, FoundBill } from "@abdulcare/contracts";
import { classifyTransactions } from "@abdulcare/ai";
import { getDb, getPatientWithProfile } from "@abdulcare/core";
import { listPatientTransactions } from "@abdulcare/payments";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { payments } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => {
  const { patient } = await requirePatientSession();
  const { nessieAccountId } = await getPatientWithProfile(getDb(), patient.id);
  if (!nessieAccountId) return ok<BillsResponse>({ bills: [] });

  const txns = await listPatientTransactions(payments().nessie, nessieAccountId);
  const byId = new Map((await classifyTransactions(txns)).map((c) => [c.id, c]));
  const bills: FoundBill[] = txns
    .map((t) => {
      const c = byId.get(t.id);
      return {
        id: t.id,
        source: t.kind === "bill" ? "nessie_bill" : "nessie_purchase",
        merchant: t.merchant,
        description: t.description ?? null,
        date: t.date ?? null,
        amountCents: t.amountCents,
        likelyMedical: c?.likelyMedical ?? false,
        category: c?.category ?? null,
        reason: c?.reason ?? "",
      } satisfies FoundBill;
    })
    .filter((b) => b.likelyMedical);
  return ok<BillsResponse>({ bills });
});
