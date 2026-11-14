# @abdulcare/payments

Payments lane (SPEC §8): Capital One Nessie mock banking and Solana devnet receipts. Server-only, so never import it from a client component.

## Setup

1. Put your Nessie key in the repo-root `.env` as `NESSIE_API_KEY=...`. Get it by logging in at the Nessie site or from the Capital One table.
2. Seed the fictional Nessie data. It creates the fund, the provider pharmacy, and Alex, Sam, Jordan and Casey, matching the need profiles in core's seed. The IDs are written to `.env`:
   ```bash
   npm run nessie:seed -w @abdulcare/payments
   npm run nessie:check -w @abdulcare/payments
   ```
3. Set up Solana devnet. This creates the treasury keypair and a demo provider wallet in `.env`:
   ```bash
   npm run solana:setup -w @abdulcare/payments
   ```
   The devnet RPC airdrop is closed, so fund the printed treasury address at https://faucet.solana.com, then re-run the script to open the provider wallet.
4. Optional live check against real Nessie and devnet, using an embedded database (each run adds a $1 payout and a $1 donation to the fund's Nessie history):
   ```bash
   npm run payments:smoke -w @abdulcare/payments
   ```
5. Copy the `NESSIE_*`, `SOLANA_RPC_URL`, `TREASURY_SECRET_KEY`, `RECEIPT_LAMPORTS` and `PROVIDER_SOLANA_WALLET` values into Vercel's environment variables.

## What's in here

| File | What it does |
| --- | --- |
| `src/nessie.ts` | `NessieClient`: customers, accounts, merchants, bills, purchases, deposits. Errors are `NessieError` (an `upstream_error` `CoreError`). `uncertain: true` means a write may have happened, so reconcile before retrying. The API key never appears in error messages |
| `src/transactions.ts` | `listPatientTransactions` (open bills and purchases as `TransactionInput[]` for the ai classifier) and `listIncomeDeposits` (90 days of deposits for the ai income estimate) |
| `src/solana.ts` | Receipts: `buildReceipt` (signed transfer plus an opaque memo, persisted before broadcast), `broadcast`, `checkSignature`, `sendReceipt`, `verifySolDonation` |
| `src/redeem.ts` | `redeemGrant` and `reconcileGrant`, plus `paymentsFromEnv(db)` to build the deps |
| `src/donations.ts` | `donateByCard`: the Nessie deposit, then core's `recordDonation` (once per deposit ID), then a memo-only receipt via `setDonationReceipt`. Also `recordSolDonation`, which verifies a devnet transfer to the treasury and records it once per signature |

## How live Nessie behaves (api.nessieisreal.com)

These were found by running against the live API, and the code handles each one:
- **Whole dollars only.** Nessie silently truncates cents ($64.20 is stored as $64). Every write here refuses non-whole-dollar amounts. Donations must be whole dollars, and `redeemGrant` refuses a grant approved with cents *before* claiming it. Caseworkers should approve whole-dollar amounts.
- **No `GET /purchases/{id}`.** It answers 403. Payouts are read back from the fund account's purchase list (`findPurchase`), matched by ID or by the idempotency key in the description.
- **Balances never change.** Deposits and purchases don't update `balance`, so the fund's real balance is core's ledger, not Nessie's balance field.
- **Any key string is accepted.** Data is scoped per key, so everyone must use the same `NESSIE_API_KEY` to see the same accounts.

## For the api lane (route handlers)

```ts
import { getDb } from "@abdulcare/core";
import { donateByCard, listPatientTransactions, paymentsFromEnv, reconcileGrant, redeemGrant } from "@abdulcare/payments";

const deps = paymentsFromEnv(getDb());

// POST /api/grants/:id/redeem (after checking the provider device and the card tap)
const { grant, payout } = await redeemGrant(deps, { grantId, providerId, patientId });
// payout === "pending" means the result is uncertain; the provider screen polls GET /api/grants/:id

// GET /api/grants/:id
const grant = await reconcileGrant(deps, grantId);

// GET /api/patients/me/bills: feed this to the ai classifier
const txns = await listPatientTransactions(deps.nessie, patient.nessieAccountId);

// POST /api/fund/donations: pass a client-generated key so a double submit deposits once.
// donateByCard records the donation itself, so the route doesn't call recordDonation.
const { donation, explorerUrl } = await donateByCard(deps, { amountCents, idempotencyKey });
```

Redemption follows the flow in `packages/core/README.md`:
1. Claim the grant.
2. Write the Nessie attempt, then make the fund's purchase to the provider's merchant. The idempotency key goes in the description.
3. Read the purchase back to confirm it.
4. Mark the patient's Nessie bill completed, then call `completePayout`.
5. Write the Solana attempt with the signed transaction, then broadcast it and wait for confirmation. On confirmation, call `recordReceiptEvent` (exactly once).

Reconciliation rules:
- An uncertain Nessie write stays `pending`. It is resolved by reading back by ID or by the idempotency key. After a 2-minute grace period with no purchase found, it counts as failed and the claim is released.
- A pending receipt is rebroadcast as the same bytes, or replaced only once its blockhash has expired.
- A receipt failure never blocks or repeats the payout.

## Tests

```bash
npm test -w @abdulcare/payments
```

The tests use a fake Nessie and embedded Postgres, so they need no network or keys.
