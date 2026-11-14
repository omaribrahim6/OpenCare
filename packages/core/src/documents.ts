// Document persistence (SPEC §3, §9). Extraction itself is the ai lane's job: route handlers
// call @abdulcare/ai and store the result here.

import type {
  ConfirmedFields,
  DocumentRecord,
  DocumentSource,
  DocumentStatus,
  ExtractionResult,
} from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, iso, newId } from "./util";

/** Vercel's request body limit is 4.5 MB; base64 adds a third. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_MIMES = ["image/jpeg", "image/png"];

interface DocumentRow {
  id: string;
  patient_id: string;
  source: DocumentSource;
  status: DocumentStatus;
  extraction: ExtractionResult | null;
  confirmed: ConfirmedFields | null;
  has_image: boolean;
  created_at: Date;
}

const DOC_SELECT = `select id, patient_id, source, status, extraction, confirmed,
                           image is not null as has_image, created_at
                      from documents`;

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    source: row.source,
    status: row.status,
    extraction: row.extraction,
    confirmed: row.confirmed,
    imageUrl: row.has_image ? `/api/documents/${row.id}/image` : null,
    createdAt: iso(row.created_at),
  };
}

export async function getDocument(db: Db, id: string): Promise<DocumentRecord> {
  const { rows } = await db.query<DocumentRow>(`${DOC_SELECT} where id = $1`, [id]);
  if (!rows[0]) throw new CoreError("not_found", "Document not found");
  return toDocument(rows[0]);
}

/** Throws unless the document exists and belongs to this patient. */
export async function getOwnedDocument(db: Db, id: string, patientId: string): Promise<DocumentRecord> {
  const doc = await getDocument(db, id);
  if (doc.patientId !== patientId) throw new CoreError("forbidden", "Not this patient's document");
  return doc;
}

export async function createScanDocument(
  db: Db,
  patientId: string,
  image: Buffer,
  mimeType: string,
): Promise<DocumentRecord> {
  if (!IMAGE_MIMES.includes(mimeType)) throw new CoreError("bad_request", "Image must be JPEG or PNG");
  if (image.length === 0) throw new CoreError("bad_request", "Image is empty");
  if (image.length > MAX_IMAGE_BYTES) throw new CoreError("bad_request", "Image is larger than 3 MB");
  const id = newId("doc");
  await db.query(
    "insert into documents (id, patient_id, source, image, image_mime) values ($1, $2, 'scan', $3, $4)",
    [id, patientId, image, mimeType],
  );
  return getDocument(db, id);
}

export async function createNessieDocument(
  db: Db,
  patientId: string,
  source: "nessie_bill" | "nessie_purchase",
  nessieId: string,
): Promise<DocumentRecord> {
  if (!nessieId) throw new CoreError("bad_request", "nessieId is required");
  const id = newId("doc");
  await db.query(
    "insert into documents (id, patient_id, source, nessie_id) values ($1, $2, $3, $4)",
    [id, patientId, source, nessieId],
  );
  return getDocument(db, id);
}

export async function getDocumentImage(db: Db, id: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const { rows } = await db.query<{ image: Buffer | Uint8Array | null; image_mime: string | null }>(
    "select image, image_mime from documents where id = $1",
    [id],
  );
  const row = rows[0];
  if (!row?.image || !row.image_mime) return null;
  return { bytes: Buffer.from(row.image), mimeType: row.image_mime };
}

/** Store the ai lane's extraction result. Unreadable scans go to retake/manual review. */
export async function saveExtraction(db: Db, id: string, extraction: ExtractionResult): Promise<DocumentRecord> {
  await db.query(
    `update documents set extraction = $2, warnings = $3, status = $4, updated_at = now()
      where id = $1 and status in ('extracting', 'extracted', 'unreadable')`,
    [id, JSON.stringify(extraction), extraction.warnings ?? [], extraction.readable ? "extracted" : "unreadable"],
  );
  return getDocument(db, id);
}

function validateConfirmed(c: ConfirmedFields): ConfirmedFields {
  if (!c || typeof c !== "object") throw new CoreError("bad_request", "confirmed fields are required");
  const total = c.totalCents;
  if (total != null && !(Number.isSafeInteger(total) && total > 0)) {
    throw new CoreError("bad_request", "totalCents must be a positive integer or null");
  }
  if (c.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
    throw new CoreError("bad_request", "date must be YYYY-MM-DD or null");
  }
  const text = (v: string | null) => (v == null ? null : String(v).slice(0, 200));
  return {
    provider: text(c.provider),
    documentType: c.documentType ?? null,
    currency: c.currency == null ? null : String(c.currency).toUpperCase().slice(0, 3),
    totalCents: total ?? null,
    date: c.date ?? null,
  };
}

/** The patient reviewed and corrected the fields (SPEC §3: required before a request). */
export async function confirmDocument(
  db: Db,
  id: string,
  patientId: string,
  confirmed: ConfirmedFields,
): Promise<DocumentRecord> {
  const doc = await getOwnedDocument(db, id, patientId);
  if (doc.status === "extracting") throw new CoreError("invalid_state", "Extraction hasn't finished yet");
  const { rows: locked } = await db.query("select 1 from grants where document_id = $1", [id]);
  if (locked[0]) throw new CoreError("invalid_state", "A request was already made for this document");
  await db.query(
    "update documents set confirmed = $2, status = 'confirmed', updated_at = now() where id = $1",
    [id, JSON.stringify(validateConfirmed(confirmed))],
  );
  return getDocument(db, id);
}
