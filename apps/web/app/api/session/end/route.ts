// POST /api/session/end: end the patient session on this device ("Done" or idle timeout).

import type { EndSessionResponse } from "@abdulcare/contracts";
import { endSession, getDb } from "@abdulcare/core";
import { clearSessionCookie, readSessionCookie } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const POST = route(async () => {
  await endSession(getDb(), await readSessionCookie());
  await clearSessionCookie();
  return ok<EndSessionResponse>({ ok: true });
});
