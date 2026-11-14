// Device pairing (SPEC §9): staff pair a browser as a kiosk, provider or reviewer with a PIN.
// The browser keeps a random secret in an httpOnly cookie; only its hash is stored.

import { DEVICE_ROLES, type Device, type DeviceRole } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError, newId, newSecret, requireEnv, safeEqual, sha256 } from "./util";

export const DEVICE_COOKIE = "abdulcare_device";

interface DeviceRow {
  id: string;
  role: DeviceRole;
  label: string;
  provider_id: string | null;
}

function toDevice(row: DeviceRow): Device {
  return { id: row.id, role: row.role, label: row.label, providerId: row.provider_id };
}

export async function pairDevice(
  db: Db,
  input: { role: DeviceRole; pin: string; label: string; providerId?: string },
): Promise<{ device: Device; secret: string }> {
  if (!DEVICE_ROLES.includes(input.role)) throw new CoreError("bad_request", "Unknown device role");
  if (!input.label?.trim()) throw new CoreError("bad_request", "Device label is required");
  if (!safeEqual(input.pin ?? "", requireEnv("PAIRING_PIN"))) {
    throw new CoreError("forbidden", "Wrong pairing PIN");
  }

  let providerId: string | null = null;
  if (input.role === "provider" || input.role === "hospital") {
    if (!input.providerId) throw new CoreError("bad_request", "Hospital devices need a providerId");
    const { rows } = await db.query("select id from providers where id = $1", [input.providerId]);
    if (rows.length === 0) throw new CoreError("not_found", "Unknown hospital");

    providerId = input.providerId;
  }

  const secret = newSecret();
  const { rows } = await db.query<DeviceRow>(
    `insert into devices (id, role, label, secret_hash, provider_id)
     values ($1, $2, $3, $4, $5)
     returning id, role, label, provider_id`,
    [newId("dev"), input.role, input.label.trim().slice(0, 80), sha256(secret), providerId],
  );
  return { device: toDevice(rows[0]), secret };
}

/** The device for a cookie secret, or null if the secret is missing or unknown. */
export async function authenticateDevice(db: Db, secret: string | undefined | null): Promise<Device | null> {
  if (!secret) return null;
  const { rows } = await db.query<DeviceRow>(
    `update devices set last_seen_at = now()
     where secret_hash = $1
     returning id, role, label, provider_id`,
    [sha256(secret)],
  );
  return rows[0] ? toDevice(rows[0]) : null;
}

/** Throws unless a device is present and has one of the allowed roles. */
export function requireRole(device: Device | null, roles: DeviceRole[]): Device {
  if (!device) throw new CoreError("unauthenticated", "This browser is not a paired device");
  if (!roles.includes(device.role)) {
    throw new CoreError("forbidden", `Only ${roles.join(" or ")} devices can do this`);
  }
  return device;
}
