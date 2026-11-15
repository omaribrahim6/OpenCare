// POST /api/kiosk/charges (paired kiosk): the /kiosk/charge flow's result. Bills the patient whose
// CareCard was tapped on this kiosk (the normal kiosk session); with no tap (the presenter's hold
// fallback) it bills the demo patient, except from the kiosk iPhone app (user agent
// OpenCareKiosk/), which must have a tapped card: there it is a 401. 'fund_request' logs the itemized visit with its discounts
// and opens a real fund request, assessed at once so the admin queue ranks it.
// Body: { items: {label, cents}[], discounts: {label, cents}[], method, preset, outcome }.

import { assessGrant, getDb, kioskChargePatient, recordKioskCharge } from "@abdulcare/core";
import { optionalSessionPatient, requireDevice } from "@/app/api/_lib/auth";
import { billEngine, depositIncomeCents, needEngine, payments } from "@/app/api/_lib/deps";
import { linkVisitRails } from "@abdulcare/payments";
import { after } from "next/server";
import { ok, readJson, route } from "@/app/api/_lib/http";

export const maxDuration = 30;

export const POST = route(async (req: Request) => {
  const device = await requireDevice(["kiosk"]);
  const tapped = await optionalSessionPatient(device);
  const fromKioskApp = /\bOpenCareKiosk\//.test(req.headers.get("user-agent") ?? "");
  const patientId = kioskChargePatient(tapped?.id, { requireCard: fromKioskApp });
  const body = await readJson<Record<string, unknown>>(req);
  const db = getDb();

  const charge = await recordKioskCharge(
    db,
    { device, patientId, items: body.items, discounts: body.discounts, method: body.method, preset: body.preset, outcome: body.outcome },
    { bills: billEngine },
  );

  if (charge.grant) {
    // Same as POST /api/grants: a failure here never loses the request; the queue assesses on load.
    try {
      await assessGrant(db, needEngine, charge.grant.id, { depositIncomeCents: await depositIncomeCents(patientId) });
    } catch (err) {
      console.error("[api] need assessment deferred:", err);
    }
  }
  // Linked rails, after the response: the hospital bill appears on the patient's Nessie account.
  const visitId = charge.visitId;
  if (visitId) {
    after(async () => {
      try {
        await linkVisitRails(payments(), visitId);
      } catch (err) {
        console.error("[api] Nessie bill mirror deferred:", (err as Error).message);
      }
    });
  }
  return ok({ charge: { ...charge, billedVia: tapped ? "carecard" : "demo_patient" } }, 201);
});
