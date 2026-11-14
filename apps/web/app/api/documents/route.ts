// POST /api/documents: the patient picked a bill. The server re-reads it from Nessie by ID (the
// browser sends only the ID), stores a copy, and returns the plain-language explanation.

import type { CreateDocumentRequest, DocumentResponse } from "@abdulcare/contracts";
import { classifyTransactions, explainBill } from "@abdulcare/ai";
import { CoreError, createNessieDocument, getDb, getPatientWithProfile } from "@abdulcare/core";
import { listPatientTransactions } from "@abdulcare/payments";
import { requirePatientSession } from "@/app/api/_lib/auth";
import { payments } from "@/app/api/_lib/deps";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const { patient } = await requirePatientSession();
  const body = await readJson<CreateDocumentRequest>(req);
  if (body.source !== "nessie_bill" && body.source !== "nessie_purchase") {
    throw new CoreError("bad_request", "source must be nessie_bill or nessie_purchase");
  }
  const db = getDb();
  const { nessieAccountId } = await getPatientWithProfile(db, patient.id);
  if (!nessieAccountId) throw new CoreError("not_found", "No bank account is linked to this card");

  const txns = await listPatientTransactions(payments().nessie, nessieAccountId);
  const txn = txns.find((t) => t.id === String(body.nessieId ?? ""));
  const kind = body.source === "nessie_bill" ? "bill" : "purchase";
  if (!txn || txn.kind !== kind) throw new CoreError("not_found", "That bill isn't in the linked account");

  const [classification] = await classifyTransactions([txn]);
  const date = txn.date && /^\d{4}-\d{2}-\d{2}/.test(txn.date) ? txn.date.slice(0, 10) : null;
  const document = await createNessieDocument(db, patient.id, {
    source: body.source,
    nessieId: txn.id,
    merchant: txn.merchant,
    description: txn.description ?? null,
    date,
    amountCents: txn.amountCents,
    likelyMedical: classification?.likelyMedical ?? null,
    category: classification?.category ?? null,
  });
  const explanation = await explainBill({
    kind: txn.kind,
    merchant: txn.merchant,
    description: txn.description,
    amountCents: txn.amountCents,
    date: txn.date,
    category: document.category,
  });
  return ok<DocumentResponse>({ document, explanation }, 201);
});
