// BillEngine for revision 6 (contract in packages/contracts/src/bills.ts). Route handlers pick
// it up as `billEngine` from @abdulcare/ai (apps/web/app/api/_lib/deps.ts).

import type { BillEngine } from "@abdulcare/contracts";
import { evaluatePolicy } from "./policy";
import { applicationTemplate, briefTemplate, explanationTemplate } from "./templates";

/** Templates only: deterministic, no model calls. */
export const templateBillEngine: BillEngine = {
  evaluatePolicy,
  writeApplication: async (input) => applicationTemplate(input),
  writeBrief: async (input) => briefTemplate(input),
  explainBill: async (input) => explanationTemplate(input),
};

export function createBillEngine(): BillEngine {
  return templateBillEngine;
}

/** The production engine. */
export const billEngine: BillEngine = createBillEngine();
