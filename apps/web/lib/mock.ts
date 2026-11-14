// Mock data layer. Every screen calls these functions, so swapping in the real
// API (apps/api) later only touches this file. All people and programs are fictional.

import type {
  Explanation,
  ExtractedFields,
  FoundBill,
  FundSummary,
  Grant,
  Provider,
  TapResult,
} from "./types";

export const DEMO_PATIENT = { id: "pat_demo", displayName: "Jordan Rivera (fictional)" };

export const DEMO_PROVIDER: Provider = {
  id: "prov_pharmacy",
  name: "Riverside Community Pharmacy (fictional)",
  kind: "Pharmacy",
};

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** Card tap. Demo tokens: "demo" → patient, "unpaired" → unpaired phone, anything else → unknown card. */
export async function resolveTap(token: string): Promise<TapResult> {
  await delay();
  if (token === "demo") return { kind: "session", patient: DEMO_PATIENT };
  if (token === "unpaired") return { kind: "unpaired_device" };
  return { kind: "unknown_card" };
}

export async function getBills(): Promise<FoundBill[]> {
  await delay();
  return [
    {
      id: "bill_pharm",
      source: "nessie_bill",
      merchant: "Riverside Community Pharmacy",
      date: "2026-11-02",
      amountCents: 4500,
      likelyMedical: true,
      reason: "Merchant is a pharmacy and the memo mentions a prescription.",
    },
    {
      id: "pur_clinic",
      source: "nessie_purchase",
      merchant: "Northside Walk-in Clinic",
      date: "2026-10-21",
      amountCents: 12000,
      likelyMedical: true,
      reason: "Merchant category is a medical clinic.",
    },
    {
      id: "pur_grocer",
      source: "nessie_purchase",
      merchant: "Valley Grocery",
      date: "2026-11-05",
      amountCents: 3812,
      likelyMedical: false,
      reason: "Grocery store; no medical items indicated.",
    },
  ];
}

export const DEMO_FIELDS: ExtractedFields = {
  provider: { value: "Riverside Community Pharmacy", evidence: "RIVERSIDE COMMUNITY PHARMACY" },
  documentType: { value: "Pharmacy receipt", evidence: "PRESCRIPTION RECEIPT" },
  currency: { value: "USD", evidence: "$" },
  totalCents: { value: 4500, evidence: "PATIENT PAYS: $45.00" },
  date: { value: null },
};

export async function extractDocument(): Promise<ExtractedFields> {
  await delay(900);
  return DEMO_FIELDS;
}

export async function getExplanation(): Promise<Explanation> {
  await delay();
  return {
    summary:
      "This is a receipt from Riverside Community Pharmacy for a prescription. The amount you owe is $45.00. The receipt does not show a date.",
    amountCents: 4500,
    matches: [
      {
        programId: "prog_rx_bridge",
        name: "Community Rx Bridge (fictional)",
        fictional: true,
        possibleFit: true,
        reasons: ["Covers pharmacy costs", "Amount is under the $100 limit"],
        missingInfo: [],
        maxCents: 10000,
      },
      {
        programId: "prog_clinic_relief",
        name: "Neighborhood Clinic Relief (fictional)",
        fictional: true,
        possibleFit: false,
        reasons: ["Only covers clinic visits, not prescriptions"],
        missingInfo: ["Household size"],
        maxCents: 25000,
      },
    ],
  };
}

const grants: Grant[] = [
  {
    id: "grt_001",
    patientId: DEMO_PATIENT.id,
    patientName: DEMO_PATIENT.displayName,
    documentId: "doc_001",
    provider: DEMO_PROVIDER,
    requestedCents: 4500,
    approvedCents: null,
    status: "pending_review",
    createdAt: "2026-11-14T15:02:00Z",
    fields: DEMO_FIELDS,
    programName: "Community Rx Bridge (fictional)",
  },
];

export async function getGrant(id = "grt_001"): Promise<Grant | null> {
  await delay();
  return grants.find((g) => g.id === id) ?? null;
}

export async function listPendingGrants(): Promise<Grant[]> {
  await delay();
  return grants.filter((g) => g.status === "pending_review");
}

export async function getFundSummary(): Promise<FundSummary> {
  await delay();
  return {
    contributionsCents: 250000,
    availableCents: 195500,
    reservedCents: 4500,
    approvedCount: 4,
    paidCount: 3,
    paidCents: 50000,
    ledger: [
      { kind: "payout", reference: "po_7f3a91", signature: "5xQ…mock1", at: "2026-11-14T14:40:00Z" },
      { kind: "donation", reference: "dn_19bc02", signature: "3kP…mock2", at: "2026-11-14T13:10:00Z" },
      { kind: "payout", reference: "po_a02e44", signature: "4hR…mock3", at: "2026-11-14T12:05:00Z" },
    ],
  };
}

export function formatCents(c: number | null | undefined): string {
  if (c == null) return "Unknown";
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
