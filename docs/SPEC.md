# AbdulCare — Care for All
## Hackathon product and engineering specification
**Status:** MVP, revision 2 • **Event:** HackUMass XIV (hacking Fri Nov 13, 8:30 PM → final submission Sun Nov 15, 9:00 AM) • **Working domain:** abdul.care (availability and sponsor eligibility unverified)

> Tap your card. Understand your bill. Get help paying for care.

**Revision 2 changes (Nov 14):**
- The Raspberry Pi and RFID reader are gone. Check-in now uses **NFC CareCards** (3D-printed cards with an NFC sticker inside) tapped on a **phone or tablet kiosk**.
- **Capital One Nessie** is added. It finds medical bills in a mock bank account and pays approved grants in dollars.
- **Solana devnet** is now the fund's public, privacy-safe ledger of donations and payouts.
- Lanes are updated for 4 people (§11).

## 1. Product
AbdulCare is an AI-assisted healthcare access kiosk.
1. A patient taps their **CareCard** on a kiosk phone.
2. AbdulCare finds the medical bills in their linked (mock) bank account, or the patient scans a paper bill or prescription receipt.
3. The patient gets a plain-language explanation and asks a community care fund for help.
4. A human reviewer approves a grant.
5. At the provider's counter, a second tap and the provider's confirmation pay the bill from the fund's Nessie account. A matching privacy-safe receipt is recorded on Solana devnet so donors can verify where the money went.

The central demo is one complete journey: **tap → find or scan bill → explain → request → approve → tap → pay → public receipt**.

The project is inspired by Abdul El-Sayed's advocacy for Medicare for All. It is an independent hackathon prototype with no affiliation or endorsement. Use the healthcare-access theme in the pitch; keep the product focused on helping a person complete a concrete task.

## 2. Problem and users
Medical paperwork can be hard to understand, financial assistance can be hard to navigate, and requiring a personal smartphone shuts some people out. With AbdulCare the patient only needs a card. The kiosk is the clinic's device.

| User | Needs |
| --- | --- |
| Patient | Understand an expense, review extracted information, request help, and track the outcome |
| Fund reviewer | Review the source bill, assess a request, and approve a capped amount |
| Participating provider | Redeem an approved grant and see a payment receipt |
| Donor | Verify contributions and payouts on a public ledger without seeing any patient information |

**MVP scenario:** A fictional patient has a $45 pharmacy bill in their mock Nessie account. A fictional community fund approves $45 of assistance. The fund's Nessie account pays the pharmacy, and a Solana devnet receipt with an opaque reference is publicly visible.

## 3. MVP requirements
| Priority | Requirement | Completion criterion |
| --- | --- | --- |
| P0 | Card check-in | Tapping a CareCard on a paired kiosk device opens the correct fictional patient session. An unknown card shows an enrollment/help state. The same card scanned by an unpaired phone shows "Tap at a participating kiosk" and no patient data |
| P0 | Document capture | Capture a readable image with the device camera from the browser; file upload is a supported fallback |
| P0 | AI extraction | Extract provider, document type, currency, total amount, date if present, and supporting text; missing values remain unknown |
| P0 | Patient review | Show the source image or bill beside editable extracted fields; require confirmation before creating a request |
| P0 | Explanation | Explain the expense using the source, without inventing coverage, charges, diagnoses, or eligibility |
| P0 | Assistance matching | Compare confirmed fields and patient-provided information against a curated catalog; show reasons and missing information |
| P0 | Grant request | Create a pending request linked to the reviewed bill and selected provider |
| P0 | Human approval | An authenticated reviewer approves or rejects the request; approval fixes the amount and allowlisted recipient |
| P0 | Provider redemption | An authenticated provider device, a patient card tap, and explicit confirmation start redemption of an approved grant |
| P0 | Nessie payout | Exactly one Nessie payment from the fund account to the provider for the approved amount, with its ID shown on the receipt |
| P0 | Solana receipt | One devnet transaction per payout with an opaque reference memo; show its signature and explorer link |
| P0 | Duplicate prevention | Repeated taps, refreshes, and retries never pay the same grant twice on either rail |
| P1 | Bank-linked bill discovery | Pull the patient's Nessie purchases and bills; AI flags likely medical expenses for the patient to choose from |
| P1 | Fund dashboard | Show contributions, available/reserved funds, aggregate approved/paid totals, and links to the Solana ledger |
| P1 | Application draft | Generate a source-grounded assistance request for human review; do not submit it externally |

Use two or three **explicitly fictional assistance programs** for the MVP. Real programs are a stretch feature that needs verified official rules, links, and review dates. AI matching indicates a possible fit; it never guarantees eligibility.

## 4. Screens
1. **Welcome/check-in:** "Tap your CareCard" prompt and a clear prototype label.
2. **Bills found** (P1): likely medical expenses from the linked Nessie account, plus a "scan a paper bill instead" option.
3. **Capture/review:** camera preview, retake/upload controls, source document, editable extracted fields.
4. **Explanation/options:** short summary, amount, possible assistance, reasons, and missing information.
5. **Request status:** pending, approved, rejected, payment pending, or paid.
6. **Reviewer console:** source document, confirmed fields, program criteria, amount, recipient, approve/reject controls.
7. **Provider terminal:** authenticated provider device, tap prompt, approved grant, confirmation, and receipt (Nessie payment ID + Solana signature).
8. **Fund dashboard:** aggregate activity and the public Solana ledger; no patient-level information.
9. **Card landing on an unpaired phone:** "Tap at a participating kiosk", with no data.

Use large text, clear status labels, keyboard support, and status messages that do not rely on color alone. End idle kiosk sessions and clear visible patient information. Design mobile-first: the kiosk and the provider terminal are phones or tablets.

## 5. Architecture and stack
| Layer | Implementation |
| --- | --- |
| Frontend | Next.js + TypeScript, mobile-first; one app with patient kiosk, reviewer, provider, and dashboard views |
| Backend | Node.js/TypeScript; owns authorization, device pairing, grant rules, and payment orchestration |
| AI | Gemini image understanding, structured extraction, transaction classification, and explanations, called only from the backend |
| Database | MongoDB Atlas for patients, card tokens, documents, requests, and payment state |
| Document storage | Private storage with restricted access and a demo-data reset/delete path |
| Banking | Capital One Nessie (mock bank): patient accounts, bills and purchases, fund account, provider merchants, payouts |
| Blockchain | Solana devnet: fund treasury, donation and payout receipts with opaque memos |
| Check-in | NFC CareCards holding a URL with an opaque token; iPhone and Android open it natively (no app) |
| Hosting | Public HTTPS URL reachable by phones (deployment or tunnel), chosen **before** cards are written |

**Data flow:** card tap → phone opens `https://<domain>/t/<token>` → backend resolves the token only for a paired kiosk or provider device → patient session. Bills come from Nessie or a camera capture → Gemini → patient review → grant request → reviewer approval → provider tap + confirm → Nessie payout → Solana receipt → reconciled status.

A custom smart contract is outside the MVP. Describe this as a centrally administered prototype that uses Nessie for (mock) dollar settlement and Solana as a public audit trail. Approval and duplicate-prevention rules live in the backend, not on-chain.

## 6. Physical build: CareCards and the kiosk
| Item | Purpose |
| --- | --- |
| NTAG213/215 NFC stickers (hardware table or a store) | Hold each card's URL |
| 3D-printed CareCard shells with a sticker pocket | Branded, physical cards for the demo (one per fictional patient, plus a spare) |
| 3D-printed kiosk stand | Holds a phone or tablet upright as the clinic kiosk and provider terminal |
| NFC Tools app | Write the URL record to each sticker and lock it |

- **Do not write to student ID cards.** They usually use secure chips that can't hold a URL, and writing could break campus access.
- Use plastic shells only. Metal blocks NFC.
- Write each card once the base URL is final, then lock the tag.
- Print the same URL as a small QR code on the back of each card as a fallback.
- If a tap fails during the demo, use the QR code or a clearly labeled manual check-in. Never present a fallback as a working tap.
- **Phones:** iPhone reads URL tags automatically (a banner opens the link). Android opens it directly. Web NFC (reading inside the page) works only in Chrome on Android; treat it as an optional upgrade for the kiosk.
- **Stretch:** NTAG 424 DNA tags produce a new signed URL on every tap, so copied links stop working.

## 7. AI behavior
Return validated structured output: extracted fields, evidence excerpts, missing fields, and a plain-language summary. Validate the schema and numeric values server-side, and show the source for review. For Nessie transactions, classify which purchases and bills are likely medical, with a short reason; the patient picks which one to use.

Treat all document and transaction text as untrusted input. Instructions printed inside a bill or a merchant name must not override system rules, choose a recipient, approve a grant, or trigger a payment. The AI has no access to the treasury, the Nessie fund account, approved amounts, or recipients.

Support unreadable documents with retake/manual review. Avoid diagnostic advice, treatment recommendations, and claims of clinical validation.

## 8. Payment model and state
All dollar amounts are integer cents.
- **Nessie payout:** the approved amount moves from the fund's Nessie account to the provider's Nessie merchant/account. This is the mock dollar settlement.
- **Solana receipt:** a fixed, configured number of devnet lamports from the fund treasury, with a memo holding only an opaque payout reference. Label it **public test receipt**. Never imply that devnet SOL has dollar value.
- **Donations** (P1): donors' devnet contributions to the treasury are also visible on the ledger.

Verify the exact Nessie endpoints for payouts at kickoff and record the choice in `packages/contracts`.

Grant states:
**draft → pending_review → approved/rejected → payment_pending → paid**.
An approved grant can also be canceled before payment starts. `paid` requires a confirmed Nessie payout. The Solana receipt has its own status on the PaymentAttempt (`receipt_pending → receipt_confirmed`) and never blocks or repeats the payout.

Backend rules:
- Require authenticated reviewer and provider roles, and a paired device for any card-token lookup.
- Reserve fund budget when approving a grant; release it on pre-payment cancellation.
- Atomically claim an approved grant for redemption before starting any payout.
- Fix the amount and recipient from approved server records; ignore client-supplied replacements.
- Record an idempotency key per grant and rail before calling Nessie or broadcasting to Solana.
- Persist the signed Solana transaction and its validity information before broadcasting. On timeout, reconcile the existing signature and rebroadcast the same signed transaction where valid.
- Never start a replacement payout or receipt while an earlier result is uncertain.
- Mark Solana receipts confirmed only after the required network confirmation.
- Allow a new attempt only after the prior attempt is conclusively failed or expired and reconciled.

A card tap alone never authorizes a payment. The provider device must be authenticated and the provider must explicitly confirm.

## 9. Data and API contract
Core records:
- **Patient:** internal ID, fictional display name, linked Nessie customer/account IDs (mock).
- **CardToken:** hashed opaque token → patient, status (active/revoked).
- **Device:** ID, role (kiosk or provider), pairing credential (httpOnly cookie), provider link.
- **Document:** owner ID, source (scan or Nessie bill/purchase), private image reference, extracted fields, confirmed fields.
- **AssistanceProgram:** fictional/verified flag, eligibility rules, source and review date where applicable.
- **Grant:** patient, document, provider, approved cents, reserved budget, status, reviewer, timestamps.
- **PaymentAttempt:** grant, rail (nessie or solana), idempotency key, amount, recipient, external ID or signature, validity metadata, status.
- **Provider:** ID, Nessie merchant/account ID, allowlisted devnet wallet, authenticated operator.

Suggested endpoints:
| Endpoint | Purpose |
| --- | --- |
| GET /t/:token | Card tap landing. Opens a session only on a paired device; otherwise shows the kiosk prompt |
| POST /devices/pair | Pair a kiosk or provider device (staff only) |
| GET /patients/:id/bills | Likely medical bills and purchases from Nessie, with AI flags |
| POST /documents | Create a private document record (scan or Nessie item) and start extraction |
| PATCH /documents/:id/review | Save human-confirmed fields |
| POST /grants | Create a pending assistance request |
| POST /grants/:id/decision | Reviewer approval or rejection |
| POST /grants/:id/redeem | Provider-confirmed, idempotent redemption (Nessie payout + Solana receipt) |
| GET /grants/:id | Authorized status and receipt |
| GET /fund/summary | Aggregate fund activity and ledger links |

Generate stable random IDs and card tokens server-side. Enforce record ownership and role authorization on every relevant endpoint.

## 10. Privacy and boundaries
Use synthetic documents, fictional identities, Nessie mock data, and devnet funds throughout. No real patient information or money.

Keep medical documents, names, card tokens, diagnoses, and patient-linked references off-chain. Solana memos contain only an opaque payout reference. Blockchain transactions remain publicly observable; claim neither anonymous healthcare payments nor HIPAA compliance.

Keep API keys (Gemini, Nessie, MongoDB), the treasury key, and device credentials out of the browser and the repository. Restrict document access, avoid logging document contents, and provide session clearing and demo-data deletion.

Non-goals: insurance coverage, medical diagnosis, real eligibility determination, autonomous grant approval, real claims submission, real-money custody, real bank connections, and proof that medical care was delivered.

## 11. Team lanes
Each agent works in one lane and edits only that lane's folders (see [AGENTS.md](../AGENTS.md) §2). The lane ID is also the commit scope.

| Lane | Person | Owns | Folders | Integration deliverable |
| --- | --- | --- | --- | --- |
| `api` | Omar (`@omaribrahim6`), integration owner | Core backend: MongoDB models, auth and roles, device pairing, card tokens, grant state machine, endpoints, shared contracts. Also takes frontend tasks the `web` owner hands off | `apps/api/` (except `src/ai/`, `src/payments/`), `packages/contracts/` | Card tap → reviewed document → pending grant → approved grant |
| `payments` | Mohamed (`@CaptainCrasi`) | Nessie fund and provider accounts, payouts, patient bill/purchase import, Solana treasury and receipts, idempotency and reconciliation | `apps/api/src/payments/` | Exactly one Nessie payout and one confirmed Solana receipt per approved grant |
| `web` | Noureldin or Musa (to confirm) | All screens in §4, mobile-first kiosk and provider views, accessibility, pitch visuals | `apps/web/` | The full journey in the browser against the shared contracts |
| `ai` | Noureldin or Musa (to confirm) | Gemini extraction, validation, explanations, medical-transaction classification, assistance catalog and matching, prompt-injection defenses, application draft | `apps/api/src/ai/` | Bill image or Nessie item → validated fields + explanation + matched programs |

**Physical build (§6)** is not a lane. Whoever is free in the first hours writes the tags and starts the 3D prints, after the base URL is set.

**Integration owner** (`@omaribrahim6`): owns `packages/contracts/`, settles lane overlaps, and runs the acceptance checks in §13. A contract change is a PR to `packages/contracts/` plus a board post tagging every affected lane.

## 12. Schedule (36 hours)
| Clock (EST) | Deliverable |
| --- | --- |
| Fri 8:30–11:30 PM | Lock scope; merge contracts; pick the base URL. Prove each risk alone: Gemini extracts the $45 bill (`ai`), one Nessie payout and one devnet receipt (`payments`), a card tap opens a page on a phone (`api`/`web`), screen shells with mock data (`web`) |
| Fri 11:30 PM–Sat 8:30 AM | Tap → bill (scan or Nessie) → reviewed document → pending request |
| Sat 8:30 AM–6:30 PM | Reviewer approval, fund reservation, provider redemption, Nessie payout + Solana receipt |
| Sat 6:30 PM–Sun 12:00 AM | Abuse cases: duplicate taps, retries, unpaired phones, unauthorized providers, bad scans, rejected requests. **Submit the initial Devpost entry before midnight** |
| Sun 12:00–4:30 AM | Polish accessibility, CareCards and stand; prepare clearly labeled fallback assets |
| Sun 4:30–9:00 AM | Feature freeze, rehearse, record backup demo, final submission by **9:00 AM** |

If the schedule slips, cut these first: voice, donor contributions UI, application draft, real assistance programs, NTAG 424 signed taps, Web NFC.

## 13. Acceptance checks
The MVP is ready when:
- A real CareCard tap on a paired kiosk opens the intended fictional session.
- The same card scanned on an unpaired phone shows no patient data.
- A real camera capture or Nessie bill is extracted and reviewed successfully.
- Missing or unclear fields are not invented, and corrections persist.
- Assistance results explain their criteria and never guarantee coverage.
- Pending and rejected requests cannot be redeemed.
- An unauthorized provider or unpaired device cannot redeem a grant.
- Approval cannot exceed available budget or alter an unrelated grant.
- Repeated taps, refreshes, and uncertain responses never create a duplicate Nessie payout or Solana receipt.
- A successful redemption shows the Nessie payment ID and a confirmed devnet signature with the matching recipient.
- Public chain data and the dashboard contain no patient information.
- Session reset hides the prior patient's information.

## 14. Three-minute demo
1. **Problem, 20 seconds:** "A confusing bill and no smartphone should not stop someone from asking for help."
2. **Patient flow, 50 seconds:** tap the CareCard on the kiosk, pick the $45 pharmacy bill AbdulCare found (or scan it), read the explanation and evidence, request support.
3. **Human review, 25 seconds:** the reviewer approves assistance to the mock pharmacy.
4. **Redemption, 40 seconds:** at the provider terminal, tap again, confirm, and show the Nessie payment and the Solana receipt.
5. **Trust, 25 seconds:** a repeated tap is blocked, and the card scanned on a random phone shows nothing. Medical data stays off-chain.
6. **Close, 20 seconds:** "AbdulCare makes the path from confusing paperwork to community support easier to navigate."

If the network fails, show the honest pending state and a clearly labeled prerecorded successful run. Never disguise a simulated payment as a live confirmed transaction.

## 15. Submission and branding
Tracks to target (verify each sponsor's exact rules before claiming eligibility):
- **Main:** Best MedTech Hack, Most Impactful AI Hack, Best Use of Nessie (Capital One), Best Use of Solana, Best Use of Gemini API, Best Use of MongoDB Atlas
- **Also worth entering:** Best UI/UX, Best Accessibility Hack, Most Secure Hack / Best AI Security Hack, Best Pitch, Best Domain Name from GoDaddy Registry (check that the chosen TLD qualifies)

Deadlines: initial submission **Sun 12:00 AM**, final submission **Sun 9:00 AM**, judging **12:30 PM**. At least one team member must be present for judging.

Working brand: **AbdulCare — Care for All**.
Working domain: **abdul.care**, subject to availability and registry rules. Decide the base URL early, because it is written into the CareCards; a redirect from a temporary URL is fine.

Independent-project footer: "Independent hackathon prototype. Not affiliated with or endorsed by Abdul El-Sayed. Demonstration uses fictional data, Capital One Nessie mock banking, and Solana devnet."

Reference for the policy inspiration: https://abdulforsenate.com/priority/medicare-for-all-the-path-to-a-healthier-america/
Solana memo reference: https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/payments/send-payments/payment-with-memo.mdx
Capital One Nessie API: http://api.nessieisreal.com/

**Success criterion:** One reliable, understandable journey from a card tap to a human-approved grant, a (mock) dollar payout, and a public, privacy-safe receipt.
