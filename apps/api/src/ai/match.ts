// Deterministic assistance matching (SPEC §3 P0 "Assistance matching"). Input is the
// patient-confirmed fields, never raw model output. A match is a possible fit only.

import { CATALOG, incomeLimitCents, type AssistanceProgram } from "./catalog";
import type { ConfirmedFields, CriterionResult, PatientInfo, ProgramMatch } from "./types";

export const MATCH_NOTE =
  "This is a possible fit based on the information you gave, not a guarantee. A human reviewer makes the decision.";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABELS: Record<string, string> = {
  pharmacy_receipt: "pharmacy receipt",
  prescription_receipt: "prescription receipt",
  medical_bill: "medical bill",
  lab_bill: "lab bill",
  dental_bill: "dental bill",
  vision_bill: "vision bill",
  explanation_of_benefits: "explanation of benefits",
  other: "other document",
};

const DAY_MS = 86_400_000;

interface Check {
  result: CriterionResult;
  question?: string;
}

function checks(p: AssistanceProgram, doc: ConfirmedFields, patient: PatientInfo, today: Date): Check[] {
  const out: Check[] = [];
  const r = p.rules;
  const add = (id: string, label: string, status: CriterionResult["status"], detail: string, question?: string) =>
    out.push({ result: { id, label, status, detail }, question: status === "unknown" ? question : undefined });

  if (doc.currency !== null && doc.currency !== "USD") {
    add("currency", "Bill in US dollars", "not_met", `The bill is in ${doc.currency}; this program pays US dollar bills only.`);
  }

  if (r.documentTypes) {
    const allowed = r.documentTypes.map((t) => TYPE_LABELS[t]).join(", ");
    if (doc.documentType === null) {
      add("document_type", "Type of expense", "unknown", `Covers: ${allowed}.`, "What kind of bill is this (pharmacy, clinic, lab, dental, vision)?");
    } else if (r.documentTypes.includes(doc.documentType)) {
      add("document_type", "Type of expense", "met", `A ${TYPE_LABELS[doc.documentType]} is covered.`);
    } else {
      add("document_type", "Type of expense", "not_met", `Covers ${allowed}, not a ${TYPE_LABELS[doc.documentType]}.`);
    }
  }

  if (r.maxBillCents !== undefined) {
    if (doc.totalCents === null) {
      add("bill_amount", "Bill amount", "unknown", `Bills up to ${usd(r.maxBillCents)}.`, "What is the total amount due on the bill?");
    } else if (doc.totalCents <= r.maxBillCents) {
      add("bill_amount", "Bill amount", "met", `The bill is ${usd(doc.totalCents)}, within the ${usd(r.maxBillCents)} limit.`);
    } else {
      add("bill_amount", "Bill amount", "not_met", `The bill is ${usd(doc.totalCents)}, over the ${usd(r.maxBillCents)} limit.`);
    }
  }

  if (r.income) {
    const size = patient.householdSize;
    const income = patient.annualIncomeCents;
    if (size === undefined || income === undefined || !Number.isInteger(size) || size < 1 || !Number.isInteger(income) || income < 0) {
      const limit1 = incomeLimitCents(r.income, 1);
      add(
        "income",
        "Household income",
        "unknown",
        `Income limit is ${usd(limit1)} a year for one person, plus ${usd(r.income.perExtraMemberCents)} for each extra household member.`,
        "How many people live in your household, and about what is your yearly household income?",
      );
    } else {
      const limit = incomeLimitCents(r.income, size);
      const people = `${size} ${size === 1 ? "person" : "people"}`;
      add(
        "income",
        "Household income",
        income <= limit ? "met" : "not_met",
        income <= limit
          ? `Yearly income of ${usd(income)} is within the ${usd(limit)} limit for ${people}.`
          : `Yearly income of ${usd(income)} is over the ${usd(limit)} limit for ${people}.`,
      );
    }
  }

  if (r.requiresUninsured) {
    if (patient.insured === undefined) {
      add("insurance", "No health insurance", "unknown", "For people without health insurance.", "Do you currently have health insurance?");
    } else {
      add(
        "insurance",
        "No health insurance",
        patient.insured ? "not_met" : "met",
        patient.insured ? "This program is only for people without health insurance." : "You said you don't have health insurance.",
      );
    }
  }

  if (r.maxBillAgeDays !== undefined) {
    const t = doc.date ? Date.parse(`${doc.date}T00:00:00Z`) : NaN;
    if (Number.isNaN(t)) {
      add("bill_date", "Recent bill", "unknown", `Bills from the last ${r.maxBillAgeDays} days.`, "What is the date on the bill?");
    } else {
      const age = Math.floor((today.getTime() - t) / DAY_MS);
      if (age < -1) {
        add("bill_date", "Recent bill", "unknown", "The bill date is in the future. Please check it.", "What is the date on the bill?");
      } else {
        add(
          "bill_date",
          "Recent bill",
          age <= r.maxBillAgeDays ? "met" : "not_met",
          age <= r.maxBillAgeDays
            ? `The bill is ${Math.max(age, 0)} days old, within ${r.maxBillAgeDays} days.`
            : `The bill is ${age} days old, older than ${r.maxBillAgeDays} days.`,
        );
      }
    }
  }
  return out;
}

export function matchProgram(
  program: AssistanceProgram,
  doc: ConfirmedFields,
  patient: PatientInfo = {},
  today: Date = new Date(),
): ProgramMatch {
  const cs = checks(program, doc, patient, today);
  const criteria = cs.map((c) => c.result);
  const fit = criteria.some((c) => c.status === "not_met")
    ? "unlikely"
    : criteria.some((c) => c.status === "unknown")
      ? "needs_info"
      : "possible";
  const missingInfo = [...new Set(cs.map((c) => c.question).filter((q): q is string => !!q))];
  const maxCents = doc.totalCents === null ? null : Math.min(doc.totalCents, program.capCents);
  return {
    programId: program.id,
    name: program.name,
    fictional: program.fictional,
    fit,
    possibleFit: fit !== "unlikely",
    reasons: criteria.map((c) => c.detail),
    criteria,
    missingInfo,
    maxCents,
    note: MATCH_NOTE,
  };
}

const ORDER = { possible: 0, needs_info: 1, unlikely: 2 } as const;

/** Match confirmed fields against the catalog, best fits first. */
export function matchPrograms(
  doc: ConfirmedFields,
  patient: PatientInfo = {},
  opts: { today?: Date; catalog?: AssistanceProgram[] } = {},
): ProgramMatch[] {
  const today = opts.today ?? new Date();
  return (opts.catalog ?? CATALOG)
    .map((p) => matchProgram(p, doc, patient, today))
    .sort((a, b) => ORDER[a.fit] - ORDER[b.fit] || (b.maxCents ?? 0) - (a.maxCents ?? 0));
}
