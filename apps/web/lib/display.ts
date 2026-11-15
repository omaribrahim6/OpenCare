// Display clean-up: the data still marks demo records for the record ("(fictional)",
// "(simulated)", generated disclaimers), but screens never show those labels.

const LABELS: [RegExp, string][] = [
  // Whole disclaimer sentences written by the bill templates and Gemini prompts.
  [/\s*Prototype with fictional data\.\s*Insurance and hospital decisions shown here are simulated\.?/gi, ""],
  [/\s*Submission and the hospital's decision are simulated\.?/gi, ""],
  [/\s*Submission is simulated\.?/gi, ""],
  // Attestation labels on kiosk-logged visits.
  [/Kiosk demo \(simulated hospital intake\)/gi, "Kiosk"],
  [/,\s*simulated hospital intake/gi, ""],
  // Inline markers.
  [/\s*\((?:hospital decision, )?simulated\)/gi, ""],
  [/\(simulated, /gi, "("],
  [/\s*\(fictional\)/gi, ""],
  [/\s*\(Nessie sandbox\)/gi, ""],
];

export function scrubText(text: string): string {
  const out = LABELS.reduce((s, [re, to]) => s.replace(re, to), text);
  return out === text ? text : out.trimStart();
}

/** Deep copy with every string scrubbed; keys and non-string values stay as they are. */
export function scrub<T>(value: T): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) as T;
  }
  return value;
}
