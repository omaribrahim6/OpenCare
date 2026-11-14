# ai lane: `apps/api/src/ai/`

This module turns a bill image or a Nessie item into checked fields, a plain-language explanation and matching assistance programs (SPEC §3, §7, §11).

- It has no dependencies: Gemini is called over REST with `fetch`.
- It runs on the server only. `GEMINI_API_KEY` must never reach the browser.
- Import only from `index.ts`. Relative imports have no file extension, so the folder can be moved with a plain `git mv`.

## API

| Function | Use it in | Input → output | Calls Gemini? |
| --- | --- | --- | --- |
| `extractFromImage({ data, mimeType })` | `POST /documents` (scan) | Image → `ExtractionResult` | Yes |
| `extractFromNessieItem(txn)` | `POST /documents` (Nessie item) | `TransactionInput` → `ExtractionResult` | No |
| `classifyTransactions(txns)` | `GET /patients/:id/bills` | `TransactionInput[]` → `TransactionClassification[]`, same order | Yes, with keyword fallback |
| `explainDocument(confirmed, { supportingText })` | after `PATCH /documents/:id/review` | `ConfirmedFields` → `Explanation` | Yes, with template fallback |
| `matchPrograms(confirmed, patientInfo)` | explanation/options screen, reviewer console | → `ProgramMatch[]`, best fit first | No (rules) |
| `CATALOG` | reviewer console | the fictional programs and their rules | No |

The shapes are defined in `types.ts`. All money is integer cents, and unknown values are `null`.

## Failure behavior

- Model problems never throw. If Gemini is down, the key is missing, or the model sends bad JSON twice:
  - extraction returns `readable: false` with a warning, so the screen shows manual entry or a retake option;
  - classification falls back to keyword rules (`basis: "rules"`);
  - the explanation uses a template built from the confirmed fields (`fallback: true`).
- `extractFromImage` throws `InvalidImageError` when the image type or size is wrong. Map it to HTTP 400.

## Safety rules enforced here

- Document and transaction text reaches the model only inside a randomly tagged `<untrusted_…>` block. The system rules tell the model to ignore any instructions in that text.
- Our code turns printed amounts into cents; the model never does the math. A total whose evidence doesn't include that amount is dropped.
- Keys the schema doesn't define (recipient, approval, payout) are dropped. Nothing in this module can choose a recipient, approve a grant or start a payment.
- When text looks like an instruction to the system, a warning is added for human review. Merchant names that look like that are never sent to the model and are never flagged as medical.
- Before an explanation is shown, it is checked for:
  - dollar amounts other than the confirmed total;
  - diagnosis or treatment language;
  - claims about coverage, eligibility or guarantees.
- Program matching uses rules and never calls the model. Every program is labeled fictional, and every match carries a "not a guarantee" note.

## Commands

```sh
npx tsx --test apps/api/src/ai/__tests__/*.test.ts                # unit tests use a fake model, so they need no key
GEMINI_API_KEY=... npx tsx apps/api/src/ai/smoke.ts bill.jpg     # live check against Gemini
```

`GEMINI_MODEL` overrides the default model (`gemini-2.5-flash`).
