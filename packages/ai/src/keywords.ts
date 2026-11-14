// Keyword rules: the fallback classifier when the model is unavailable, and the source of a
// category when the model says "medical" without a valid one. Whole words, case-insensitive,
// checked in this order (emergency before hospital, so "Hospital ER" is emergency).

import type { ExpenseCategory } from "@abdulcare/contracts";

// `caseSensitive` catches abbreviations like "ER" without matching "er" inside other words.
const RULES: Array<{ category: ExpenseCategory; label: string; words: RegExp; caseSensitive?: RegExp }> = [
  { category: "emergency", label: "emergency care provider", words: /\b(emergency|urgent ?care|ambulance|trauma)\b/i, caseSensitive: /\b(ER|EMS)\b/ },
  { category: "pharmacy", label: "pharmacy", words: /\b(pharmacy|pharmacie|drug ?store|rx|walgreens|cvs|rite ?aid|duane reade|apothecary|prescriptions?)\b/i },
  { category: "hospital", label: "hospital", words: /\b(hospital|medical center|health system|inpatient|surgery|surgical)\b/i },
  { category: "dental_vision", label: "dental or vision provider", words: /\b(dental|dentist(ry)?|orthodont\w*|endodont\w*|optometr\w*|ophthalm\w*|optical|vision|eye ?care)\b/i },
  {
    category: "primary_care",
    label: "doctor's office or clinic",
    words: /\b(clinic|physicians?|doctors?|md|family (medicine|practice)|primary care|pediatric\w*|internal medicine|health center|copay|co-pay)\b/i,
  },
  {
    category: "other_medical",
    label: "healthcare provider",
    words: /\b(medical|health ?care|lab(oratory|oratories|s)?|quest diagnostics|labcorp|patholog\w*|radiology|imaging|x-?ray|mri|therap(y|ist)|physio\w*|chiropract\w*|counsel(ing|or))\b/i,
  },
];

export interface KeywordHit {
  category: ExpenseCategory;
  label: string;
}

export function keywordHit(text: string): KeywordHit | null {
  for (const r of RULES) if (r.words.test(text) || r.caseSensitive?.test(text)) return { category: r.category, label: r.label };
  return null;
}
