// The kiosk's hold-to-start demo on the real system. A paired kiosk starts a normal patient
// session for the seeded demo patient, and a visit is logged for them when none has a balance
// left, so the bill walk always has something to walk. Everything after that is the real flow.

import type { BillEngine, Device, NeedEngine, PatientSummary } from "@abdulcare/contracts";
import { startPatientSession } from "./cards";
import type { Db } from "./db";
import { getPatientWithProfile } from "./profiles";
import { CoreError } from "./util";
import { getBill, listPatientVisitIds, logVisit } from "./visits";

export const KIOSK_DEMO_PATIENT_ID = "pat_demo_jordan";
export const KIOSK_DEMO_TEMPLATE_ID = "tpl_demo_er";
/** Shown as who attested the visit, since no hospital terminal logged it. */
export const KIOSK_DEMO_ATTESTED_BY = "Kiosk demo (simulated hospital intake)";
/** How many of the patient's newest visits are checked for a balance before logging a new one. */
const VISITS_CHECKED = 5;

export interface KioskDemoStart {
  patient: PatientSummary;
  /** Goes in the SESSION_COOKIE, as after a card tap. */
  sessionSecret: string;
  /** The visit the kiosk should walk: the newest one with a balance left. */
  visitId: string;
  /** True when this call logged the visit. */
  logged: boolean;
}

/**
 * Start the demo patient's session on a kiosk device. If none of their recent visits has a balance
 * left, log the demo ER visit as simulated hospital intake. A new visit is only logged once the
 * previous one is fully paid, and concurrent calls log one visit, not two.
 */
export async function startKioskDemo(
  db: Db,
  engines: { bills: BillEngine; need?: Pick<NeedEngine, "detectSuspicious"> },
  input: {
    device: Pick<Device, "id" | "role">;
    depositIncomeCents?: (patientId: string) => Promise<number | null>;
    patientId?: string;
    templateId?: string;
  },
): Promise<KioskDemoStart> {
  if (input.device.role !== "kiosk") throw new CoreError("forbidden", "Only a paired kiosk can start the demo");
  const patientId = input.patientId ?? KIOSK_DEMO_PATIENT_ID;
  let patient: PatientSummary;
  try {
    ({ patient } = await getPatientWithProfile(db, patientId));
  } catch (err) {
    if (err instanceof CoreError && err.code === "not_found") {
      throw new CoreError("not_found", "The demo patient isn't seeded on this database");
    }
    throw err;
  }

  const visitIds = await listPatientVisitIds(db, patientId);
  let visitId: string | null = null;
  for (const id of visitIds.slice(0, VISITS_CHECKED)) {
    if ((await getBill(db, id)).remainingCents > 0) {
      visitId = id;
      break;
    }
  }

  let logged = false;
  if (!visitId) {
    // Keyed by how many visits the patient has, so two kiosks starting at once share one visit.
    const bill = await logVisit(db, engines, {
      templateId: input.templateId ?? KIOSK_DEMO_TEMPLATE_ID,
      patientId,
      device: { id: input.device.id, label: KIOSK_DEMO_ATTESTED_BY, providerId: null },
      idempotencyKey: `kiosk-demo:${patientId}:${visitIds.length}`,
      depositIncomeCents: input.depositIncomeCents ? await input.depositIncomeCents(patientId) : null,
      applyPolicies: false,
      anyHospital: true,
    });
    visitId = bill.visit.id;
    logged = true;
  }

  const sessionSecret = await startPatientSession(db, input.device.id, patientId);
  return { patient, sessionSecret, visitId, logged };
}
