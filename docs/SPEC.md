# TrumpCare (working name)
## Hackathon product and engineering specification
**Status:** MVP, revision 6 • **Event:** HackUMass XIV (hacking Fri Nov 13, 8:30 PM → final submission Sun Nov 15, 9:00 AM) • **Base URL:** https://abdulcare.vercel.app (custom domain later)

> Tap your card. Watch your bill shrink. A person approves the rest.

**Revision 6 changes (Nov 14, from [proposal 001](proposals/001-trumpcare-coordinator.md), accepted by Omar; details settled by Musa):**
- **The product is now a bill-reduction pipeline.** A hospital visit's bill runs through insurance, then every hospital assistance policy (the AI applies; the hospital's approval is simulated and labeled), then the community care fund. What's left after the fund is $0 or a small balance the patient owes (§1, §3).
- **Funding is treated as solved** for the hackathon: hospitals fund the community care fund (it counts toward their nonprofit community benefit), with government programs and donations (§2).
- **The fund is a priority queue, not an eligibility gate.** Everyone is eligible. A fixed, published formula (`need-v1`) only sets the order. **Gemini no longer ranks the queue** (§7).
- **Gemini writes a decision brief** for every fund request: the bill's path, why it sits where it does, flags, and a suggested action that defaults to **approving the full remaining balance**. It never changes a score, an order or an amount on its own (§7).
- **Two frontends:** the **patient app** (CareCard check-in on a phone or kiosk) and the **admin panel** (the final reviewer, plus a simulated hospital-intake tab) (§4).
- **Approval pays the hospital directly.** The provider redemption tap is gone: the final reviewer's approval triggers the Nessie payout to the hospital and the Solana receipt, and the patient's bill drops to the remaining amount (§8).
- **Bills come from the hospital visit**, logged by hospital staff, not from Nessie. Nessie now pays hospitals, takes donations, and supplies the income-from-deposits check (§8).
- **Gemini runs live** on Omar's approved Vertex AI key. Every Gemini step keeps a rule or template fallback (§7).
- **Insurance** is a made-up plan per demo patient, applied with deterministic math (§7).

**Revision 5 changes (Nov 14, decided by Omar):**
- **No questionnaire.** Need information lives in the patient's profile, set at enrollment when they get their CareCard (seeded for the demo). Patients answer nothing during a request.
- **Gemini ranks the queue** (replaced in revision 6 by formula order).
- **Governance:** a caseworker decides each case in private; the community sets the fund's rules in public; grants above $500 need a second approval; anyone can audit the money.
- **Funding:** direct donations (card via Nessie, or devnet SOL) are built.
- **Money vs. proof:** dollars move through Nessie; Solana is the public record of every donation and payout.

**Revision 4 changes (Nov 14):** paper-bill scanning removed; need-based priority queue added; program matching and the application draft dropped (program matching returns in revision 6 as hospital policies).

**Revision 3 changes (Nov 14):** Tiger Data replaces MongoDB; one Next.js app on Vercel with lane packages; Nessie payout mechanics confirmed; prize priorities set.

**Revision 2 changes (Nov 14):** NFC CareCards on a phone kiosk replace the Raspberry Pi; Capital One Nessie and Solana devnet added; four lanes.

## 1. Product
TrumpCare runs a hospital bill through every source of help, in order, and shows the patient one bill that shrinks at each step.

1. **Visit logged.** At the hospital, staff tap the patient's **CareCard** on a hospital terminal and log the visit and its charges. The bill is **hospital-attested**.
2. **Insurance.** The patient's plan on file pays its share (deductible, coinsurance, out-of-pocket maximum).
3. **Hospital assistance.** The AI checks the patient against **every** assistance policy the hospital offers and applies to each one that fits. The hospital approves (simulated in the demo, always labeled) and the reductions come off the bill in order.
4. **Community care fund.** The patient taps their card on the kiosk, sees what's left, and asks the fund for help. The request joins a queue ordered by a fixed, published need formula. Everyone is eligible; the formula only decides who is seen first.
5. **Decision brief.** Gemini turns the case into a short brief for the reviewer, suggesting approval of the full remaining balance.
6. **Final review.** A person in the **admin panel** approves or denies. Approval pays the hospital from the fund's Nessie account, records a privacy-safe Solana receipt, and the patient's bill goes to $0.

The central demo is one journey: **tap at hospital → visit logged → insurance → hospital assistance → patient requests help → brief → admin approves → bill $0 → public receipt**.

The project is inspired by advocacy for Medicare for All: care for everyone, with no one turned away. It is an independent hackathon prototype with no affiliation or endorsement.

## 2. Problem and users
A hospital bill passes through insurance, hospital financial assistance and charity in separate processes, each with its own forms. Patients give up partway, or never learn what they qualify for. TrumpCare runs every step for them, and the only thing the patient needs is a card.

| User | Needs |
| --- | --- |
| Patient | See what they owe and why, ask for help once, and watch the bill shrink to what they can afford |
| Hospital staff | Log a visit and its charges against the patient's case during the visit, so the patient never has to come back with paperwork |
| Hospital (as policy owner) | Its assistance policies applied correctly and consistently; its approvals recorded |
| Final reviewer (admin) | A ranked queue, a clear brief per request, and one-click approve or deny |
| Donor and public | Verify contributions and payouts on a public ledger without seeing any patient information |

**Who decides.**
- **Insurance:** the insurer's plan rules (simulated, deterministic).
- **Hospital assistance:** the hospital approves each policy application (simulated in the demo by the policy's rules, always labeled "hospital decision (simulated)").
- **Community care fund:** a human final reviewer approves or denies every grant. The formula orders the queue and the AI writes the brief; neither decides.
- **Two approvals for large grants (P1):** a grant above $500 needs a second reviewer. The demo patient's remaining balance stays under $500, so one reviewer completes the demo.
- **Public audit:** the dashboard and the Solana ledger show every dollar in and out, with no names.

**Where the money comes from (treated as solved for the hackathon).**
- **Hospitals** fund the community care fund. Nonprofit hospitals must provide financial assistance and community benefit to keep their tax exemption, and routing part of that through the fund gives them an auditable record of every dollar.
- **Government programs** (for example, state uncompensated-care pools such as Massachusetts' Health Safety Net) fund it and audit it.
- **Donations** by card (Nessie deposit) or devnet SOL (built).

**MVP scenario (fictional; exact numbers come from the seed):** Jordan has a $4,800 emergency visit. Their plan's $1,500 deductible and 20% coinsurance leave them $2,160 after insurance. Their income is under 200% of the poverty guideline, so the hospital's charity-care policy takes 80% off ($1,728, hospital decision simulated). The remaining $432 goes to the fund. The brief suggests approving $432, the reviewer approves, Nessie pays the hospital, and Jordan's bill shows $0. Three or four other fictional requests sit in the queue, including one tampered request.

## 3. MVP requirements
| Priority | Requirement | Completion criterion |
| --- | --- | --- |
| P0 | Card check-in | Tapping a CareCard on a paired patient kiosk opens the correct fictional patient session. Tapping it on a paired hospital terminal selects the patient for intake. An unknown card shows an enrollment/help state. An unpaired phone shows "Tap at a participating kiosk" and no data |
| P0 | Patient profile | Each enrolled patient has household size, monthly household income and insurance status (each nullable), set at enrollment and seeded for the demo. Income is cross-checked against 90 days of Nessie deposits. The patient answers nothing during a request |
| P0 | Insurance plan | Each demo patient has a made-up plan: payer name (fictional), deductible, deductible met so far, coinsurance percent, out-of-pocket maximum |
| P0 | Visit intake | Hospital staff (admin panel, hospital-intake tab, paired hospital device) log a visit for the tapped patient: hospital, date, category, itemized charges (from a seeded visit template). The charge is marked hospital-attested |
| P0 | Insurance step | On intake, deterministic adjudication computes the insurer's share and the patient's responsibility, and posts an insurance adjustment to the bill |
| P0 | Hospital assistance step | The AI evaluates every policy in the hospital's catalog against the profile, prepares an application for each that fits, and records it. Each policy's rules produce a simulated hospital decision (approved amount or denied, with the reason). Approved reductions post to the bill in a fixed order, never double-counted |
| P0 | Bill ledger | One bill per visit with an ordered list of events: charge, insurance adjustment, hospital assistance (one per policy), fund grant, patient payment. Each carries its source, status (pending/confirmed) and a simulated flag. The remaining balance counts confirmed events only |
| P0 | Explanation | Gemini explains the bill and each step in plain language for the patient, using only the case data, with a template fallback |
| P0 | Fund request | From the patient app, the patient requests help with the remaining balance, with an optional short hardship note. No eligibility cut-off |
| P0 | Need assessment | Every pending request gets deterministic factor values and a 0–100 formula score (§7) |
| P0 | Ranked queue | The admin panel lists pending requests in formula order (score, then longest wait, then earliest), with the fund's available budget |
| P0 | Decision brief | Every pending request has a brief (§7): the bill's path, reasons tied to the factor values, flags, and a suggested action of approving the full remaining balance. Every number is checked; a template is the fallback |
| P0 | Final review | An authenticated reviewer approves (whole dollars, default = the suggested amount, editable) or denies. Approval cannot exceed the available budget or the remaining balance |
| P0 | Payout on approval | Approval triggers exactly one Nessie payment from the fund to the hospital and one Solana receipt; the bill's remaining balance updates |
| P0 | Duplicate prevention | Repeated clicks, refreshes and retries never pay a grant twice on either rail, and never post the same insurance or policy reduction twice |
| P0 | Injection flag | Instructions hidden in visit text, policy text or the hardship note are flagged and change nothing |
| P1 | Fund dashboard and donations | Public page: totals, available/reserved, the fund's rules, donate by card or devnet SOL, the Solana ledger |
| P1 | Second approval | A grant above $500 needs a second reviewer |
| P1 | Budget reach | The queue marks how far the available budget reaches |

The need score is a triage aid for the reviewer, not an eligibility decision. Everyone can receive help; the score only orders the queue. All patients, plans, policies, incomes and visits are fictional.

## 4. Screens
Two frontends in one app. The device's pairing role decides which one it shows.

**Patient app** (phone or kiosk, mobile-first):
1. **Welcome:** "Tap your CareCard" and a clear prototype label.
2. **My bill:** the bill shrinking step by step: charged → insurance → each hospital assistance policy (approved, denied, or pending, each labeled simulated where it is) → remaining. Explanation with **Read aloud**.
3. **Request help:** what's left, what the community care fund is, an optional short hardship note, and "Request help".
4. **Status:** waiting for review → approved and paid (the bill shows **$0** with the Solana receipt link) or denied (with next steps).
5. **Unpaired phone:** "Tap at a participating kiosk", with no data.

**Admin panel** (laptop, signed in by pairing the browser as a reviewer device with the staff PIN):
6. **Queue:** pending fund requests in formula order, with the available budget at the top. Each row shows rank, need score, remaining balance, income as a percentage of the poverty guideline, the top two factors, days waiting, and a warning badge for suspicious content.
7. **Case:** the decision brief at the top, then the bill ledger, the factor breakdown, the profile, the insurance plan, each policy application and decision, and the hardship note (as untrusted text). Approve (suggested amount prefilled, editable) or deny.
8. **Hospital intake** (simulated hospital staff): tap the patient's CareCard on this device (or pick the demo patient), choose a visit template, and log it. Shows the insurance and hospital-assistance steps running.

**Public:** 9. **Fund dashboard** (P1): totals, rules, donate, Solana ledger, no patient data. 10. **Device setup** (`/pair`, staff only).

Use large text, clear status labels, keyboard support, and status messages that never rely on color alone; no emoji. End idle kiosk sessions and clear the visible patient information.

## 5. Architecture and stack
| Layer | Implementation |
| --- | --- |
| App | One Next.js (App Router) + TypeScript app in `apps/web`: the patient app, the admin panel, the public pages, and the API as route handlers under `apps/web/app/api/` |
| Server logic | Plain TypeScript workspace packages, one per lane: `packages/core` (api), `packages/ai`, `packages/payments`, `packages/contracts`. Route handlers stay thin |
| AI | Gemini (Omar's Vertex AI key, approved for all agents) for explanations, policy application text, and the decision brief, called only from server code. Policy eligibility, insurance math and the need formula are deterministic TypeScript |
| Database | Tiger Data (managed Postgres with TimescaleDB): patients, cards, devices, insurance plans, visits, bill events, policies, policy applications, grants, need assessments, decision briefs, payment attempts; fund ledger hypertable with a continuous aggregate |
| Banking | Capital One Nessie: fund account, hospital merchants, payouts on approval, card donations, patient deposits for the income check |
| Blockchain | Solana devnet: payout and donation receipts with opaque memos |
| Check-in | NFC CareCards holding a URL with an opaque token |
| Hosting | Vercel |

**Data flow:** hospital terminal tap → `/t/<token>` on a paired hospital device → intake → visit and charges → insurance adjudication → policy evaluation and simulated hospital decisions → bill ledger. Patient kiosk tap → `/t/<token>` → my bill → request help → need assessment → queue → decision brief → reviewer approval → Nessie payout to the hospital → Solana receipt → bill shows the remaining balance.

Serverless notes and "why one app" and "why Tiger Data" from revision 5 still hold: money state is enforced in Postgres (transactions, row locks, unique idempotency keys), and there are no background workers; status is reconciled on read.

## 6. Physical build: CareCards and the kiosk
Unchanged from revision 5: NTAG213/215 stickers in 3D-printed card shells, a 3D-printed kiosk stand, URLs written with NFC Tools and locked, a QR fallback printed on each card, never write to student IDs, plastic shells only. One card per fictional patient plus a spare. The same card is tapped at the hospital terminal (intake) and at the patient kiosk.

## 7. Business rules and AI behavior

**1. Insurance (deterministic, `core`).** From the patient's plan and the visit's charges: the patient pays the remaining deductible, then coinsurance on the rest, capped by the out-of-pocket maximum; the insurer pays the remainder. One insurance-adjustment event per visit. Uninsured patients get no insurance event.

**2. Hospital assistance policies (rules in `ai`, records in `core`).** Each hospital has a catalog of fictional, labeled policies with hand-written structured rules, a source and a review date. Example set: **charity care** (sliding discount by income as a percentage of the poverty guideline), **uninsured/self-pay discount**, and a **catastrophic cap** (patient responsibility capped at a share of annual income).
- Policies apply in a fixed, documented order. Each one acts on the balance left by the previous ones, so nothing is double-counted.
- For each policy, the rules return eligible or not, the reasons per criterion, any missing information, and the reduction amount. The AI prepares the application text from the profile (Gemini may rewrite it, but checks stop it adding amounts, fields or claims; the template is the fallback).
- The hospital's approval is **simulated** by the same rules and always labeled "hospital decision (simulated)". An application is never shown as really submitted.

**3. Need score (deterministic, `ai`, formula `need-v1`, unchanged from revision 5).** Factors: income as % of the poverty guideline (30), cost burden (25), insurance status (15), cost of care (10, log scale; now the remaining balance), urgency from the visit category (10), wait time (10), prior support (−10). Unknown factors score the midpoint and are marked unknown. Only these structured fields count. Never use or infer name, age, sex, race, ethnicity, religion, nationality, immigration status, disability, or diagnosis; free text is never scored. **There is no eligibility cut-off:** the queue order is score, then longest wait, then earliest request.

**4. Decision brief (Gemini, `ai`).** For each pending fund request:
- **Bill's path:** charged → after insurance → after each hospital policy → remaining.
- **Why it sits where it does:** two or three sentences built only from the factor values.
- **Flags:** suspicious content, an income mismatch with deposits, unknown factors.
- **Suggested action:** approve the **full remaining balance**, and note when it needs a second approval.

Every number in the brief must match the case data, or the template brief is shown. The brief never changes the score, the order, or the amount; the reviewer edits the amount and decides.

**5. Patient explanation (Gemini, `ai`).** Plain language for each step of the bill, using only the case data; no diagnoses, coverage claims or invented charges. Template fallback.

**Untrusted input and the injection flag.** Visit descriptions, policy text and the hardship note are untrusted. Nothing in them can change a score, an order, an amount, a recipient or a decision. Gemini sees only what each job needs (no other patients' data, no treasury, no recipients). Text that looks like instructions aimed at the system sets `suspiciousContent` with the excerpt; the admin queue shows a warning badge and nothing else changes. Seed one tampered visit to show this.

**Gemini availability.** Gemini runs live (Omar's key). A timeout, an error, a failed schema check or a failed number check always falls back to the rules or the template, so the demo never stalls.

## 8. Payment model and state
All amounts are integer cents; Nessie settles whole dollars, so fund approvals are whole dollars.

**Bill events:** `charge` → `insurance_adjustment` → `hospital_assistance` (one per approved policy) → `fund_grant` → optional `patient_payment`. Each carries a source (hospital, insurer, policy ID, fund, patient), a status (pending/confirmed), and a simulated flag. Remaining balance = charges − confirmed reductions and payments, never below $0. Unique constraints stop the same insurance or policy event posting twice.

**Fund grant states:** `pending_review → approved/rejected → payment_pending → paid`. Approval reserves budget, then the server claims the grant and starts the payout in the same request; the reviewer sees payment pending, then paid. `paid` requires a confirmed Nessie payout, which posts the `fund_grant` bill event as confirmed.

**Nessie payout:** `POST /accounts/{fundAccountId}/purchases` to the hospital's merchant ID for the approved amount, recorded with an idempotency key per grant before the call; read back to confirm. **Solana receipt:** fixed devnet lamports with an opaque memo, its own status (`receipt_pending → receipt_confirmed`), never blocking or repeating the payout. All revision 5 rules still hold: atomic claim, the amount and recipient come from server records only, never start a replacement while a result is uncertain, reconcile on read.

**Donations (P1):** unchanged (card = Nessie deposit; devnet SOL verified by signature).

A tap alone never authorizes a payment: only an authenticated reviewer's approval does.

## 9. Data and API contract
New or changed records (schema in `packages/core`, shapes in `packages/contracts`):
- **InsurancePlan:** patient, payer name (fictional), deductible cents, deductible met cents, coinsurance percent, out-of-pocket max cents, out-of-pocket met cents.
- **Hospital:** the existing Provider record (name, Nessie merchant ID, allowlisted devnet wallet).
- **Visit:** patient, hospital, date, category, line items (description, cents), attested-by device, created at.
- **BillEvent:** visit, type, amount cents, source, status, simulated flag, reference (policy application, grant or payment), created at.
- **HospitalPolicy:** hospital, name, kind, rules (JSON), apply order, source, review date, fictional flag.
- **PolicyApplication:** visit, policy, eligibility result with per-criterion reasons, application text and its source (Gemini or template), status (`prepared → submitted_simulated → approved_simulated / denied_simulated`), reduction cents.
- **Grant:** now linked to the visit (not a Nessie document), recipient = the visit's hospital, requested = the remaining balance.
- **DecisionBrief:** grant, path summary, reasons, flags, suggested action and cents, source (Gemini or template), checked flag, computed at.
- **Device role:** `kiosk` (patient app), `hospital` (intake; replaces `provider`), `reviewer` (admin panel).
- Need assessment, payment attempts and fund events: as in revision 5.

Routes (under `apps/web/app/api/`; the api lane owns the exact shapes):

| Route | Purpose |
| --- | --- |
| POST /api/tap | Card tap on a paired device: patient session (kiosk) or intake selection (hospital) |
| POST /api/devices/pair, GET /api/devices/me | Pair a kiosk, hospital or reviewer device with the staff PIN |
| GET /api/visit-templates | Hospital device: the seeded visit templates |
| POST /api/visits | Hospital device: log a visit for the selected patient; runs insurance and hospital assistance, returns the bill |
| GET /api/patients/me/bill | Patient session: the latest visit's bill ledger, policy results and explanation |
| POST /api/grants | Patient session: request help with the remaining balance (optional hardship note) |
| GET /api/grants (own), GET /api/grants/:id | Status, receipt and the updated bill |
| GET /api/review/queue | Reviewer: formula-ordered queue with briefs and the available budget |
| POST /api/grants/:id/decision | Reviewer: approve (whole dollars) or deny; approval starts the payout |
| GET /api/fund/summary, POST /api/fund/donations(/solana) | Public fund (P1) |

Removed: `GET /api/patients/me/bills` (Nessie bill discovery), `POST /api/documents`, `POST /api/grants/:id/redeem` and the provider redemption flow.

## 10. Privacy and boundaries
Fictional people, plans, policies, visits and money throughout. Keep visit details, names, card tokens, profiles, scores, briefs and patient-linked references off-chain and off public pages; only reviewers and hospital devices see case data. Solana memos hold only opaque references. Keep keys (Gemini/Vertex, Nessie, database, treasury) out of the browser and the repository.

Non-goals: real insurance claims, real hospital policies or approvals, medical diagnosis, real eligibility determination, autonomous approval or denial, real money, real bank connections, appeals, OCR.

## 11. Team lanes
Each agent edits only its lane's folders (AGENTS.md §2). Folders are unchanged from revision 5.

| Lane | Person | Revision 6 work | Folders |
| --- | --- | --- | --- |
| `api` | Omar (`@omaribrahim6`), integration owner | Contracts first; schema migration (insurance plans, visits, bill events, policies, policy applications, decision briefs, `hospital` device role); **insurance adjudication**; the policy step and bill ledger in core; visit templates and seed; the routes in §9; payout on approval; queue in formula order with briefs | `packages/core/`, `packages/contracts/`, `apps/web/app/api/` |
| `ai` | Noureldin (`@ibragot`) | Policy rule evaluation (pure functions), application text with checks, the decision brief with number checks and a template fallback, patient explanations, the injection flag, `need-v1` unchanged (Gemini ranking retired) | `packages/ai/` |
| `payments` | Mohamed (`@CaptainCrasi`) | Payout to the hospital merchant on approval (no provider tap), hospital merchants in the Nessie seed, donations unchanged, patient deposits for the income check | `packages/payments/` |
| `web` | Musa (`@Zintrivious`) | The patient app (my bill, request help, status) and the admin panel (queue, case with brief, hospital intake), device setup, public fund page | `apps/web/` except `apps/web/app/api/` |

**Order of work:** contracts first (api), so the ai and web lanes build against them with mocks; then the migration and seed; then the routes; integrate end to end by 8:00 PM.

## 12. Schedule (from Sat 1:00 PM)
| Clock (EST) | Deliverable |
| --- | --- |
| Sat 1:00–3:00 PM | Revision 6 contracts merged (api). Mocks for every new shape (web). Policy rules and brief templates (ai). Hospital payout path (payments) |
| Sat 3:00–8:00 PM | Migration and seed (one demo patient + 3–4 queue requests + one tampered visit); routes; patient app and admin panel against the live API; Gemini brief and explanations live with fallbacks |
| Sat 8:00 PM–12:00 AM | End-to-end runs on real phones, abuse cases (double approve, retries, unpaired devices, Gemini failure → template). **Submit the initial Devpost entry before midnight** |
| Sun 12:00–4:30 AM | Polish, accessibility, CareCards and stand; backup recording by 4:00 AM |
| Sun 4:30–9:00 AM | Feature freeze, rehearse, final submission by **9:00 AM** |

If the schedule slips, cut in this order: the public fund page and donations; the second approval; Gemini rewriting application text (keep the templates); the catastrophic-cap policy (keep charity care); the 3D-printed stand.

## 13. Acceptance checks
- A hospital-terminal tap selects the right patient; a kiosk tap opens their session; an unpaired phone shows nothing.
- Logging the demo visit posts the charge, one insurance adjustment and each approved policy reduction exactly once, in order; logging it again doesn't double-post.
- The patient's bill shows every step, labels simulated decisions, and its remaining balance counts confirmed events only.
- A fund request joins the queue in formula order; reloading doesn't reshuffle; the same inputs always give the same score; nobody is excluded.
- Every request has a brief whose numbers match the case; with Gemini off, the template brief appears.
- The brief suggests the full remaining balance; the reviewer can change it; cents and over-budget amounts are refused.
- Approving pays the hospital exactly once (Nessie ID shown) with one confirmed Solana receipt, and the patient's bill shows $0.
- Double clicks, refreshes and retries never pay twice.
- The tampered visit is flagged and changes nothing.
- No protected attribute, diagnosis or free text is a scoring input; public pages and the chain hold no patient data.
- Ending a kiosk session hides the patient.
- Read aloud works on the patient's bill.

## 14. Three-minute demo
1. **Problem, 20 s:** "One hospital bill, three separate systems to get help from, and most people give up halfway."
2. **Hospital, 35 s:** at the hospital terminal, tap Jordan's CareCard and log the visit ($4,800). Insurance and the hospital's charity care run on their own: $4,800 → $2,160 → $432. Point out the "simulated hospital decision" label.
3. **Patient, 35 s:** Jordan taps the card on the kiosk, sees the bill shrink step by step (Read aloud once), and taps "Request help" for $432. Nothing to fill in.
4. **Admin, 45 s:** on the projector, the admin panel: Jordan's place in the queue and why, the decision brief suggesting $432, the tampered request flagged and unmoved. The reviewer approves.
5. **Result, 25 s:** Jordan's kiosk shows **$0**, with the Nessie payment ID and the public Solana receipt.
6. **Close, 20 s:** "Everyone is covered; the formula only decides who's seen first, a person approves every grant, and every dollar is auditable."

**Demo setup:** the hospital terminal (phone 1), the patient kiosk (phone 2 in the stand), and the admin panel on the laptop/projector, signed in as a reviewer. Phone hotspot, not venue Wi-Fi. One command seeds the demo; one resets it between rehearsals. Backup recording by Sun 4:00 AM. If the network fails, show the honest pending state and the labeled recording.

## 15. Submission and branding
Tracks: Best Overall, Best MedTech Hack, Most Impactful AI Hack; **Best Use of Nessie** (payouts to hospitals, donations, the deposit-based income check); Best AI Security Hack (the injection flag); Best Accessibility Hack (card only, read aloud, large text); Best UI/UX; Best Pitch; Best Use of Gemini API (briefs, explanations, application text); Best Use of Solana; Best Use of Tiger Data.

Deadlines: initial submission **Sun 12:00 AM**, final **Sun 9:00 AM**, judging **12:30 PM**.

**Name: open (proposal 001, Q6).** The working name is "TrumpCare" (previously AbdulCare). Musa decides before the Devpost entry. The base URL stays the Vercel URL, so the CareCards never need rewriting.

Independent-project footer: "Independent hackathon prototype. Not affiliated with or endorsed by any political figure, hospital, insurer or government program. Demonstration uses fictional data, Capital One Nessie mock banking, and Solana devnet."

Capital One Nessie API: https://api.nessieisreal.com • Solana memo reference: https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/payments/send-payments/payment-with-memo.mdx

**Success criterion:** one reliable, understandable journey from a hospital visit to a $0 bill: insurance, hospital assistance and a human-approved fund grant, with a real (mock) payout and a public, privacy-safe receipt.
