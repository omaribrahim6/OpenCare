// NeedEngine for packages/core (contract in packages/contracts/src/ai.ts).

import type { NeedEngine } from "@abdulcare/contracts";
import { assessNeed } from "./formula";
import type { ModelClient } from "./gemini";
import { rankQueue } from "./rank";
import { detectSuspicious } from "./suspicious";

/** Pass a client to use a fake model in tests; by default Gemini is created per call from env. */
export function createNeedEngine(deps: { client?: ModelClient; timeoutMs?: number } = {}): NeedEngine {
  return {
    assessNeed,
    rankQueue: (rows) => rankQueue(rows, deps),
    detectSuspicious,
  };
}

/** The production engine: GEMINI_API_KEY and GEMINI_MODEL from the environment. */
export const needEngine: NeedEngine = createNeedEngine();
