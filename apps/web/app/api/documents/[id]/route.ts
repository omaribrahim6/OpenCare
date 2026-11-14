// GET /api/documents/:id: the owner's kiosk session, or a caseworker device.

import type { DocumentRecord } from "@abdulcare/contracts";
import { CoreError, getDb, getDocument, getOwnedDocument } from "@abdulcare/core";
import { optionalSessionPatient, requireDevice } from "@/app/api/_lib/auth";
import { ok, route, type IdParams } from "@/app/api/_lib/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const device = await requireDevice(["kiosk", "reviewer"]);
  const db = getDb();
  if (device.role === "reviewer") return ok<{ document: DocumentRecord }>({ document: await getDocument(db, id) });
  const patient = await optionalSessionPatient(device);
  if (!patient) throw new CoreError("unauthenticated", "No active patient session. Tap the CareCard again.");
  return ok<{ document: DocumentRecord }>({ document: await getOwnedDocument(db, id, patient.id) });
});
