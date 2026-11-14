// Patient explanation (SPEC §7 job 4): the selected Nessie bill and what happens next, in plain
// language, using only the Nessie record. Output is checked: the only dollar amount allowed is
// the bill's, and diagnosis, treatment, coverage, eligibility or approval claims are rejected.
// On any failure we use a template, so the screen always shows something true.

import type { ExpenseCategory, Explanation, TransactionInput } from "@abdulcare/contracts";
import { createGeminiClient, S, type ModelClient } from "./gemini";
import { asRecord, parseModelJson, usd } from "./json";
import { BASE_RULES, cleanUntrusted, detectInjection, fenceUntrusted } from "./sanitize";

export const DISCLAIMER =
  "This explanation was written by AI from your bank record. It is not medical, legal or financial advice. A caseworker reviews every request.";

/** The selected bill: the Nessie record plus its category from classification. */
export type BillToExplain = Pick<TransactionInput, "kind" | "merchant" | "description" | "amountCents" | "date"> & {
  category: ExpenseCategory | null;
};

const CATEGORY_PHRASES: Record<ExpenseCategory, string> = {
  pharmacy: "a pharmacy charge",
  emergency: "a charge for emergency or urgent care",
  hospital: "a hospital charge",
  primary_care: "a charge from a doctor's office or clinic",
  dental_vision: "a dental or eye care charge",
  other_medical: "a medical charge",
};

/** Fixed facts about the process (SPEC §1), so "what happens next" is always accurate. */
const NEXT_STEPS = [
  "A caseworker at the community fund reviews your request. Requests are looked at in order of need.",
  "If it is approved, the fund pays the provider directly when you tap your CareCard at their counter.",
  "You can check the status of your request at the kiosk at any time.",
];

const FORBIDDEN: RegExp[] = [
  /\bdiagnos\w*/i,
  /\byou (have|may have|might have|suffer)\b/i,
  /\b(symptom|condition|disease|infection|illness)s?\b/i,
  /\b(take|taking|stop taking|keep taking)\b.{0,20}\b(medicine|medication|pills?|drugs?|tablets?)\b/i,
  /\b(dosage|doses?|treatments?|treating|treat)\b/i,
  /\b(you are|you're|you will be) (eligible|approved|covered|qualified)\b/i,
  /\b(will|should) be (approved|paid|covered)\b/i,
  /\bguarantee\w*/i,
  /\b(insurance|medicare|medicaid) (will|should) (pay|cover)\b/i,
  /\b(is|are|will be) covered\b/i,
];

export function templateExplanation(bill: BillToExplain): Explanation {
  const merchant = cleanUntrusted(bill.merchant, 80);
  const safeMerchant = merchant && detectInjection(merchant).length === 0 ? merchant : null;
  const what = bill.category ? CATEGORY_PHRASES[bill.category] : `a ${bill.kind === "bill" ? "bill" : "purchase"}`;
  const date = bill.date && /^\d{4}-\d{2}-\d{2}/.test(bill.date) ? ` on ${bill.date.slice(0, 10)}` : "";
  return {
    summary: `This is ${what}${safeMerchant ? ` from ${safeMerchant}` : ""}${date} for ${usd(bill.amountCents)}. You can ask the community fund to help pay it.`,
    points: NEXT_STEPS,
    questionsToAsk: ["Is this the final amount I owe?", "Do you offer a payment plan or a discount for paying now?"],
    disclaimer: DISCLAIMER,
    fallback: true,
  };
}

const SCHEMA = S.obj({
  summary: S.str("2 or 3 short sentences at a 6th-grade reading level"),
  questionsToAsk: S.list(S.str(), "Up to 3 short questions the patient could ask the provider about this charge"),
});

const PROMPT = `Explain this healthcare charge from the patient's bank account in plain, friendly language.
Use only the bank record below: what kind of charge it is, who it is from, the amount and the date.
Do not add charges, dates or amounts. Write the amount exactly as given.
Do not mention diagnoses, health conditions, what a medicine is for, treatment, or whether insurance or the fund will pay.
You may say they can ask the community fund for help.`;

/** Null if the text is OK, otherwise why it was rejected. */
export function checkExplanationText(text: string, amountCents: number): string | null {
  for (const re of FORBIDDEN) if (re.test(text)) return `forbidden claim: ${re.source}`;
  if (detectInjection(text).length) return "contains instruction-like text";
  for (const a of text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? []) {
    if (Math.round(Number(a.replace(/[$,\s]/g, "")) * 100) !== amountCents) return `amount ${a} is not the bill amount`;
  }
  return null;
}

export async function explainBill(bill: BillToExplain, deps: { client?: ModelClient } = {}): Promise<Explanation> {
  const fallback = templateExplanation(bill);
  const record = `${bill.merchant}\n${bill.description ?? ""}`;
  // Suspicious bank text never reaches the model.
  if (detectInjection(cleanUntrusted(record)).length) return fallback;
  try {
    const client = deps.client ?? createGeminiClient();
    const facts = JSON.stringify({
      kind: bill.kind,
      category: bill.category,
      amount: usd(bill.amountCents),
      date: bill.date ?? null,
    });
    const text = await client.generateJson({
      system: BASE_RULES,
      parts: [{ text: `${PROMPT}\n\nFacts: ${facts}\n\nMerchant and description:\n${fenceUntrusted("bank_record", record)}` }],
      schema: SCHEMA,
      temperature: 0.2,
    });
    const raw = asRecord(parseModelJson(text));
    const summary = cleanUntrusted(raw.summary, 500);
    const questions = Array.isArray(raw.questionsToAsk)
      ? raw.questionsToAsk.map((q) => cleanUntrusted(q, 160)).filter(Boolean).slice(0, 3)
      : [];
    if (!summary || checkExplanationText([summary, ...questions].join("\n"), bill.amountCents) !== null) return fallback;
    return {
      summary,
      points: NEXT_STEPS,
      questionsToAsk: questions.length ? questions : fallback.questionsToAsk,
      disclaimer: DISCLAIMER,
      fallback: false,
    };
  } catch {
    return fallback;
  }
}
