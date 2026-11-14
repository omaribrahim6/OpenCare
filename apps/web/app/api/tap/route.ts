// POST /api/tap: a CareCard tap. The /t/[token] page posts the token from its URL.
// Only a paired kiosk or provider device gets a session; any other browser learns nothing (SPEC §3).

import type { TapRequest, TapResponse } from "@abdulcare/contracts";
import { getDb, resolveTap } from "@abdulcare/core";
import { currentDevice, setSessionCookie } from "@/app/api/_lib/auth";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const { token } = await readJson<TapRequest>(req);
  const device = await currentDevice();
  const { result, sessionSecret } = await resolveTap(getDb(), String(token ?? ""), device);
  if (sessionSecret) await setSessionCookie(sessionSecret);
  return ok<TapResponse>(result);
});
