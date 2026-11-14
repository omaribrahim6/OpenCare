# @abdulcare/ai

This is the ai lane (SPEC §7). It covers four jobs:
- classifying Nessie transactions;
- scoring need with a fixed formula;
- ranking the review queue with Gemini;
- explaining the selected bill to the patient.

It also flags text that looks like instructions aimed at the system.

The package runs on the server only. Never import it from a client component, and never let a key or token reach the browser.

It has no runtime dependencies besides `@abdulcare/contracts`, and it calls Gemini over REST with `fetch`. Every shape it uses comes from `@abdulcare/contracts` (`packages/contracts/src/ai.ts`).

## Revision 6: `billEngine` (the bill pipeline)

`billEngine` implements `BillEngine` from `packages/contracts/src/bills.ts`. The routes pick it up from `apps/web/app/api/_lib/deps.ts`.

| Method | What it does | Gemini? |
| --- | --- | --- |
| `evaluatePolicy` (`src/bills/policy.ts`) | Pure rules for charity care (sliding scale by % of the poverty guideline), the uninsured self-pay discount and the catastrophic cap (% of yearly income). Returns criteria, missing fields and a reduction no larger than the balance. The simulated hospital decision comes from the same rules (`simulatedDecision`). `applyPolicies` runs the policies in `applyOrder` on the balance each one leaves | Never |
| `writeBrief` | Template: the path as given, 3 reasons from factor values, flags computed in code, `approve` for the full remaining balance in whole dollars, `needsSecondApproval` above $500. Gemini may reword only the reasons | Optional, 12 s |
| `explainBill` | Template: a summary plus one exact line per step, with simulated and pending labels. Gemini may reword the summary and the questions; the step lines stay from code | Optional, 10 s |
| `writeApplication` | Template: profile fields, criteria, missing info, the reduction, the policy source and a "submission and decision are simulated" footer. Gemini may rewrite it as a letter | Optional, 9 s each (intake writes one per policy in a row) |

Checks on Gemini text (`src/bills/checks.ts`); any failure returns the template:
- every number must already be in the case data;
- no approve, deny or eligible wording;
- no coverage or payment promises;
- no medical claims;
- no instruction-like text;
- the key amounts must appear.

What Gemini never sees: names, IDs, the suspicious excerpt, or flagged line items. The rest of the line-item text is fenced as untrusted.

`templateBillEngine` makes no model calls, and the tests use it. The demo path (Jordan, seeded Valley General policies): $4,800 → $2,160 after insurance (core) → $432 after charity care → the brief suggests $432.

`needEngine.rankQueue` is retired in revision 6: the queue is in formula order. The need formula `assessNeed` (need-v1) and the injection flag are unchanged.

## API (revision 5, still exported)

| Export | Used by | What it does | Calls Gemini? |
| --- | --- | --- | --- |
| `needEngine` | core's `assessGrant` and `getReviewQueue` | The `NeedEngine` from contracts, built from the three functions below | |
| `needEngine.assessNeed(input)` | core | `NeedInput` → `NeedAssessment`. Pure and deterministic | No |
| `needEngine.rankQueue(rows)` | core | `RankingRow[]` → `QueueRanking`. Gemini sets the order behind guardrails; any failure returns formula order | Yes |
| `needEngine.detectSuspicious(fields)` | core, when a grant is first assessed | → `{ field, excerpt }` or `null` | No (pattern check) |
| `estimateMonthlyIncomeCents(deposits)` | route handler, before `assessGrant` | payments' `listIncomeDeposits` result → monthly cents or `null`. Pass it as `depositIncomeCents` | No |
| `classifyTransactions(txns)` | `GET /api/patients/me/bills` | `TransactionInput[]` (from payments' `listPatientTransactions`) → `TransactionClassification[]`, in the same order | Yes, with keyword fallback |
| `explainBill(bill)` | the explain screen | `{ kind, merchant, description?, amountCents, date?, category }` → `Explanation` | Yes, with template fallback |
| `createNeedEngine({ client })` | tests | An engine that uses a fake model | |

Model problems never throw:
- ranking falls back to formula order;
- classification falls back to keyword rules (`basis: "rules"`);
- the explanation falls back to a template (`fallback: true`).

## Need formula (`src/formula.ts`, version `need-v1`)

Weights, thresholds and the poverty table live in one `FORMULA` object. If you change any of them, bump `FORMULA.version`, because core stores that version with every assessment.

| Factor | Points | Scoring |
| --- | --- | --- |
| Income | 30 | Monthly income × 12 compared with the HHS 2025 poverty guideline ($15,650 + $5,500 per extra person). Full points at or below 100%, none at or above 400%, linear between |
| Cost burden | 25 | Bill ÷ monthly income. Full points at half a month's income or more |
| Insurance | 15 | Uninsured gets full points, underinsured half, insured none |
| Cost of care | 10 | Log scale from $10 (no points) to $5,000 (full points) |
| Urgency | 10 | Share of the points by category: emergency and pharmacy 1, hospital 0.8, primary care 0.6, dental or vision 0.5, other medical 0.3 |
| Wait time | 10 | Grows linearly to full points at 30 days |
| Prior support | −10 | −5 for each grant paid in the last 90 days, at most −10 |

How the inputs are handled:
- **Unknown inputs** score the midpoint of their range and are marked `unknown`.
- **Income source:** income comes from the profile. If the profile has none, it is estimated from deposits and the factor's input says "estimated from deposits".
- **Income mismatch:** if both incomes exist and differ by more than 25%, `incomeMismatch` holds both values, and the profile value is the one scored.
- **Excluded fields:** only the fields in `NeedInput` are used. Names, demographics, diagnoses, bill text and hardship notes are never scored.

## Ranking guardrails (`src/rank.ts`)

- **What Gemini sees:** only labels A, B, C… and each row's factor values. There are no IDs, names, bill text or hardship notes.
- **Settings:** temperature 0 and a 20-second deadline. Queues of more than 60 requests skip Gemini.
- **Validity checks:** the order must contain each label exactly once. Every request needs a rationale.
- **Rationale checks:** every number in a rationale must be one of the queue's values (scores, points, bill amounts, days, income percentages, or numbers in the factor inputs). Rationales can't use decision or eligibility words such as eligible, approved, denied, guaranteed or deserving. They can't contain instruction-like text.
- **Fallback:** if any check fails, the result is formula order, with templated rationales and `source: "formula"`.
- **Core's part:** core re-checks the permutation, caches Gemini results by a hash of the inputs, and marks any request moved 2 or more places from the formula order.

## Injection flag (`src/suspicious.ts`)

This is a fixed pattern check, run on the merchant, description and hardship note after hidden Unicode is removed. It catches:
- requests to ignore the rules;
- role changes and system-prompt markup;
- approvals tied to an amount, a wallet or "immediately";
- payment destinations and wallet addresses;
- attempts to move a request in the queue or set its score.

A plain plea such as "please approve my request" isn't flagged. The flag is a warning only and never changes a score or rank. Bank records that look like attacks are never sent to the model. Instead, the keyword rules classify them using only the text before the injected part, so the seeded tampered bill ("Valley Urgent Care") stays an emergency expense.

## Commands

```sh
npm test -w @abdulcare/ai                              # unit tests use a fake model, so they need no key
npm run typecheck -w @abdulcare/ai
npm run smoke -w @abdulcare/ai                         # ONE live call per rev 6 feature, then each fallback (bills Omar's key)
```

## Model access

There are two ways in (`src/gemini.ts`). When the model can't be reached, every job uses its fallback.

| Path | Turned on by | Default model |
| --- | --- | --- |
| Gemini API | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| Vertex AI (`src/vertex.ts`) | `GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`. Takes precedence over the API key | `gemini-3-flash-preview` |

The Vertex service account is Omar's key. AGENTS.md §7 approves it for every agent, but it's still a secret: never commit or post it, and never log a key, token or credentials file. Calls are billed to Omar's card, so run live checks once rather than in loops. Tests always use fake model clients.

Other settings:
- `GEMINI_MODEL` overrides the default model on either path. An empty value means the default.
- Gemini 3 models run with a low thinking level (`GEMINI_THINKING_LEVEL`) and their default temperature, as Google advises. The bill rewrites (brief, explanation, application) only reword a template, so they ask for the `minimal` level. Set `GEMINI3_TEMPERATURE` to override. The ranking stays stable on reload because core caches each result by a hash of its inputs.
- Older models run at the caller's temperature, which is 0 for ranking.
