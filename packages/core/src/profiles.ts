// Patient need profiles (SPEC §3 "Patient profile"): set at enrollment, read by the need
// assessment. Only caseworkers see them; they never go on-chain or on the public dashboard.

import { INSURANCE_STATUSES, type PatientProfile, type PatientSummary } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError } from "./util";

interface ProfileRow {
  id: string;
  display_name: string;
  household_size: number | null;
  monthly_income_cents: number | null;
  insurance_status: PatientProfile["insurance"];
  nessie_account_id: string | null;
}

export async function getPatientWithProfile(
  db: Db,
  patientId: string,
): Promise<{ patient: PatientSummary; profile: PatientProfile; nessieAccountId: string | null }> {
  const { rows } = await db.query<ProfileRow>(
    `select id, display_name, household_size, monthly_income_cents, insurance_status, nessie_account_id
       from patients where id = $1`,
    [patientId],
  );
  const r = rows[0];
  if (!r) throw new CoreError("not_found", "Patient not found");
  return {
    patient: { id: r.id, displayName: r.display_name },
    profile: {
      householdSize: r.household_size,
      monthlyIncomeCents: r.monthly_income_cents == null ? null : Number(r.monthly_income_cents),
      insurance: r.insurance_status,
    },
    nessieAccountId: r.nessie_account_id,
  };
}

/** Enrollment (and the demo seed) sets the profile. Each field may be null (unknown). */
export async function setPatientProfile(db: Db, patientId: string, profile: PatientProfile): Promise<void> {
  const { householdSize, monthlyIncomeCents, insurance } = profile;
  if (householdSize != null && !(Number.isInteger(householdSize) && householdSize >= 1 && householdSize <= 20)) {
    throw new CoreError("bad_request", "householdSize must be an integer from 1 to 20");
  }
  if (monthlyIncomeCents != null && !(Number.isSafeInteger(monthlyIncomeCents) && monthlyIncomeCents >= 0)) {
    throw new CoreError("bad_request", "monthlyIncomeCents must be a non-negative integer");
  }
  if (insurance != null && !INSURANCE_STATUSES.includes(insurance)) {
    throw new CoreError("bad_request", "Unknown insurance status");
  }
  const { rows } = await db.query(
    `update patients set household_size = $2, monthly_income_cents = $3, insurance_status = $4
      where id = $1 returning id`,
    [patientId, householdSize, monthlyIncomeCents, insurance],
  );
  if (!rows[0]) throw new CoreError("not_found", "Patient not found");
}
