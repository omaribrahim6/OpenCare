// Patient portal (/user). A patient signs in on their own phone with the public account ID printed
// on their CareCard, or by tapping the card (its secret token), plus their birth date. Portal
// sessions are separate from kiosk sessions: their own table, their own cookie, no device needed.

import type { PortalOverviewResponse, PortalPatient, PortalPayResponse } from "@abdulcare/contracts";
import { patientForCardToken } from "./cards";
import type { Db } from "./db";
import { listGrants } from "./grants";
import { getInsurancePlan } from "./insurance";
import { getPatientWithProfile } from "./profiles";
import { CoreError, newId, newSecret, sha256 } from "./util";
import { getBill, listPatientVisitIds } from "./visits";

export const PORTAL_COOKIE = "opencare_portal";
export const PORTAL_SESSION_DAYS = 7;
/** Wrong birth dates allowed per account (or card) in the window before sign-in pauses. */
export const PORTAL_MAX_FAILURES = 5;
export const PORTAL_FAILURE_WINDOW_MINUTES = 15;

const NO_MATCH = "That account ID and birth date don't match.";

/** Same rule as the unique index: lowercase, letters and digits only, o→0 and i/l→1. */
export function normalizeAccountCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/o/g, "0")
    .replace(/[il]/g, "1");
}
const NORMALIZED_SQL = "translate(regexp_replace(lower(account_code), '[^a-z0-9]', '', 'g'), 'oil', '011')";

interface PortalRow {
  id: string;
  display_name: string;
  account_code: string | null;
  birth_date: string | null;
}
const PORTAL_SELECT = "select id, display_name, account_code, to_char(birth_date, 'YYYY-MM-DD') as birth_date from patients";

function toPortalPatient(r: PortalRow): PortalPatient {
  return {
    id: r.id,
    displayName: r.display_name,
    accountCode: r.account_code,
    birthYear: r.birth_date ? Number(r.birth_date.slice(0, 4)) : null,
  };
}

function validBirthDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Enrollment (and the demo seed) sets the printed account ID and the birth date. */
export async function setPatientAccount(
  db: Db,
  patientId: string,
  account: { accountCode: string; birthDate: string },
): Promise<void> {
  if (normalizeAccountCode(account.accountCode).length < 6) throw new CoreError("bad_request", "Account ID is too short");
  if (!validBirthDate(account.birthDate)) throw new CoreError("bad_request", "birthDate must be YYYY-MM-DD");
  const { rows } = await db.query(
    "update patients set account_code = $2, birth_date = $3::date where id = $1 returning id",
    [patientId, account.accountCode.trim().toLowerCase(), account.birthDate],
  );
  if (!rows[0]) throw new CoreError("not_found", "Patient not found");
}

/**
 * Sign in with the account ID or a card token, plus the birth date. Returns the session secret for
 * the PORTAL_COOKIE. Wrong answers get one message whatever was wrong, and pause after
 * PORTAL_MAX_FAILURES within the window.
 */
export async function signInToPortal(
  db: Db,
  input: { accountCode?: string | null; cardToken?: string | null; birthDate: unknown },
): Promise<{ patient: PortalPatient; secret: string }> {
  const code = input.accountCode ? normalizeAccountCode(String(input.accountCode)) : "";
  const token = input.cardToken ? String(input.cardToken) : "";
  if (!code && !token) throw new CoreError("bad_request", "Enter your account ID");
  if (!validBirthDate(input.birthDate)) throw new CoreError("bad_request", "Enter your birth date");
  const key = token ? `card:${sha256(token)}` : `acct:${code}`;

  const { rows: recent } = await db.query<{ n: number }>(
    `select count(*)::int as n from portal_sign_in_failures
      where key = $1 and at > now() - make_interval(mins => $2)`,
    [key, PORTAL_FAILURE_WINDOW_MINUTES],
  );
  if (Number(recent[0]?.n ?? 0) >= PORTAL_MAX_FAILURES) {
    throw new CoreError("forbidden", `Too many tries. Wait ${PORTAL_FAILURE_WINDOW_MINUTES} minutes and try again.`);
  }

  let row: PortalRow | undefined;
  if (token) {
    const owner = await patientForCardToken(db, token);
    if (owner) row = (await db.query<PortalRow>(`${PORTAL_SELECT} where id = $1`, [owner.id])).rows[0];
  } else {
    row = (await db.query<PortalRow>(`${PORTAL_SELECT} where ${NORMALIZED_SQL} = $1`, [code])).rows[0];
  }

  if (!row || !row.birth_date || row.birth_date !== input.birthDate) {
    await db.query("insert into portal_sign_in_failures (key) values ($1)", [key]);
    throw new CoreError("unauthenticated", token ? "That birth date doesn't match this CareCard." : NO_MATCH);
  }

  const secret = newSecret();
  await db.transaction(async (tx) => {
    await tx.query("delete from portal_sign_in_failures where key = $1", [key]);
    await tx.query(
      `insert into portal_sessions (secret_hash, patient_id, expires_at)
       values ($1, $2, now() + make_interval(days => $3))`,
      [sha256(secret), row.id, PORTAL_SESSION_DAYS],
    );
  });
  return { patient: toPortalPatient(row), secret };
}

/** The signed-in patient for a portal cookie, or null. */
export async function getPortalPatient(db: Db, secret: string | undefined | null): Promise<PortalPatient | null> {
  if (!secret) return null;
  const { rows } = await db.query<PortalRow>(
    `select p.id, p.display_name, p.account_code, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date
       from portal_sessions s join patients p on p.id = s.patient_id
      where s.secret_hash = $1 and s.ended_at is null and s.expires_at > now()`,
    [sha256(secret)],
  );
  return rows[0] ? toPortalPatient(rows[0]) : null;
}

export async function requirePortalPatient(db: Db, secret: string | undefined | null): Promise<PortalPatient> {
  const patient = await getPortalPatient(db, secret);
  if (!patient) throw new CoreError("unauthenticated", "Sign in to see your account.");
  return patient;
}

export async function endPortalSession(db: Db, secret: string | undefined | null): Promise<void> {
  if (!secret) return;
  await db.query("update portal_sessions set ended_at = now() where secret_hash = $1 and ended_at is null", [sha256(secret)]);
}

/** Everything the signed-in patient sees on /user: profile, plan, every bill and every claim. */
export async function getPortalOverview(db: Db, patient: PortalPatient): Promise<PortalOverviewResponse> {
  const { profile } = await getPatientWithProfile(db, patient.id);
  const plan = await getInsurancePlan(db, patient.id);
  const bills = [];
  for (const id of await listPatientVisitIds(db, patient.id)) bills.push(await getBill(db, id, { patientId: patient.id }));
  const claims = await listGrants(db, { patientId: patient.id });
  return { patient, profile, plan, bills, claims };
}

/**
 * The patient pays what's left on one of their bills out of pocket (simulated, like a kiosk
 * payment). Used after the fund covered part of a bill or declined it. Refused while a fund request
 * for the visit is still being decided or paid, and when the balance isn't the amount the patient
 * saw. Paying again once the bill is cleared pays nothing.
 */
export async function payPatientBalance(
  db: Db,
  input: { patientId: string; visitId: string; amountCents: unknown },
): Promise<PortalPayResponse> {
  const expected = input.amountCents;
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) {
    throw new CoreError("bad_request", "amountCents must be the balance in cents");
  }
  let paidCents = 0;
  await db.transaction(async (tx) => {
    // Lock the visit so a double tap can't pay twice.
    const { rows: visits } = await tx.query<{ patient_id: string }>(
      "select patient_id from visits where id = $1 for update",
      [input.visitId],
    );
    if (!visits[0]) throw new CoreError("not_found", "Visit not found");
    if (visits[0].patient_id !== input.patientId) throw new CoreError("forbidden", "Not this patient's visit");
    const { rows: live } = await tx.query(
      "select id from grants where visit_id = $1 and status in ('pending_review', 'approved', 'payment_pending')",
      [input.visitId],
    );
    if (live[0]) throw new CoreError("invalid_state", "The community fund is still deciding or paying this bill. Pay once it's done.");

    const bill = await getBill(tx, input.visitId, { patientId: input.patientId });
    if (bill.remainingCents <= 0) return;
    if (bill.remainingCents !== expected) throw new CoreError("conflict", "The balance changed. Check the new amount and try again.");

    const { rows: seqRows } = await tx.query<{ seq: number }>(
      "select coalesce(max(seq), 0)::int as seq from bill_events where visit_id = $1",
      [input.visitId],
    );
    await tx.query(
      `insert into bill_events (id, visit_id, type, amount_cents, source_kind, source_label, source_id,
                                status, simulated, reference, label, seq)
       values ($1, $2, 'patient_payment', $3, 'patient', 'Patient', null, 'confirmed', true, null, $4, $5)`,
      [newId("bev"), input.visitId, bill.remainingCents, "You paid the rest out of pocket (simulated)", Number(seqRows[0]?.seq ?? 0) + 1],
    );
    paidCents = bill.remainingCents;
  });
  return { bill: await getBill(db, input.visitId, { patientId: input.patientId }), paidCents };
}
