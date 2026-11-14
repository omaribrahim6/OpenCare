// Medical-transaction classification (SPEC §3 P1, §7). Flags which Nessie purchases and
// bills look medical, with a short reason; the patient picks one. Keyword rules back up
// the model and replace it when it's unavailable or a merchant name looks like an attack.

import { createGeminiClient, S, type ModelClient } from "./gemini";
import { keywordHit } from "./keywords";
import { BASE_RULES, cleanUntrusted, detectInjection, fenceUntrusted } from "./sanitize";
import type { TransactionClassification, TransactionInput } from "./types";
import { parseModelJson } from "./validate";

export const MAX_TRANSACTIONS = 100;

const SCHEMA = S.obj({
  results: S.list(
    S.obj({
      id: S.str("The transaction id exactly as given"),
      likelyMedical: S.bool("True if this is probably a healthcare expense: pharmacy, clinic, hospital, lab, dental, vision, therapy"),
      reason: S.str("Under 15 words, e.g. 'Pharmacy purchase'. No guesses about health conditions."),
    }),
  ),
});

const PROMPT = `Classify each bank transaction below as likely medical or not.
A transaction is likely medical only if the merchant or description clearly points to a healthcare provider or pharmacy.
General stores (supermarkets, big-box stores) are not medical unless the text says pharmacy or Rx.
Never guess what condition someone has. Return one result per id.`;

function ruleClassify(t: TransactionInput): TransactionClassification {
  const hit = keywordHit(`${cleanUntrusted(t.merchant, 120)} ${cleanUntrusted(t.description ?? "", 200)}`);
  return {
    id: t.id,
    likelyMedical: hit !== null,
    reason: hit ? `Looks like a ${hit.label}` : "No sign of a healthcare provider",
    basis: "rules",
  };
}

function safeReason(input: unknown, fallback: string): string {
  const r = cleanUntrusted(input, 100);
  return r && detectInjection(r).length === 0 ? r : fallback;
}

/**
 * Classify transactions. Always returns one result per input, in input order.
 * Falls back to keyword rules if the model fails.
 */
export async function classifyTransactions(
  items: TransactionInput[],
  deps: { client?: ModelClient } = {},
): Promise<TransactionClassification[]> {
  const list = items.slice(0, MAX_TRANSACTIONS);
  if (list.length === 0) return [];

  // Suspicious merchant text never reaches the model; rules decide and the reason says why.
  const suspicious = new Set(
    list.filter((t) => detectInjection(`${t.merchant}\n${t.description ?? ""}`).length > 0).map((t) => t.id),
  );
  const forModel = list.filter((t) => !suspicious.has(t.id));
  const fromModel = new Map<string, { likelyMedical: boolean; reason: unknown }>();

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
      const parsed = parseModelJson(text) as { results?: unknown };
      const ids = new Set(forModel.map((t) => t.id));
      for (const r of Array.isArray(parsed.results) ? parsed.results : []) {
        const row = r as Record<string, unknown>;
        if (typeof row.id === "string" && ids.has(row.id) && typeof row.likelyMedical === "boolean" && !fromModel.has(row.id)) {
          fromModel.set(row.id, { likelyMedical: row.likelyMedical, reason: row.reason });
        }
      }
    } catch {
      // Model unavailable or bad reply: rules handle everything below.
    }
  }

  return list.map((t) => {
    // Attacker-written text must not promote its own transaction, so suspicious rows are never flagged.
    if (suspicious.has(t.id)) {
      return { id: t.id, likelyMedical: false, reason: "Unusual merchant text, check this one by hand", basis: "rules" };
    }
    const m = fromModel.get(t.id);
    if (!m) return ruleClassify(t);
    return {
      id: t.id,
      likelyMedical: m.likelyMedical,
      reason: safeReason(m.reason, m.likelyMedical ? "Looks like a healthcare expense" : "No sign of a healthcare provider"),
      basis: "ai",
    };
  });
}
