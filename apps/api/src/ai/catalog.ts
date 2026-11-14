// Assistance catalog (SPEC §3: two or three explicitly fictional programs for the MVP).
// Matching against these rules is deterministic (match.ts), not done by the model, so every
// result can be explained criterion by criterion. Real programs need verified rules,
// official links and a review date before they can be added here (fictional: false).

import type { DocumentType } from "./types";

export interface IncomeRule {
  /** Annual income limit for a household of one, integer cents. */
  baseCents: number;
  /** Added per extra household member, integer cents. */
  perExtraMemberCents: number;
}

export interface AssistanceProgram {
  id: string;
  name: string;
  fictional: boolean;
  /** One sentence for patients and reviewers. */
  description: string;
  /** Most the program pays toward one bill, integer cents. */
  capCents: number;
  rules: {
    documentTypes?: DocumentType[];
    maxBillCents?: number;
    income?: IncomeRule;
    requiresUninsured?: boolean;
    /** Bill date must be within this many days. */
    maxBillAgeDays?: number;
  };
  /** Required when fictional is false. */
  source?: { url: string; reviewedOn: string };
}

export const CATALOG: AssistanceProgram[] = [
  {
    id: "prog_rx_bridge",
    name: "Community Prescription Bridge (fictional)",
    fictional: true,
    description: "Helps with pharmacy and prescription costs for lower-income households.",
    capCents: 15_000,
    rules: {
      documentTypes: ["pharmacy_receipt", "prescription_receipt"],
      maxBillCents: 50_000,
      income: { baseCents: 4_000_000, perExtraMemberCents: 1_400_000 },
      maxBillAgeDays: 120,
    },
  },
  {
    id: "prog_neighbors_relief",
    name: "Neighbors Medical Bill Relief (fictional)",
    fictional: true,
    description: "Helps with clinic, lab, dental and vision bills for lower-income households.",
    capCents: 50_000,
    rules: {
      documentTypes: ["medical_bill", "lab_bill", "dental_bill", "vision_bill", "explanation_of_benefits"],
      income: { baseCents: 3_200_000, perExtraMemberCents: 1_100_000 },
      maxBillAgeDays: 180,
    },
  },
  {
    id: "prog_uninsured_care",
    name: "Uninsured Care Fund (fictional)",
    fictional: true,
    description: "Helps people without health insurance with any medical expense.",
    capCents: 25_000,
    rules: { requiresUninsured: true, maxBillAgeDays: 365 },
  },
];

export function incomeLimitCents(rule: IncomeRule, householdSize: number): number {
  return rule.baseCents + rule.perExtraMemberCents * Math.max(0, householdSize - 1);
}
