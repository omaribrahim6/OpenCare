# OpenCare — Care for All

> Tap your card. Understand your bill. Get help paying for care.

OpenCare is an AI-assisted healthcare access kiosk built at HackUMass XIV. A patient taps an NFC **CareCard** on a clinic kiosk. OpenCare finds or scans a medical bill and explains it in plain language, and the patient requests help from a community care fund. Once a human reviewer approves the grant, a second tap at the provider pays the bill through Capital One's Nessie API and records a privacy-safe public receipt on Solana devnet.

**Built with:** Next.js on Vercel · TypeScript · Gemini API · Tiger Data (Postgres + TimescaleDB) · Capital One Nessie · Solana devnet · NFC (NTAG) · 3D printing

## Repository layout

| Path | Contents | Lane |
|---|---|---|
| `apps/web/` | The Next.js app: mobile-first kiosk, reviewer, provider and dashboard views | `web` |
| `apps/web/app/api/` | Thin API route handlers | `api` |
| `packages/core/` | Database schema, auth, device pairing, card tokens, grant state machine | `api` |
| `packages/ai/` | Gemini extraction, explanations, assistance matching, injection flag | `ai` |
| `packages/payments/` | Nessie payouts and seed data, Solana receipts | `payments` |
| `packages/contracts/` | Shared TypeScript types and API contracts | `api` (integration owner) |
| `docs/` | [Product spec](docs/SPEC.md) and [agent board guide](docs/agent-board.md) | — |
| `tools/` | `board` (agent message board) and `preflight` (conflict and commit checks) | — |

## Getting started

```bash
git clone https://github.com/omaribrahim6/Trumpcare.git
cd Trumpcare
cp .env.example .env    # fill in your lane's keys; never commit .env
tools/preflight         # also enables the commit-message hook
```

Each lane documents its own run commands in its folder.

## How we work

- **Lanes:** each teammate's coding agent owns one lane ([SPEC §11](docs/SPEC.md#11-team-lanes)) and coordinates with the others on the pinned board issue ([guide](docs/agent-board.md)).
- **Commits:** follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(web): add check-in screen`). A git hook enforces it.
- **Merging:** small PRs, `tools/preflight` before every push, PR, and merge, and rebase-merge only, so the full history stays visible.

Full rules: [AGENTS.md](AGENTS.md).

---

Independent hackathon prototype. Not affiliated with or endorsed by Abdul El-Sayed. Demonstration uses fictional data, Capital One Nessie mock banking, and Solana devnet.
