# Linked rails: Nessie holds the dollars, Solana holds the rules and the proof

Every dollar in OpenCare is a Capital One Nessie transaction on some party's account: the donor's, the hospital's, the fund's or the patient's. Solana devnet decides what the fund is allowed to pay and keeps a public record that it happened. Neither duplicates the other. Every Nessie money movement gets exactly one Solana record, and every Solana record points back to its Nessie transaction.

## The contract between the two rails

1. **Dollars live only in Nessie.** Solana holds spendable value only as crypto donations, which only ever flow in. Hospitals are always paid in dollars through Nessie.
2. **Permission is on chain.** The `opencare_fund` program records each case's decision once, within the published rules, for an attested hospital only.
3. **One record each way.** A payout's devnet receipt memo and its on-chain grant account both carry a fingerprint (SHA-256) of the Nessie purchase ID. Fund-side records show the Nessie ID; patient-side records never reach the chain.
4. **The bank stays private, the chain stays public.** Patient accounts exist only in Nessie. The chain sees only hashes, amounts, hospital wallets and opaque references.

## One grant, start to finish

1. **Visit billed** (kiosk charge): the hospital bill appears as a Nessie bill on the patient's own account (`syncNessieBill`).
2. **Insurance and hospital assistance** lower that Nessie bill. Nothing goes on chain.
3. **Fund request** joins the queue. Each day's anchor seals the queue's Merkle root (opaque reference, score, rank), so a patient can prove their place without anyone else's data (`/api/user/proof`).
4. **Caseworker approves.** The approval moves from the fund's available Nessie account to its reserved account (a Nessie transfer), and the program records it in the grant's on-chain account. That account can only be created once, so a case can never be approved twice on chain.
5. **Hospital paid** by a Nessie purchase from the reserved account to the hospital's merchant. The devnet receipt memo carries the purchase fingerprint, and `mark_paid` writes it into the grant's on-chain account.
6. **Patient side.** The patient's Nessie bill drops. They pay the rest from their checking (a Nessie purchase to the hospital) or put it on an interest-free monthly plan (a recurring Nessie bill).
7. **Afterwards.** If insurance pays late, the hospital refunds the fund by Nessie transfer, with a public memo under the case's reference.

## Where each piece lives

| Piece | Code | Route or script |
| --- | --- | --- |
| On-chain fund program (Anchor) | `packages/solana-program/programs/opencare_fund` | devnet `Gj8AgKfuH1u546FCNMhwAp32ExxNcXCuU5EtdeMBLbmn` |
| Program client (hand-encoded, no Anchor dependency) | `packages/payments/src/program.ts` | `syncGrantOnChain` after every decision |
| Nessie bills, plans, reserved account, transfers, refunds, bank check | `packages/payments/src/rails.ts` | `/api/user/bills/:id/pay`, `/plan`, `/api/grants/:id/refund`, `/api/fund/contributions`, `/api/review/grants/:id/bank` |
| Daily anchors, Merkle proofs, Nessie statements | `packages/payments/src/proofs.ts` | `/api/proof/anchor` (reviewer or Vercel cron), `/api/proof/anchors/:day` |
| Solana Pay, Blinks, Pyth SOL/USD on chain, devnet USDC | `packages/payments/src/solana-pay.ts` | `/api/solana-pay/*`, `/api/actions/donate`, `/actions.json` |
| Reconciliation across both rails | `packages/payments/src/linked.ts` | `/api/proof/reconcile` |
| Public verification page | `apps/web/app/proof` | `/proof` |

## Setup

```bash
npm run db:migrate -w @abdulcare/core          # 008_linked_rails.sql
npm run rails:seed -w @abdulcare/payments       # reserved account, hospital and donor accounts, program rules, attestations
npm run rails:smoke -w @abdulcare/payments      # live check: program sync, anchor, reconcile, Solana Pay, bank check
```

Vercel needs `OPENCARE_PROGRAM_ID`, `NESSIE_RESERVED_ACCOUNT_ID` and `CRON_SECRET` (the daily anchor cron in `apps/web/vercel.json`). Without them everything falls back to the previous behavior: payouts from the fund account, no on-chain program sync.

## What it deliberately doesn't do

- No patient data, scores tied to people, or diagnoses on chain, not even hashed with a guessable input.
- No CareCard wallets: patients never need crypto or keys.
- No credit cards or loans for patients. Medical credit is a common path into medical debt.
- The caseworker desk signs program instructions with the fund's authority key, held by the server: caseworkers have no wallets. Moving the authority to a Squads multisig and the rules to Realms governance is the next step.
