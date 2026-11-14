// BillEngine for revision 6 (contract in packages/contracts/src/bills.ts). Route handlers pick
// it up as `billEngine` from @abdulcare/ai (apps/web/app/api/_lib/deps.ts).

import type { BillEngine } from "@abdulcare/contracts";
import { explainBillLive, writeApplicationLive, writeBriefLive, type LiveDeps } from "./live";
import { evaluatePolicy } from "./policy";
import { applicationTemplate, briefTemplate, explanationTemplate } from "./templates";

/** Templates only: deterministic, no model calls. */
export const templateBillEngine: BillEngine = {
  evaluatePolicy,
  writeApplication: async (input) => applicationTemplate(input),
  writeBrief: async (input) => briefTemplate(input),
  explainBill: async (input) => explanationTemplate(input),
};

/**
 * Gemini rewrites behind checks, falling back to the templates. Pass a fake client in tests.
 * Without a key (or on any model failure) every method returns its template.
 */
export function createBillEngine(deps: LiveDeps = {}): BillEngine {
  return {
    evaluatePolicy,
    writeApplication: (input) => writeApplicationLive(input, deps),
    writeBrief: (input) => writeBriefLive(input, deps),
    explainBill: (input) => explainBillLive(input, deps),
  };
}

/** The production engine: Gemini via Vertex (GOOGLE_GENAI_USE_VERTEXAI) or GEMINI_API_KEY, else templates. */
export const billEngine: BillEngine = createBillEngine();
