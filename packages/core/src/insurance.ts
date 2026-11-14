// Insurance (SPEC §7.1): a made-up plan per demo patient, applied with deterministic math.
// The patient pays the rest of the deductible, then coinsurance on the remainder, capped by what's
// left of the out-of-pocket maximum; the insurer pays the rest.

import type { InsuranceAdjudication, InsurancePlan } from "@abdulcare/contracts";
import type { Db } from "./db";
import { CoreError } from "./util";

export function adjudicate(plan: InsurancePlan, chargesCents: number): InsuranceAdjudication {
  if (!Number.isSafeInteger(chargesCents) || chargesCents < 0) {
    throw new CoreError("bad_request", "Charges must be a non-negative integer of cents");
  }
  const deductibleLeft = Math.max(0, plan.deductibleCents - plan.deductibleMetCents);
  const patientDeductibleCents = Math.min(chargesCents, deductibleLeft);
  const afterDeductible = chargesCents - patientDeductibleCents;
  const pct = Math.min(100, Math.max(0, plan.coinsurancePct));
  const coinsurance = Math.round((afterDeductible * pct) / 100);
  const raw = patientDeductibleCents + coinsurance;
  const oopLeft = Math.max(0, plan.outOfPocketMaxCents - plan.outOfPocketMetCents);
  const patientResponsibilityCents = Math.min(raw, oopLeft);
  // When the cap applies, the coinsurance shown is what the patient actually owes after the cap.
  const capped = patientResponsibilityCents < raw;
  const patientCoinsuranceCents = capped
    ? Math.max(0, patientResponsibilityCents - patientDeductibleCents)
    : coinsurance;
  return {
    chargesCents,
    patientDeductibleCents: Math.min(patientDeductibleCents, patientResponsibilityCents),
    patientCoinsuranceCents,
    patientResponsibilityCents,
    insurerPaysCents: chargesCents - patientResponsibilityCents,
    outOfPocketCapped: capped,
  };
}

interface PlanRow {
  payer_name: string;
  deductible_cents: number;
  deductible_met_cents: number;
  coinsurance_pct: number;
  oop_max_cents: number;
  oop_met_cents: number;
}

/** The patient's plan, or null when they have none on file (uninsured). */
export async function getInsurancePlan(db: Db, patientId: string): Promise<InsurancePlan | null> {
  const { rows } = await db.query<PlanRow>(
    `select payer_name, deductible_cents, deductible_met_cents, coinsurance_pct, oop_max_cents, oop_met_cents
       from insurance_plans where patient_id = $1`,
    [patientId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    payerName: r.payer_name,
    deductibleCents: Number(r.deductible_cents),
    deductibleMetCents: Number(r.deductible_met_cents),
    coinsurancePct: Number(r.coinsurance_pct),
    outOfPocketMaxCents: Number(r.oop_max_cents),
    outOfPocketMetCents: Number(r.oop_met_cents),
  };
}

const MAX_PLAN_CENTS = 100_000_000; // $1,000,000

/** Check a plan from the browser or the seed; returns a clean copy or throws bad_request. */
export function validatePlan(plan: unknown): InsurancePlan {
  const p = (plan ?? {}) as Record<string, unknown>;
  const payerName = typeof p.payerName === "string" ? p.payerName.trim().slice(0, 80) : "";
  if (!payerName) throw new CoreError("bad_request", "The plan needs a payer name");
  const cents = (key: string) => {
    const v = p[key];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > MAX_PLAN_CENTS) {
      throw new CoreError("bad_request", `${key} must be whole cents between 0 and $1,000,000`);
    }
    return v;
  };
  const coinsurancePct = p.coinsurancePct;
  if (typeof coinsurancePct !== "number" || !Number.isInteger(coinsurancePct) || coinsurancePct < 0 || coinsurancePct > 100) {
    throw new CoreError("bad_request", "coinsurancePct must be a whole number from 0 to 100");
  }
  const clean: InsurancePlan = {
    payerName,
    deductibleCents: cents("deductibleCents"),
    deductibleMetCents: cents("deductibleMetCents"),
    coinsurancePct,
    outOfPocketMaxCents: cents("outOfPocketMaxCents"),
    outOfPocketMetCents: cents("outOfPocketMetCents"),
  };
  if (clean.deductibleMetCents > clean.deductibleCents) throw new CoreError("bad_request", "Deductible met can't exceed the deductible");
  if (clean.outOfPocketMetCents > clean.outOfPocketMaxCents) {
    throw new CoreError("bad_request", "Out-of-pocket met can't exceed the out-of-pocket maximum");
  }
  return clean;
}

/** Enrollment, the patient (kiosk) and the demo seed set the plan; null removes it (uninsured). */
export async function setInsurancePlan(db: Db, patientId: string, input: InsurancePlan | null): Promise<void> {
  if (!input) {
    await db.query("delete from insurance_plans where patient_id = $1", [patientId]);
    return;
  }
  const plan = validatePlan(input);

  await db.query(
    `insert into insurance_plans (patient_id, payer_name, deductible_cents, deductible_met_cents,
                                  coinsurance_pct, oop_max_cents, oop_met_cents)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (patient_id) do update
       set payer_name = excluded.payer_name, deductible_cents = excluded.deductible_cents,
           deductible_met_cents = excluded.deductible_met_cents, coinsurance_pct = excluded.coinsurance_pct,
           oop_max_cents = excluded.oop_max_cents, oop_met_cents = excluded.oop_met_cents`,
    [
      patientId,
      plan.payerName,
      plan.deductibleCents,
      plan.deductibleMetCents,
      plan.coinsurancePct,
      plan.outOfPocketMaxCents,
      plan.outOfPocketMetCents,
    ],
  );
}
