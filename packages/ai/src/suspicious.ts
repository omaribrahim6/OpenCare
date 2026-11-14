// Injection flag (SPEC §7 demo moment). Deterministic pattern check, no model call: hardship
// notes are never sent to Gemini, and a flag must never depend on the attacker's own text
// persuading a model. The flag is a warning only. Core never lets it change a score or rank.

import type { SuspiciousContent } from "@abdulcare/contracts";
import { cleanUntrusted, excerptAround, firstInjectionMatch } from "./sanitize";

export function detectSuspiciousSync(fields: { field: SuspiciousContent["field"]; text: string }[]): SuspiciousContent | null {
  for (const { field, text } of fields) {
    // Clean first so zero-width characters or odd Unicode can't hide the instruction.
    const clean = cleanUntrusted(text, 4000);
    const match = firstInjectionMatch(clean);
    if (match) return { field, excerpt: excerptAround(clean, match) };
  }
  return null;
}

export async function detectSuspicious(fields: { field: SuspiciousContent["field"]; text: string }[]): Promise<SuspiciousContent | null> {
  return detectSuspiciousSync(fields);
}
