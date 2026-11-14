# @abdulcare/core

**Lane:** `api` (`@omaribrahim6`). **Server-only:** import it from route handlers and server components, never from client components.

The database layer and business rules behind the API: Tiger Data (Postgres) schema, device pairing, CareCard taps and sessions, document storage, the grant state machine, payment-attempt records, and the fund summary. Money rules are enforced in SQL (row locks, conditional updates, unique and partial-unique indexes), so retries and double taps can't pay twice or overspend the fund ([SPEC §8](../../docs/SPEC.md#8-payment-model-and-state)).

## Commands

```bash
npm test -w @abdulcare/core            # 19 tests on embedded Postgres (PGlite), no server needed
npm run typecheck -w @abdulcare/core
npm run db:migrate -w @abdulcare/core  # applies db/migrations to DATABASE_URL (from the root .env)
npm run db:seed -w @abdulcare/core     # fictional patients, pharmacy, $500 fund; prints CareCard URLs
```

`db:migrate -- --no-timescale` skips `002_timescale.sql` on plain Postgres.

## Modules

| File | What it does |
|---|---|
| `src/db.ts` | `Db` interface, node-postgres pool for Tiger Cloud (`getDb()`), transactions |
| `src/devices.ts` | `pairDevice` (staff PIN), `authenticateDevice` (cookie secret), `requireRole` |
| `src/cards.ts` | `issueCard`, `resolveTap` (session only on paired kiosk/provider devices), patient sessions |
| `src/documents.ts` | Scan and Nessie documents, `saveExtraction` (ai lane result), `confirmDocument` |
| `src/grants.ts` | `createGrant`, `decideGrant` (atomic budget reservation), `cancelGrant`, `claimForRedemption`, `completePayout`, `releaseClaim`, `payoutReference` |
| `src/attempts.ts` | Payment attempts for the payments lane: `createAttempt` (one live attempt per grant and rail), `updateAttempt`, `getLiveAttempt`, `recordReceiptEvent` |
| `src/fund.ts` | `addDonation`, `getFundSummary` (uses the TimescaleDB continuous aggregate when present) |
| `db/migrations/001_init.sql` | Tables and constraints (plain Postgres) |
| `db/migrations/002_timescale.sql` | `fund_events` hypertable and `fund_daily` continuous aggregate (Tiger Cloud only) |

## For the payments lane

Redemption flow:
1. The route handler calls `claimForRedemption`.
2. If `claimed` is true, payments runs the payout:
   1. `createAttempt` with the `nessie` rail, before calling Nessie
   2. the Nessie purchase
   3. `updateAttempt` to `confirmed` with the purchase ID
   4. `completePayout`
   5. the Solana receipt: `createAttempt` with the `solana` rail and the signed transaction, before broadcasting, using `payoutReference(grantId)` as the memo
   6. `updateAttempt` and `recordReceiptEvent` once it's confirmed
3. Call `releaseClaim` only after a Nessie attempt is conclusively `failed`.

Errors are `CoreError` with an `ErrorCode` from `@abdulcare/contracts`; `STATUS_FOR_CODE` maps them to HTTP statuses.
