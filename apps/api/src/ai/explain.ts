// Plain-language explanation (SPEC §3 P0 "Explanation", §7). Grounded in the patient-
// confirmed fields only. Output is checked: any dollar amount must be the confirmed total,
// and diagnosis, treatment, coverage or eligibility claims are rejected. On any failure we
// use a template built from the confirmed fields, so the screen always has something true.

import { createGeminiClient, S, type ModelClient } from "./gemini";
import { BASE_RULES, cleanUntrusted, detectInjection, fenceUntrusted } from "./sanitize";
import type { ConfirmedFields, Explanation } from "./types";
import { moneyToCents, parseModelJson } from "./validate";

export const DISCLAIMER =
  "This explanation was written by AI from your document. It is not medical, legal or financial advice. Check anything important with the provider.";

const TYPE_PHRASES: Record<string, string> = {
  pharmacy_receipt: "a pharmacy receipt",
  prescription_receipt: "a prescription receipt",
  medical_bill: "a medical bill",
  lab_bill: "a bill for lab work",
  dental_bill: "a dental bill",
  vision_bill: "a bill for eye care",
  explanation_of_benefits: "an explanation of benefits from an insurer (usually not a bill by itself)",
  other: "a document",
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Claims the explanation must never make (SPEC §7, §10 non-goals).
const FORBIDDEN: RegExp[] = [
  /\bdiagnos\w*/i,
  /\byou (have|may have|might have|suffer)\b/i,
  /\b(symptom|condition|disease|infection|illness)s?\b/i,
  /\b(take|taking|stop taking|keep taking)\b.{0,20}\b(medicine|medication|pills?|drugs?|tablets?)\b/i,
  /\b(dosage|doses?|treatments?|treating|treat)\b/i,
  /\b(you are|you're|you will be) (eligible|approved|covered|qualified)\b/i,
  /\bguarantee\w*/i,
  /\b(insurance|medicare|medicaid) (will|should) (pay|cover)\b/i,
  /\b(is|are|will be) covered\b/i,
];

export function templateExplanation(doc: ConfirmedFields): Explanation {
  const what = doc.documentType ? TYPE_PHRASES[doc.documentType] : "a document";
  const from = doc.provider ? ` from ${doc.provider}` : "";
  const when = doc.date ? ` dated ${doc.date}` : "";
  const amount =
    doc.totalCents !== null
      ? ` It shows ${usd(doc.totalCents)} to pay${doc.currency && doc.currency !== "USD" ? ` (${doc.currency})` : ""}.`
      : " The amount to pay wasn't clear.";
  const unknown = (["provider", "documentType", "totalCents", "date"] as const).filter((k) => doc[k] === null);
  const labels = { provider: "who sent it", documentType: "what kind of document it is", totalCents: "the amount due", date: "the date" };
  return {
    summary: `This looks like ${what}${from}${when}.${amount} You can ask a community fund for help paying it.`,
    points: unknown.length ? [`Not clear from the document: ${unknown.map((k) => labels[k]).join(", ")}.`] : [],
    questionsToAsk: ["Is this the final amount I owe?", "Do you offer a payment plan or a discount for paying now?"],
    disclaimer: DISCLAIMER,
    fallback: true,
  };
}

const SCHEMA = S.obj({
  summary: S.str("2 to 4 short sentences at a 6th-grade reading level"),
  points: S.list(S.str(), "Up to 4 short bullet points: what the document is, what it asks for, what is unclear"),
  questionsToAsk: S.list(S.str(), "Up to 3 short questions the patient could ask the provider about the bill"),
});

const PROMPT = `Explain this healthcare expense to the patient in plain, friendly language.
Use only the confirmed fields and document notes below. Do not add charges, dates or amounts that are not there.
If a field is null, say it is not clear from the document.
Do not mention diagnoses, health conditions, medicines' purposes, treatment, or whether insurance or any program will pay.
You may say they can ask a community fund for help. Write amounts like $45.00.`;

/** Returns null if the text is OK, otherwise why it was rejected. */
export function checkExplanationText(text: string, doc: ConfirmedFields): string | null {
  for (const re of FORBIDDEN) if (re.test(text)) return `forbidden claim: ${re.source}`;
  if (detectInjection(text).length) return "contains instruction-like text";
  const amounts = text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  for (const a of amounts) {
    if (doc.totalCents === null || moneyToCents(a) !== doc.totalCents) return `amount ${a} is not the confirmed total`;
  }
  return null;
}

export async function explainDocument(
  doc: ConfirmedFields,
  opts: { supportingText?: string[]; client?: ModelClient } = {},
): Promise<Explanation> {
  const fallback = templateExplanation(doc);
  try {
    const client = opts.client ?? createGeminiClient();
    const facts = JSON.stringify({
      provider: doc.provider,
      documentType: doc.documentType,
      currency: doc.currency,
      amountDue: doc.totalCents === null ? null : usd(doc.totalCents),
      date: doc.date,
    });
    const notes = (opts.supportingText ?? []).slice(0, 10).join("\n");
    const text = await client.generateJson({
      system: BASE_RULES,
      parts: [{ text: `${PROMPT}\n\nConfirmed fields: ${facts}\n\nDocument notes:\n${fenceUntrusted("document_notes", notes)}` }],
      schema: SCHEMA,
      temperature: 0.2,
    });
    const raw = parseModelJson(text) as Record<string, unknown>;
    const summary = cleanUntrusted(raw.summary, 600);
    const list = (x: unknown, n: number) =>
      Array.isArray(x) ? x.map((s) => cleanUntrusted(s, 200)).filter(Boolean).slice(0, n) : [];
    const points = list(raw.points, 4);
    const questionsToAsk = list(raw.questionsToAsk, 3);
    if (!summary) return fallback;
    if (checkExplanationText([summary, ...points, ...questionsToAsk].join("\n"), doc) !== null) return fallback;
    return { summary, points, questionsToAsk: questionsToAsk.length ? questionsToAsk : fallback.questionsToAsk, disclaimer: DISCLAIMER, fallback: false };
  } catch {
    return fallback;
  }
}
