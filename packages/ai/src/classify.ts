// Transaction classification (SPEC §7 job 1). For each Nessie bill and purchase: likely
// medical or not, an expense category, and a short reason. Keyword rules back up the model
// and replace it when it's unavailable or when the bank text looks like an attack.

import { EXPENSE_CATEGORIES, type ExpenseCategory, type TransactionClassification, type TransactionInput } from "@abdulcare/contracts";
import { createGeminiClient, S, type ModelClient } from "./gemini";
import { asRecord, parseModelJson } from "./json";
import { keywordHit } from "./keywords";
import { BASE_RULES, cleanUntrusted, detectInjection, fenceUntrusted, firstInjectionMatch } from "./sanitize";

export const MAX_TRANSACTIONS = 100;

const SCHEMA = S.obj({
  results: S.list(
    S.obj({
      id: S.str("The transaction id exactly as given"),
      likelyMedical: S.bool("True if this is probably a healthcare expense"),
      category: S.enumOf(EXPENSE_CATEGORIES, "Expense category when likelyMedical is true, otherwise null"),
      reason: S.str("Under 15 words, e.g. 'Pharmacy purchase'. No guesses about health conditions."),
    }),
  ),
});

const PROMPT = `Classify each bank transaction below.
- likelyMedical is true only if the merchant or description clearly points to a healthcare provider or pharmacy. Supermarkets and big-box stores are not medical unless the text says pharmacy or Rx.
- category (only when medical): pharmacy, emergency (ER, urgent care, ambulance), hospital, primary_care (doctor's office, clinic), dental_vision, other_medical (labs, imaging, therapy, anything else).
- Never guess what condition someone has. Return one result per id.`;

function textOf(t: TransactionInput): string {
  return `${cleanUntrusted(t.merchant, 120)} ${cleanUntrusted(t.description ?? "", 200)}`;
}

function byRules(t: TransactionInput): TransactionClassification {
  const hit = keywordHit(textOf(t));
  return hit
    ? { id: t.id, likelyMedical: true, category: hit.category, reason: `Looks like a ${hit.label}`, basis: "rules" }
    : { id: t.id, likelyMedical: false, category: null, reason: "No sign of a healthcare provider", basis: "rules" };
}

/** Each field cut at its first injection-like text, so only what precedes it is classified. */
function textBeforeInjection(t: TransactionInput): string {
  return [t.merchant, t.description ?? ""]
    .map((raw) => {
      const clean = cleanUntrusted(raw, 200);
      const match = firstInjectionMatch(clean);
      return match ? clean.slice(0, match[0]) : clean;
    })
    .join(" ");
}

/**
 * Suspicious rows never reach the model. They are classified by the keyword rules on the text
 * before the injected part, so the injection changes nothing (SPEC §7): the tampered demo bill
 * from "Valley Urgent Care" stays an emergency expense and carries core's warning badge.
 */
function bySuspiciousRules(t: TransactionInput): TransactionClassification {
  const hit = keywordHit(textBeforeInjection(t));
  return hit
    ? { id: t.id, likelyMedical: true, category: hit.category, reason: `Looks like a ${hit.label}; unusual text in the record was ignored`, basis: "rules" }
    : { id: t.id, likelyMedical: false, category: null, reason: "Unusual text in the record, check this one by hand", basis: "rules" };
}

function safeReason(input: unknown, fallback: string): string {
  const r = cleanUntrusted(input, 100);
  return r && detectInjection(r).length === 0 ? r : fallback;
}

/** One result per input, in input order. Never throws for model problems. */
export async function classifyTransactions(
  items: TransactionInput[],
  deps: { client?: ModelClient } = {},
): Promise<TransactionClassification[]> {
  const list = items.slice(0, MAX_TRANSACTIONS);
  if (list.length === 0) return [];

  // Suspicious merchant text never reaches the model.
  const suspicious = new Set(list.filter((t) => detectInjection(textOf(t)).length > 0).map((t) => t.id));
  const forModel = list.filter((t) => !suspicious.has(t.id));
  const fromModel = new Map<string, Record<string, unknown>>();

  if (forModel.length > 0) {
    try {
      const client = deps.client ?? createGeminiClient();
      const rows = forModel
        .map((t) => JSON.stringify({ id: t.id, kind: t.kind, merchant: cleanUntrusted(t.merchant, 120), description: cleanUntrusted(t.description ?? "", 200) }))
        .join("\n");
      const text = await client.generateJson({
        system: BASE_RULES,
        parts: [{ text: `${PROMPT}\n\n${fenceUntrusted("bank_transactions", rows)}` }],
        schema: SCHEMA,
      });
      const results = asRecord(parseModelJson(text)).results;
      const ids = new Set(forModel.map((t) => t.id));
      for (const r of Array.isArray(results) ? results : []) {
        const row = asRecord(r);
        if (typeof row.id === "string" && ids.has(row.id) && typeof row.likelyMedical === "boolean" && !fromModel.has(row.id)) {
          fromModel.set(row.id, row);
        }
      }
    } catch {
      // Model unavailable or bad reply: rules handle everything below.
    }
  }

  return list.map((t): TransactionClassification => {
    if (suspicious.has(t.id)) return bySuspiciousRules(t);
    const m = fromModel.get(t.id);
    if (!m) return byRules(t);
    if (m.likelyMedical !== true) {
      return { id: t.id, likelyMedical: false, category: null, reason: safeReason(m.reason, "No sign of a healthcare provider"), basis: "ai" };
    }
    const category = (EXPENSE_CATEGORIES as readonly unknown[]).includes(m.category)
      ? (m.category as ExpenseCategory)
      : (keywordHit(textOf(t))?.category ?? "other_medical");
    return { id: t.id, likelyMedical: true, category, reason: safeReason(m.reason, "Looks like a healthcare expense"), basis: "ai" };
  });
}
