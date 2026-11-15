// GET /api/ledger: every donation and every decided case, newest first (SPEC §2 public audit).
// Public callers get only the publishable fields (Omar's /fund decision): per paid case the
// reference, hospital, amount, date, receipt, care category and the money steps; declines only as
// totals; never the visit summary, need score or region. A paired caseworker device gets the full
// rows the admin ledger needs.

import type { LedgerEntry, LedgerResponse } from "@abdulcare/contracts";
import { CoreError, getDb, listLedger } from "@abdulcare/core";
import { currentDevice } from "@/app/api/_lib/auth";
import { ok, route } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

function publicEntry(e: LedgerEntry): LedgerEntry {
  return {
    kind: e.kind,
    reference: e.reference,
    at: e.at,
    amountCents: e.amountCents,
    solanaSignature: e.solanaSignature,
    donorLabel: e.donorLabel,
    donorKind: e.donorKind,
    purpose: e.purpose,
    rail: e.rail,
    hospital: e.hospital,
    category: e.category,
    chargesCents: e.chargesCents,
    insurerPaidCents: e.insurerPaidCents,
    hospitalAssistanceCents: e.hospitalAssistanceCents,
  };
}

export const GET = route(async () => {
  const ledger = await listLedger(getDb());
  const device = await currentDevice().catch((err) => {
    if (err instanceof CoreError) return null;
    throw err;
  });
  if (device?.role === "reviewer") return ok<LedgerResponse>(ledger);
  return ok<LedgerResponse>({
    totals: ledger.totals,
    entries: ledger.entries.filter((e) => e.kind !== "declined").map(publicEntry),
  });
});
