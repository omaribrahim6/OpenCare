// Injection flag (SPEC §7 demo moment). Deterministic pattern check, no model call: hardship
// notes are never sent to Gemini, and a flag must never depend on the attacker's own text
// persuading a model. The flag is a warning only. Core never lets it change a score or rank.
//
// Untrusted fields (SPEC §3, §7): visit descriptions and line items, the hardship note, and
// hospital policy text (name and source). `policy_text` isn't in the contract's field union yet;
// until it is, callers can still pass it and the flag comes back with that field name.

import type { HospitalPolicy, SuspiciousContent } from "@abdulcare/contracts";
import { cleanUntrusted, excerptAround, firstInjectionMatch } from "./sanitize";

export type SuspiciousField = SuspiciousContent["field"] | "policy_text";
export interface SuspiciousFieldInput<F extends string = SuspiciousField> {
  field: F;
  text: string;
}

export function detectSuspiciousSync<F extends string>(fields: SuspiciousFieldInput<F>[]): { field: F; excerpt: string } | null {
  for (const { field, text } of fields) {
    // Clean first so zero-width characters or odd Unicode can't hide the instruction.
    const clean = cleanUntrusted(text, 4000);
    const match = firstInjectionMatch(clean);
    if (match) return { field, excerpt: excerptAround(clean, match) };
  }
  return null;
}

export async function detectSuspicious<F extends string>(fields: SuspiciousFieldInput<F>[]): Promise<{ field: F; excerpt: string } | null> {
  return detectSuspiciousSync(fields);
}

/** The free-text parts of a hospital policy, as fields for detectSuspicious. */
export function policyTextFields(policy: Pick<HospitalPolicy, "name" | "source">): SuspiciousFieldInput<"policy_text">[] {
  return [
    { field: "policy_text", text: policy.name },
    { field: "policy_text", text: policy.source },
  ];
}

/** True when a policy's name or source looks like instructions aimed at the system. */
export function policyTextSuspicious(policy: Pick<HospitalPolicy, "name" | "source">): boolean {
  return detectSuspiciousSync(policyTextFields(policy)) !== null;
}
