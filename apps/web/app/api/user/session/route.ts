// POST /api/user/session: the patient signs in on their own phone with their account ID (or the
// token from a CareCard tap) and birth date. GET: who is signed in. DELETE: sign out.

import type { PortalSessionResponse, PortalSignInRequest } from "@abdulcare/contracts";
import { endPortalSession, getDb, requirePortalPatient, signInToPortal } from "@abdulcare/core";
import { ok, readJson, route } from "@/app/api/_lib/http";
import { clearPortalCookie, readPortalCookie, setPortalCookie } from "../portal-cookie";

export const POST = route(async (req: Request) => {
  const body = await readJson<Partial<PortalSignInRequest>>(req);
  const { patient, secret } = await signInToPortal(getDb(), {
    accountCode: typeof body.accountCode === "string" ? body.accountCode : null,
    cardToken: typeof body.cardToken === "string" ? body.cardToken : null,
    birthDate: body.birthDate,
  });
  await setPortalCookie(secret);
  return ok<PortalSessionResponse>({ patient }, 201);
});

export const GET = route(async () => {
  const patient = await requirePortalPatient(getDb(), await readPortalCookie());
  return ok<PortalSessionResponse>({ patient });
});

export const DELETE = route(async () => {
  await endPortalSession(getDb(), await readPortalCookie());
  await clearPortalCookie();
  return ok({ ok: true });
});
