// Device and patient-session checks for route handlers (SPEC §8 backend rules).
// Device cookie: set once when staff pair a browser. Session cookie: set by a card tap.

import { cookies } from "next/headers";
import type { Device, DeviceRole, PatientSummary } from "@abdulcare/contracts";
import {
  DEVICE_COOKIE,
  SESSION_COOKIE,
  SESSION_MINUTES,
  authenticateDevice,
  getDb,
  requireRole,
  requireSessionPatient,
} from "@abdulcare/core";

const DEVICE_COOKIE_DAYS = 30;

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** The paired device for this browser, or null. */
export async function currentDevice(): Promise<Device | null> {
  const jar = await cookies();
  return authenticateDevice(getDb(), jar.get(DEVICE_COOKIE)?.value);
}

/** Throws unauthenticated/forbidden unless this browser is a paired device with one of `roles`. */
export async function requireDevice(roles: DeviceRole[]): Promise<Device> {
  return requireRole(await currentDevice(), roles);
}

/** The patient whose card was tapped on this device (kiosk by default; provider for redemption). */
export async function requirePatientSession(
  roles: DeviceRole[] = ["kiosk"],
): Promise<{ device: Device; patient: PatientSummary }> {
  const device = await requireDevice(roles);
  const jar = await cookies();
  const patient = await requireSessionPatient(getDb(), jar.get(SESSION_COOKIE)?.value, device);
  return { device, patient };
}

/** The current tap session, if any, without throwing (used where several roles are allowed). */
export async function optionalSessionPatient(device: Device): Promise<PatientSummary | null> {
  const jar = await cookies();
  try {
    return await requireSessionPatient(getDb(), jar.get(SESSION_COOKIE)?.value, device);
  } catch {
    return null;
  }
}

export async function setDeviceCookie(secret: string): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, secret, cookieOptions(DEVICE_COOKIE_DAYS * 24 * 60 * 60));
}

export async function setSessionCookie(secret: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, secret, cookieOptions(SESSION_MINUTES * 60));
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
