# @abdulcare/core

**Lane:** `api` (`@omaribrahim6`). **Server-only:** import it from route handlers and server components, never from client components.

The database layer and business rules behind the API: Tiger Data (Postgres) schema, device pairing, CareCard taps and sessions, patient need profiles and insurance plans, and the revision 6 bill pipeline: hospital visits, insurance adjudication, hospital assistance policies, the bill ledger, fund requests, need assessments, the formula-ordered reviewer queue with decision briefs, payment-attempt records, donations, and the fund summary. Money rules are enforced in SQL (row locks, conditional updates, unique and partial-unique indexes), so retries and double taps can't pay twice, post a reduction twice, or overspend the fund ([SPEC §8](../../docs/SPEC.md#8-payment-model-and-state)).

## Commands

```bash
npm test -w @abdulcare/core            # tests on embedded Postgres (PGlite), no server needed
npm run typecheck -w @abdulcare/core
npm run db:migrate -w @abdulcare/core  # applies db/migrations to DATABASE_URL (from the root .env)
npm run db:seed -w @abdulcare/core     # fictional patients and plans, Valley General Hospital with its policies and
                                       # visit templates, $500 fund; prints CareCard URLs (Jordan is the demo patient)
npm run db:demo -w @abdulcare/core     # visits and fund requests for Alex, Sam and Casey (tampered) + starting donations
npm run db:reset -w @abdulcare/core    # between rehearsals: wipe all activity, then db:demo
npm run history:seed -w @abdulcare/payments   # after a reset: the public ledger's history (payments lane)
```

`db:demo` logs each queued patient's visit at the hospital, applies the hospital's policies and files the fund request; Jordan has no visit until the presenter logs it live. It is safe to re-run. `db:reset` keeps patients, profiles, plans, cards, hospitals, policies, templates and paired devices. Neither calls Gemini.

**The demo journey (SPEC §14):** the hospital terminal logs Jordan's ER visit ($4,800 → $2,160 after insurance); Jordan taps "Apply for savings" ($432 after charity care); Jordan requests help; the reviewer approves $432, which pays the hospital through Nessie and records the devnet receipt; the bill shows $0.

`db:migrate -- --no-timescale` skips `002_timescale.sql` on plain Postgres.

## Modules

| File | What it does |
|---|---|
| `src/db.ts` | `Db` interface, node-postgres pool for Tiger Cloud (`getDb()`), transactions |
| `src/devices.ts` | `pairDevice` (staff PIN), `authenticateDevice` (cookie secret), `requireRole` |
| `src/cards.ts` | `issueCard`, `resolveTap` (kiosk: patient session; hospital or provider: intake selection), sessions |
| `src/profiles.ts` | `getPatientWithProfile`, `setPatientProfile` (need profile set at enrollment) |
| `src/insurance.ts` | `adjudicate` (deductible, coinsurance, out-of-pocket cap), `getInsurancePlan`, `setInsurancePlan` (validated) |
| `src/visits.ts` | `listVisitTemplates`, `logVisit` (charge + insurance, policies prepared; idempotent by key), `applyVisitPolicies` ("Apply for savings"), `getBill` (ledger, steps, remaining counts confirmed events only), `explainBill`, `listPatientVisitIds` |
| `src/bill-fallback.ts` | A deterministic `BillEngine` used when `@abdulcare/ai`'s isn't available, and in tests |
| `src/documents.ts` | `createNessieDocument` (the patient's chosen Nessie item, idempotent), `getOwnedDocument` |
| `src/grants.ts` | `requestHelp` (rev 6: the visit's remaining balance, paid to its hospital), `createGrant` (rev 5), `decideGrant` (atomic budget reservation; two reviewers above $500), `cancelGrant`, `claimForRedemption`, `completePayout`, `releaseClaim`, `payoutReference` |
| `src/attempts.ts` | Payment attempts for the payments lane: `createAttempt` (one live attempt per grant and rail), `updateAttempt`, `getLiveAttempt`, `recordReceiptEvent` |
| `src/need.ts` | `assessGrant` (formula via the ai lane's `NeedEngine`, injection flag once), `getReviewQueue` (rev 6: formula order, a decision brief per request), `getDecisionBrief` (cached by input hash; amount re-checked), `getCaseDetail` |
| `src/fund.ts` | `recordDonation` (idempotent per Nessie deposit or Solana signature), `setDonationReceipt`, `getFundSummary` (uses the TimescaleDB continuous aggregate when present) |
| `db/migrations/001_init.sql` | Tables and constraints (plain Postgres) |
| `db/migrations/002_timescale.sql` | `fund_events` hypertable and `fund_daily` continuous aggregate (Tiger Cloud only) |
| `db/migrations/003_need_ranking.sql` | Spec rev 5: patient profiles, Nessie-only documents, grant approvals, need assessments, queue rankings, donations |
| `db/migrations/004_bill_pipeline.sql` | Spec rev 6: hospital devices, insurance plans, visit templates, visits, hospital policies, policy applications, bill events, visit-linked grants, decision briefs |

## For the payments lane

Rev 6: approval pays the hospital in the same request. The decision route calls `redeemGrant` with the grant's own hospital and patient, so the flow below runs unchanged.

Payout flow:
1. The route handler calls `claimForRedemption`.
2. If `claimed` is true, payments runs the payout:
   1. `createAttempt` with the `nessie` rail, before calling Nessie
   2. the Nessie purchase
   3. `updateAttempt` to `confirmed` with the purchase ID
   4. `completePayout`
   5. the Solana receipt: `createAttempt` with the `solana` rail and the signed transaction, before broadcasting, using `payoutReference(grantId)` as the memo
   6. `updateAttempt` and `recordReceiptEvent` once it's confirmed
3. Call `releaseClaim` only after a Nessie attempt is conclusively `failed`.

Card donations: payments makes the Nessie deposit, then the route calls `recordDonation` with the deposit ID (safe to repeat) and, once the memo receipt is broadcast, `setDonationReceipt`.

## For the ai lane

Implement `NeedEngine` (`assessNeed`, `detectSuspicious`; `rankQueue` is retired in rev 6) and `BillEngine` (`evaluatePolicy`, `writeApplication`, `writeBrief`, `explainBill`) from `@abdulcare/contracts`, exported from `@abdulcare/ai` as `needEngine` and `billEngine`. Core gathers inputs with no names, IDs or free text, clamps every policy reduction to the balance, re-checks the brief's suggested amount (whole dollars, at most the remaining balance), caches briefs by input hash, and falls back to `bill-fallback.ts` on any failure.


Errors are `CoreError` with an `ErrorCode` from `@abdulcare/contracts`; `STATUS_FOR_CODE` maps them to HTTP statuses.
