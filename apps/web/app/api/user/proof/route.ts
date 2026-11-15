// GET /api/user/proof: for the signed-in patient, a Merkle proof of each request's place in the
// queue on the latest anchored day, checkable against the root in that day's devnet memo. Nobody
// else's data is shown: the proof is sibling hashes only.

import { getDb, listGrants, requirePortalPatient } from "@abdulcare/core";
import { caseProof } from "@abdulcare/payments";
import { ok, route } from "@/app/api/_lib/http";
import { readPortalCookie } from "../portal-cookie";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const db = getDb();
  const patient = await requirePortalPatient(db, await readPortalCookie());
  const grants = await listGrants(db, { patientId: patient.id });
  const proofs = [];
  for (const g of grants) {
    const proof = await caseProof(db, g.id);
    if (proof) proofs.push({ grantId: g.id, ...proof });
  }
  return ok({ proofs });
});
