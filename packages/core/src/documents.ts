// Documents (SPEC §9): a copy of the Nessie bill or purchase the patient chose. Route handlers
// re-read the item from Nessie (payments lane) and classify it (ai lane) before storing it here,
// so nothing in a document comes from the browser except the Nessie ID.

import {
  EXPENSE_CATEGORIES,
  type DocumentRecord,
  type DocumentSource,
  type ExpenseCategory,
} from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, isPositiveCents, iso, newId } from "./util";

interface DocumentRow {
  id: string;
  patient_id: string;
  source: DocumentSource;
  nessie_id: string;
  merchant: string;
  description: string | null;
  bill_date: Date | string | null;
  amount_cents: number;
  likely_medical: boolean | null;
  category: ExpenseCategory | null;
  created_at: Date;
}

export const DOC_COLUMNS = `id, patient_id, source, nessie_id, merchant, description, bill_date,
  amount_cents, likely_medical, category, created_at`;

export function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    source: row.source,
    nessieId: row.nessie_id,
    merchant: row.merchant,
    description: row.description,
    date: row.bill_date == null ? null : iso(row.bill_date).slice(0, 10),
    amountCents: Number(row.amount_cents),
    likelyMedical: row.likely_medical,
    category: row.category,
    createdAt: iso(row.created_at),
  };
}

export async function getDocument(db: Db, id: string): Promise<DocumentRecord> {
  const { rows } = await db.query<DocumentRow>(`select ${DOC_COLUMNS} from documents where id = $1`, [id]);
  if (!rows[0]) throw new CoreError("not_found", "Document not found");
  return toDocument(rows[0]);
}

/** Throws unless the document exists and belongs to this patient. */
export async function getOwnedDocument(db: Db, id: string, patientId: string): Promise<DocumentRecord> {
  const doc = await getDocument(db, id);
  if (doc.patientId !== patientId) throw new CoreError("forbidden", "Not this patient's document");
  return doc;
}

export interface NessieItemInput {
  source: DocumentSource;
  nessieId: string;
  merchant: string;
  description?: string | null;
  /** YYYY-MM-DD, or null. */
  date?: string | null;
  amountCents: number;
  likelyMedical?: boolean | null;
  category?: ExpenseCategory | null;
}

/**
 * Store the patient's chosen Nessie item. Choosing the same item again returns the existing
 * document, so a double tap on "Request help" never creates two.
 */
export async function createNessieDocument(db: Db, patientId: string, item: NessieItemInput): Promise<DocumentRecord> {
  if (item.source !== "nessie_bill" && item.source !== "nessie_purchase") {
    throw new CoreError("bad_request", "source must be nessie_bill or nessie_purchase");
  }
  if (!item.nessieId) throw new CoreError("bad_request", "nessieId is required");
  if (!isPositiveCents(item.amountCents)) throw new CoreError("bad_request", "amountCents must be a positive integer");
  if (item.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    throw new CoreError("bad_request", "date must be YYYY-MM-DD or null");
  }
  const category = item.category ?? null;
  if (category != null && !EXPENSE_CATEGORIES.includes(category)) {
    throw new CoreError("bad_request", "Unknown expense category");
  }

  const { rows } = await db.query<DocumentRow>(
    `insert into documents (id, patient_id, source, nessie_id, merchant, description, bill_date,
                            amount_cents, likely_medical, category)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (patient_id, nessie_id) do update set nessie_id = excluded.nessie_id
     returning ${DOC_COLUMNS}`,
    [
      newId("doc"),
      patientId,
      item.source,
      item.nessieId,
      String(item.merchant ?? "").slice(0, 200),
      item.description == null ? null : String(item.description).slice(0, 500),
      item.date ?? null,
      item.amountCents,
      item.likelyMedical ?? null,
      category,
    ],
  );
  return toDocument(rows[0]);
}
