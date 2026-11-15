// POST /api/session/demo: the kiosk's hold-to-start demo on the real system. Only a browser paired
// as a kiosk (staff PIN) can call it, so visitors on their own phones can't write anything. It
// starts a normal session for the seeded demo patient and makes sure they have a bill to walk.

import type { DemoSessionResponse } from "@abdulcare/contracts";
import { getDb, startKioskDemo } from "@abdulcare/core";
import { requireDevice, setSessionCookie } from "@/app/api/_lib/auth";
import { billEngine, depositIncomeCents, needEngine } from "@/app/api/_lib/deps";
import { ok, route } from "@/app/api/_lib/http";

// Logging the visit may write application text with Gemini, one call per policy.
export const maxDuration = 60;

export const POST = route(async () => {
  const device = await requireDevice(["kiosk"]);
  const { patient, sessionSecret, visitId, logged } = await startKioskDemo(
    getDb(),
    { bills: billEngine, need: needEngine },
    { device, depositIncomeCents },
  );
  await setSessionCookie(sessionSecret);
  return ok<DemoSessionResponse>({ patient, visitId }, logged ? 201 : 200);
});
