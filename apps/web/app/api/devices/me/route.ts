// GET /api/devices/me: which paired device this browser is, if any.

import type { CurrentDeviceResponse } from "@abdulcare/contracts";
import { currentDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const GET = route(async () => ok<CurrentDeviceResponse>({ device: await currentDevice() }));
