// POST /api/devices/pair: staff pair this browser as a kiosk, provider or caseworker device.
// The device secret goes only into an httpOnly cookie (SPEC §5).

import type { PairDeviceRequest, PairDeviceResponse } from "@abdulcare/contracts";
import { getDb, pairDevice } from "@abdulcare/core";
import { setDeviceCookie } from "@/app/api/_lib/auth";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const POST = route(async (req: Request) => {
  const body = await readJson<PairDeviceRequest>(req);
  const { device, secret } = await pairDevice(getDb(), {
    role: body.role,
    pin: String(body.pin ?? ""),
    label: String(body.label ?? ""),
    providerId: body.providerId,
  });
  await setDeviceCookie(secret);
  return ok<PairDeviceResponse>({ device }, 201);
});
