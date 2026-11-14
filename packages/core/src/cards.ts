// CareCards and tap sessions (SPEC §3, §6). The card holds https://<base>/t/<token>.
// Only an HMAC of the token is stored. A tap starts a session only on a paired kiosk or provider
// device; on any other phone it reveals nothing.

import type { Device, PatientSummary, TapResult } from "@abdulcare/contracts";
import type { Db } from "./db";
import { listGrants } from "./grants";
import { getInsurancePlan } from "./insurance";

import { CoreError, hmac, newSecret, requireEnv, sha256 } from "./util";

export const SESSION_COOKIE = "abdulcare_session";
/** Kiosk sessions end after this much time (the UI also ends them on idle or "Done"). */
export const SESSION_MINUTES = 15;

function tokenHash(token: string): string {
  return hmac(requireEnv("CARD_TOKEN_PEPPER"), `card:${token}`);
}

/** Issue a card for a patient. Returns the token and the URL to write to the NFC tag. */
export async function issueCard(db: Db, patientId: string): Promise<{ token: string; url: string }> {
  const token = newSecret(16);
  await db.query("insert into card_tokens (token_hash, patient_id) values ($1, $2)", [tokenHash(token), patientId]);
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return { token, url: `${base}/t/${token}` };
}

export async function revokeCard(db: Db, token: string): Promise<void> {
  await db.query("update card_tokens set status = 'revoked' where token_hash = $1", [tokenHash(token)]);
}

async function patientForToken(db: Db, token: string): Promise<PatientSummary | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const { rows } = await db.query<{ id: string; display_name: string }>(
    `select p.id, p.display_name
       from card_tokens c join patients p on p.id = c.patient_id
      where c.token_hash = $1 and c.status = 'active'`,
    [tokenHash(token)],
  );
  return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
}

/**
 * Handle a card tap. `device` is the paired device from the cookie (or null).
 * When a session starts, `sessionSecret` must be set as the SESSION_COOKIE (httpOnly).
 */
export async function resolveTap(
  db: Db,
  token: string,
  device: Device | null,
): Promise<{ result: TapResult; sessionSecret?: string }> {
  // Reviewer laptops and unpaired phones never see patient data from a tap.
  if (!device || device.role === "reviewer") return { result: { kind: "unpaired_device" } };

  const patient = await patientForToken(db, token);
  if (!patient) return { result: { kind: "unknown_card" } };

  const sessionSecret = await startSession(db, device.id, patient.id);
  if (device.role === "kiosk") return { result: { kind: "session", patient }, sessionSecret };
  // Rev 6: a hospital terminal tap selects the patient for intake (POST /api/visits uses it).
  if (device.role === "hospital") {
    return { result: { kind: "intake", patient, plan: await getInsurancePlan(db, patient.id) }, sessionSecret };
  }

  const redeemableGrants = await listGrants(db, {
    status: "approved",
    patientId: patient.id,
    providerId: device.providerId ?? "",
  });
  return { result: { kind: "redemption", patient, redeemableGrants }, sessionSecret };
}

async function startSession(db: Db, deviceId: string, patientId: string): Promise<string> {
  const secret = newSecret();
  await db.transaction(async (tx) => {
    // One active session per device: a new tap replaces the previous patient.
    await tx.query("update sessions set ended_at = now() where device_id = $1 and ended_at is null", [deviceId]);
    await tx.query(
      `insert into sessions (secret_hash, device_id, patient_id, expires_at)
       values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [sha256(secret), deviceId, patientId, SESSION_MINUTES],
    );
  });
  return secret;
}

/** The patient for an active session on this device, or null. */
export async function getSessionPatient(
  db: Db,
  sessionSecret: string | undefined | null,
  device: Device | null,
): Promise<PatientSummary | null> {
  if (!sessionSecret || !device) return null;
  const { rows } = await db.query<{ id: string; display_name: string }>(
    `select p.id, p.display_name
       from sessions s join patients p on p.id = s.patient_id
      where s.secret_hash = $1 and s.device_id = $2 and s.ended_at is null and s.expires_at > now()`,
    [sha256(sessionSecret), device.id],
  );
  return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
}

/** Like getSessionPatient, but throws when there's no active patient session. */
export async function requireSessionPatient(
  db: Db,
  sessionSecret: string | undefined | null,
  device: Device | null,
): Promise<PatientSummary> {
  const patient = await getSessionPatient(db, sessionSecret, device);
  if (!patient) throw new CoreError("unauthenticated", "No active patient session. Tap the CareCard again.");
  return patient;
}

export async function endSession(db: Db, sessionSecret: string | undefined | null): Promise<void> {
  if (!sessionSecret) return;
  await db.query("update sessions set ended_at = now() where secret_hash = $1 and ended_at is null", [
    sha256(sessionSecret),
  ]);
}
