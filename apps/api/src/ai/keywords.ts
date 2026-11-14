// Keyword rules: a deterministic fallback when the model is unavailable, and a cross-check
// for its answers. Matching is on whole words, case-insensitive.

import type { DocumentType } from "./types";

const RULES: Array<{ type: DocumentType; label: string; words: RegExp }> = [
  { type: "pharmacy_receipt", label: "pharmacy", words: /\b(pharmacy|pharmacie|drug ?store|rx|walgreens|cvs|rite ?aid|duane reade|apothecary|prescriptions?)\b/i },
  { type: "dental_bill", label: "dental office", words: /\b(dental|dentist(ry)?|orthodont\w*|endodont\w*)\b/i },
  { type: "vision_bill", label: "eye care provider", words: /\b(optometr\w*|ophthalm\w*|optical|vision|eye ?care)\b/i },
  { type: "lab_bill", label: "medical lab", words: /\b(lab(oratory|oratories|s)?|quest diagnostics|labcorp|patholog\w*|radiology|imaging|x-?ray|mri)\b/i },
  {
    type: "medical_bill",
    label: "healthcare provider",
    words: /\b(hospital|clinic|medical|health ?care|health center|urgent ?care|physicians?|doctors?|md|pediatric\w*|therap(y|ist)|physio\w*|surgery|surgical|emergency|er visit|ambulance|copay|co-pay)\b/i,
  },
];

export interface KeywordHit {
  type: DocumentType;
  label: string;
}

export function keywordHit(text: string): KeywordHit | null {
  for (const r of RULES) if (r.words.test(text)) return { type: r.type, label: r.label };
  return null;
}

export function guessDocumentType(text: string): DocumentType | null {
  return keywordHit(text)?.type ?? null;
}
