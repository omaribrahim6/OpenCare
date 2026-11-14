# 001 — TrumpCare: a coordinator for existing medical financial assistance

| | |
|---|---|
| **Status** | Discussing |
| **Proposed by** | Musa (`@Zintrivious`) |
| **Steward** | Musa's Claude |
| **Board thread** | [Planning Board #32, PROPOSAL post](../../../../issues/32#issuecomment-6880453404) |
| **Decision** | Pending (only `@omaribrahim6` decides) |
| **Spec PR** | — |

## Summary

Turn the product from "a community fund that pays bills" into **one place to find, apply for and track existing medical financial assistance** ("OSAP for medical bills"). The patient gives their information once. TrumpCare matches programs, prepares the applications, records each program's decision, and keeps one balance that only counts confirmed assistance. The community fund becomes a secondary resource for what's left. Gemini moves from ranking patients to reading bills and policies and preparing applications. The CareCard links a hospital visit to the patient's case.

## Agreed so far

From the proposal's own §17. Not yet confirmed by the team; anyone who disagrees should say so under *Positions*.

- TrumpCare is primarily a **centralizer** of existing assistance; it isn't a new source of money.
- Existing assistance comes first; the community fund is secondary and never shows money it doesn't have.
- AI assists (documents, policies, applications); **people and the responsible organizations decide**.
- The CareCard holds only a revocable identifier that points to a backend record.
- Hospitals are optional partners. The product must be useful without them.
- Evidence carries its source: patient-uploaded, institution-attested and authoritative records are never treated as equal.
- **Possible** assistance is never subtracted from the balance; only **confirmed** assistance is.
- A generated application is never shown as submitted.
- All demo data is fictional, and simulated decisions are labeled as simulated.

## Open questions

The full list is in §16 of the proposal text below. These are the ones that block a hackathon build.

| # | Question | Raised by | Current answer / options | Status |
|---|---|---|---|---|
| Q1 | Do we switch before the deadline (initial Devpost tonight 12:00 AM, final Sun 9:00 AM)? | Musa's Claude | Only with a hard MVP cut and a decision by about noon EST Sat | Open |
| Q2 | Which programs are in the demo directory? | Proposal §16D | Hospital charity care, one nonprofit, the community fund. Real program names need sourced rules, so fictional is safer | Open |
| Q3 | Does Gemini still rank the fund's queue? | Proposal §3C | Suggestion: no. The published formula orders the fund's queue; Gemini explains and prepares applications | Open |
| Q4 | How is "submitted" shown when nothing is actually submitted? | Proposal §5 Stage 6 | "Submitted (simulated)", with the label always visible | Open |
| Q5 | What happens to the current kiosk, provider and caseworker screens? | Musa's Claude | Reuse: the provider terminal becomes the hospital staff terminal; the caseworker desk records program decisions | Open |
| Q6 | Product name: keep "TrumpCare"? | Musa's Claude | "TrumpCare" was the popular name for the 2017 AHCA repeal bill and could read as political or satire. Decide separately from the product | Open |
| Q7 | Does the bill come from Nessie, from a seeded document, or both? | Proposal §3E | Seeded hospital-attested bill for the demo; Nessie keeps payouts and donations | Open |

## Proposed MVP scope

First draft, from Musa's Claude's reply on #32. The steward updates it as the discussion moves.

- **Build (five screens, mostly reusing what exists):**
  1. **Hospital staff terminal:** tap the CareCard and attach a $5,000 bill marked "hospital-attested". Reuses pairing, taps and sessions.
  2. **Patient case page:** the bill with its source badge, plus 3 programs with why each may fit and what's missing. Rules are deterministic; Gemini explains.
  3. **Prepare application:** Gemini fills each packet from the one profile. Status runs Ready for review → Submitted (simulated).
  4. **Program decisions:** the caseworker desk records "charity care: $2,500 reduction" (no money moves) and "nonprofit: $1,000 paid".
  5. **Balance ledger:** counts only confirmed events. A community fund grant covers the remainder through the existing Nessie payout and Solana receipt.
- **Cut:** real submission, insurance appeals, OCR of arbitrary uploads (seed the documents), identity verification, the business model (pitch slide only), and Gemini ranking the queue.
- **Lane impact (draft):**
  - **api:** case, program, application and ledger-event models; attach-bill and record-decision endpoints.
  - **ai:** policy-to-requirements, packet generation, explanations; classification and injection detection stay.
  - **payments:** unchanged, plus bill-reduction events that move no money.
  - **web:** the five screens; the data layer and the kiosk shell carry over.

## Risks

- **Time:** a pivot this late can leave two half-finished products. Mitigation: decide fast, freeze the cut list, keep the current journey working until the new one runs end to end.
- **Becoming "just information"** (§18): the demo must show work being removed, not only recommendations.
- **Overclaiming:** simulated submissions or decisions shown as real would undercut trust with judges.
- **Naming** (Q6).

## Positions

Each person's agent edits only its own subsection: agree, agree with changes, or disagree, plus the reasons and what would change their mind.

### Omar (`@omaribrahim6`)
_No position yet._

### Noureldin (`@ibragot`)
_No position yet._

### Mohamed (`@CaptainCrasi`)
_No position yet._

### Musa (`@Zintrivious`)
**Proposer. Agrees** with the direction and prefers it to the community-fund design.

Musa's Claude (an opinion): agree, with changes. The pivot only works with the MVP cut above and a decision by about noon EST Saturday. Most current code carries over. Separately, flags the name (Q6).

## Decision log

- _None yet._

## Change log

- 2026-11-14 11:30 EST, Musa's Claude: created from Musa's proposal (#32) and Musa's Claude's reply; the shared sections are seeded from proposal §16 and §17.

## Proposal

Musa's original text, as posted on #32.

### TrumpCare — The New Vision
##### HackUMass XIV | Product Concept & Redesign Proposal
**Status: Concept under discussion — not finalized**
**Working name: TrumpCare (previously AbdulCare)**

---

### 1. Executive Summary

TrumpCare is a proposed centralized healthcare financial assistance platform designed to make navigating medical bills and financial aid substantially easier.

The inspiration is similar to **OSAP in Ontario, Canada**, but applied to healthcare in the United States.

Rather than forcing patients to individually investigate hospitals, charities, insurance policies, government programs, and nonprofit organizations, TrumpCare would offer a single place to manage the process.

The long-term vision is straightforward:

**One patient profile. One set of supporting documents. Multiple financial assistance programs. One place to track everything.**

A patient would provide their information once. TrumpCare would then identify relevant assistance opportunities, evaluate preliminary eligibility, prepare applications, coordinate submissions, and track decisions.

Where assistance is approved, TrumpCare would update the patient's financial picture and identify any remaining balance.

An optional community care fund could help cover part of the remaining expense when existing assistance is insufficient.

The goal is not to invent a new healthcare system or create an unlimited pool of money.

**The goal is to reduce the friction between patients and the resources that already exist.**

A distinctive part of the concept is the physical **CareCard**: an NFC-enabled card that connects patients to a persistent TrumpCare case. At participating hospitals, the card could also make it easier for staff to attach trusted billing information during the patient's visit.

However, hospital participation would not be required for every patient to benefit from TrumpCare.

This design is still being explored. Several important questions about verification, application submission, partnerships, eligibility, and payments remain unresolved.

---

### 2. The Original Idea

The original AbdulCare concept was primarily an AI-assisted community healthcare funding platform.

The core workflow, as documented in the current repository, was:

1. A patient receives an NFC CareCard.
2. The patient taps the card at a healthcare kiosk.
3. TrumpCare identifies likely medical expenses through a linked mock bank account.
4. The patient selects a bill and requests financial assistance.
5. An AI system evaluates and ranks requests according to financial need.
6. A human caseworker reviews the ranked queue and approves or rejects assistance.
7. Approved grants are paid through a community fund using Capital One's Nessie mock banking API.
8. A privacy-safe transaction receipt is recorded on Solana devnet.

The concept combined physical hardware, AI, financial assistance, banking integration, and blockchain-based auditing.

Its primary objective was to simplify access to a community-funded medical assistance program and demonstrate transparent financial distribution.

#### What was good about the original idea?

**A compelling problem:** Medical expenses can create significant financial hardship, and patients may struggle to access help.

**Physical interaction:** The CareCard and kiosk created an understandable and memorable live demonstration.

**An end-to-end workflow:** The product demonstrated a patient requesting assistance and potentially receiving payment rather than simply providing information.

**Human oversight:** Funding decisions were reviewed by caseworkers instead of being fully delegated to AI.

**Transparency:** Donations and payouts were intended to be visible through a public dashboard and blockchain receipts.

These are strengths worth preserving.

However, the original product also had fundamental weaknesses.

---

### 3. Problems With the Original Idea

#### Problem A: Where does the money come from?

The original system centered around a community fund that pays patients' medical expenses.

But a platform cannot solve a shortage of healthcare funding simply by introducing an interface for distributing money.

Consider a hypothetical scenario:

- 1,000 patients request assistance.
- Each needs $1,000.
- Total demand is $1,000,000.
- The community fund contains only $10,000.

TrumpCare can decide how to allocate that $10,000, but it cannot resolve the remaining $990,000 in demand.

The project risks becoming an elaborate system for distributing a very limited pool of donated money.

**Proposed solution:**

Instead of making community funding the primary mechanism, TrumpCare should first identify existing financial assistance and bill-reduction opportunities.

The community fund becomes an optional secondary resource.

The platform's value would no longer depend entirely on its ability to attract donations.

#### Problem B: The technical complexity didn't translate into obvious innovation

NFC cards, Gemini, banking APIs, Solana, and dashboards are technically impressive.

But the fundamental workflow remained:

*Patient asks for money → reviewer decides → fund pays.*

The collection of technologies did not automatically make the underlying product original.

**Proposed solution:**

Change the core innovation from distributing assistance to coordinating multiple independent assistance systems.

The technical challenge becomes reducing duplicated applications, managing conflicting information, tracking external decisions, and maintaining a consolidated financial assistance case.

#### Problem C: AI deciding who receives assistance is difficult to justify

The original specification contains a deterministic financial-need scoring formula.

Gemini then compares the applicants and ranks them.

This raises an important question: why should a language model reorder patients if published, auditable scoring rules already exist?

Even though caseworkers make final decisions, rankings influence who receives attention first.

There are also fairness concerns involving incomplete information, unusual financial circumstances, and potentially inaccurate assumptions.

**Proposed solution:**

Shift Gemini's main responsibility toward understanding documents, interpreting assistance policies, identifying missing requirements, and preparing applications.

AI would help patients access assistance rather than decide which patients are most deserving of it.

Any grant prioritization should follow transparent, documented rules with human review and opportunities for reconsideration.

#### Problem D: Patient onboarding was oversimplified

The original system assumed that the patient's household size, income, insurance status, and financial information were already available in a profile.

This simplified the demonstration but ignored a major real-world problem:

How does that information enter the system?

Who verifies it?

What happens if a patient has no government ID, no smartphone, no bank account, or incomplete documents?

**Proposed solution:**

Support different enrollment paths:

- Self-service enrollment through a laptop or smartphone.
- Assisted enrollment at a participating hospital or clinic.
- A physical CareCard for convenient return access.

The patient would not necessarily need an email address or conventional website account, but TrumpCare would still maintain a secure backend patient record.

Identity verification and eligibility verification would be separate processes.

#### Problem E: Banking records aren't reliable medical billing records

The original system used Capital One Nessie banking transactions to identify likely medical expenses.

But a banking record does not necessarily contain enough information to determine:

- What medical services were provided.
- What the hospital originally charged.
- What insurance covered.
- Whether the remaining bill is correct.
- Whether adjustments are pending.
- Whether the patient has already received assistance.

**Proposed solution:**

Use actual medical billing documents, insurance explanations, and provider-originated records when available.

Nessie can remain valuable for demonstrating fictional financial transactions, but it should not be treated as the definitive source of medical billing information.

#### Problem F: Too dependent on an invented funding infrastructure

A new fund with fictional contributions can demonstrate a payment, but it does not establish a realistic long-term healthcare assistance system.

**Proposed solution:**

Position TrumpCare primarily as infrastructure connecting people to existing resources.

Hospitals, government programs, charities, and nonprofits retain control over their own funds.

TrumpCare coordinates their application processes and decisions.

An independently funded community grant program may still exist, but the platform must never imply that money is available unless the fund actually has sufficient resources.

---

### 4. The New Core Idea: OSAP for Medical Assistance

A useful analogy is Ontario's Student Assistance Program (OSAP).

Students provide financial and household information through one application process. The program coordinates eligibility assessment for multiple types of government student assistance.

TrumpCare would attempt to offer a similar centralized experience for healthcare financial assistance.

However, there is a major distinction:

**OSAP operates within an established government administrative system. TrumpCare would initially be an independent platform with no authority over hospitals, insurers, or government programs.**

Therefore, TrumpCare cannot independently approve most forms of medical assistance.

Instead, it would:

1. Collect relevant patient information with consent.
2. Discover potentially applicable assistance programs.
3. Compare patient circumstances against documented eligibility rules.
4. Identify what evidence each application requires.
5. Reuse existing information across applications.
6. Prepare and, where permitted, submit applications.
7. Track responses and identify required follow-up actions.
8. Record confirmed assistance decisions.
9. Recalculate outstanding financial needs.
10. Help coordinate any remaining payments or applications.

Each external organization would still make its own eligibility and funding decisions.

#### The central promise

**Patients manage one TrumpCare case. TrumpCare helps manage the complexity of multiple assistance programs.**

The goal is to make a fragmented financial assistance ecosystem feel like one coherent process.

---

### 5. What the New Patient Experience Could Look Like

This is a proposed user journey, not a fully implemented workflow.

#### Stage 1: A patient needs medical care

Imagine a patient visits a hospital for treatment.

They either already have a TrumpCare CareCard or are introduced to the service during their visit.

TrumpCare is not medical insurance, a replacement for the hospital, or a requirement to receive healthcare.

Its role begins with helping the patient manage the financial consequences of care.

#### Stage 2: Enrollment or CareCard scan

##### First-time patient

The patient can register through the TrumpCare website or with assistance from hospital staff.

A secure record is created.

The patient may receive a physical NFC CareCard linked to that record.

##### Returning patient

The patient presents their CareCard.

At a participating hospital, authorized staff could scan the card during the same visit.

The goal is to prevent patients from having to return to the hospital later just to provide information they could have supplied during their original visit.

##### What gets stored on the CareCard?

**Not the patient's medical or financial records.**

The card would hold a random, revocable identifier or secure link referencing the patient's backend record.

The patient's information would remain in protected storage.

This allows records to be updated without physically rewriting the card. If the card is lost, it could be revoked and replaced.

The card alone should not grant unrestricted access to sensitive information.

#### Stage 3: The hospital visit is associated with the patient

If the hospital participates, an authenticated staff member could use a TrumpCare interface to associate the encounter with the patient's case.

The staff member could supply relevant billing information or documents through an authorized workflow.

For example:

- Hospital name.
- Patient or encounter reference.
- Visit date.
- Billing document.
- Amount currently reported.
- Whether the balance is preliminary or final.

An important detail is that **the final medical bill may not exist on the day of the visit**.

Insurance processing and billing adjustments can occur afterward.

Therefore, the system should distinguish between:

- A visit that has been recorded.
- A preliminary charge.
- A bill awaiting insurance processing.
- A provider-confirmed outstanding balance.

A same-day CareCard scan would establish the case linkage. It would not automatically guarantee that every subsequent billing record becomes available.

If the hospital later supplies updated records through an integration or staff workflow, TrumpCare could update the case without the patient returning.

If no such connection exists, the patient may still need to provide later documents online.

#### Stage 4: TrumpCare begins discovering assistance

Once sufficient information is available, TrumpCare searches for relevant financial assistance opportunities.

Potential sources include:

**Hospital financial assistance:** Discounts or financial assistance programs administered by the healthcare provider.

**Government programs:** Public coverage or assistance programs that may apply depending on the patient's circumstances and jurisdiction.

**Nonprofits and charities:** Organizations that provide support for qualifying medical expenses or financial hardship.

**Insurance-related actions:** Reviewing coverage, identifying possible claim discrepancies, or helping prepare appeals where applicable.

These do not all operate the same way.

A hospital charity-care approval might reduce the bill directly. A nonprofit might make a grant payment. An insurance appeal might change the amount owed. A government coverage application might affect future or potentially qualifying past expenses, subject to program rules.

TrumpCare must preserve those distinctions.

#### Stage 5: One reusable application profile

The patient provides their relevant information once.

Possible fields include:

- Household size.
- Household income.
- Insurance status.
- State of residence.
- Relevant financial circumstances.
- Medical billing documents.
- Supporting income documents.
- Contact or notification preferences.

TrumpCare then determines which information can be reused for specific assistance applications.

Rather than displaying one enormous questionnaire, the platform could ask questions progressively.

For example:

A hospital assistance policy may require household income and family size.

Another nonprofit may require evidence of a particular expense and residency.

TrumpCare would identify what is already available and ask the patient only for information still missing.

#### Stage 6: Application preparation and submission

This is intended to become a central feature of the product.

Gemini could assist with extracting relevant details from documents, identifying required form fields, summarizing program requirements, and preparing application packets.

For programs that support authorized digital submission, TrumpCare could submit applications after patient approval.

For programs that do not provide integrations, TrumpCare might generate a completed application package and direct the patient or caseworker to the official submission process.

**A generated application must not be represented as submitted.**

The interface should distinguish:

- Potential program match.
- Application being prepared.
- Missing documents.
- Ready for patient review.
- Submitted, with confirmation.
- Awaiting decision.
- Approved or denied.

The patient should be able to see which actions TrumpCare completed and which still require manual intervention.

#### Stage 7: Coordinating multiple decisions

Suppose a patient has a $5,000 medical bill.

TrumpCare identifies three potentially relevant programs.

The patient applies to two of them, while a third requires additional documentation.

One hospital program approves a $2,500 reduction.

A nonprofit later approves a $1,000 contribution.

TrumpCare records each verified outcome and updates the outstanding balance.

The important distinction is between **possible assistance and confirmed assistance**.

Potential awards cannot be subtracted from the patient's actual balance.

The system must also avoid double-counting funds or treating a grant as a bill reduction before it has actually been applied.

#### Stage 8: Addressing the remaining balance

After confirmed reductions and payments, the patient may still owe money.

TrumpCare could help by:

- Identifying additional available programs.
- Preparing another application.
- Exploring provider payment arrangements.
- Requesting an affordable payment plan.
- Submitting a request to a genuinely funded community assistance program.

A community care fund would be a secondary option, not the central assumption behind the entire product.

A caseworker or authorized fund administrator would review grants using documented rules.

The patient would pay whatever portion remains their responsibility under the applicable arrangements.

The system should not promise a zero balance.

#### Stage 9: One ongoing case dashboard

Throughout the process, the patient can return to TrumpCare to see:

- Their bills.
- Potential assistance.
- Submitted applications.
- Missing documents.
- Pending decisions.
- Confirmed reductions.
- Approved payments.
- Remaining balance.
- Recommended next actions.

The patient should no longer need to mentally coordinate several unrelated financial assistance processes.

---

### 6. Example: A Complete Hypothetical Case

Assume a fictional patient has a $5,000 medical bill.

TrumpCare receives the bill and identifies potential financial assistance.

The following outcomes are simulated for demonstration purposes.

| Source | Result | Amount |
|---|---|---:|
| Original hospital bill | Starting balance | $5,000 |
| Hospital charity care | Approved bill reduction | −$2,500 |
| Nonprofit assistance | Approved and applied payment | −$1,000 |
| Community care fund | Approved and paid grant | −$1,000 |
| Patient | Pays remaining amount | −$500 |
| **Remaining balance** | **Resolved in this example** | **$0** |

The important achievement is not that TrumpCare magically created $4,500 in funding.

The achievement is that it helped coordinate different independent sources of assistance and track their contributions toward resolving one medical expense.

In a real case, some programs may reject the application, offer a smaller amount, or require more documentation.

The interface must communicate those outcomes transparently.

A patient could still owe a substantial balance after using TrumpCare.

---

### 7. The Role of Hospitals

We have discussed two possible operating modes.

#### Mode A: Independent TrumpCare

This mode would not require a hospital to install or adopt TrumpCare.

Patients could:

- Register online.
- Upload bills and supporting documents.
- Connect available authorized information sources.
- Discover potentially relevant assistance.
- Prepare applications.
- Submit through accepted channels.
- Track decisions and follow-ups.

This is important because a product that requires nationwide hospital adoption before being useful is extremely difficult to launch.

However, an independent platform has limitations.

Without direct access to a provider's billing records, TrumpCare cannot always independently confirm that an uploaded bill is authentic or that the displayed amount remains accurate.

Without an external application integration, it may be unable to automatically retrieve decisions.

The product would still be useful, but some actions would remain manual.

#### Mode B: Hospital-assisted TrumpCare

Participating hospitals would receive access to an authenticated staff interface.

During an ordinary hospital visit, a staff member could scan the patient's CareCard and associate a verified hospital-originated record with their case.

The hospital would not necessarily need a full connection between its internal billing database and TrumpCare.

An authorized employee could use the staff portal to supply or attest to relevant records.

This would reduce the patient's burden of providing information and establish stronger evidence of a bill's origin.

However, a manually entered staff record is not automatically equivalent to a fully verified, current balance.

It would also require appropriate staff authentication, patient matching, permissions, and a legitimate basis for sharing information.

##### Why would hospitals adopt it?

Possible benefits include:

- Less repeated financial assistance paperwork.
- Fewer incomplete applications.
- Better organized supporting documentation.
- Easier coordination for financial counselors.
- Improved visibility into unresolved assistance cases.
- Potential reduction in administrative work.

These benefits are hypotheses, not proven results.

We would still need to establish whether hospitals actually want this software, whether it fits their workflows, and what incentives they would have to adopt it.

---

### 8. Where Does Verification Come From?

This is one of the most important unresolved design challenges.

TrumpCare must not assume that every uploaded document is accurate.

It needs a way to distinguish claims, evidence, and authoritative decisions.

#### Different organizations are authoritative for different information

**Hospital or provider:** Whether it issued a particular bill, its current provider balance, provider adjustments, and its own financial assistance decisions.

**Insurance company:** How the insurer processed a claim, coverage determinations, and the insurer's calculated patient responsibility.

**Government agency:** Its own eligibility and benefit decisions.

**Nonprofit or assistance organization:** Whether its specific application was approved and what support it authorized.

**Patient:** Personal circumstances and information they report, which may still require supporting evidence.

No single source automatically verifies everything.

A hospital can confirm that it issued a $2,000 bill, for example, without necessarily establishing that the bill contains no errors.

#### Proposed evidence model

Every important fact could carry a provenance record.

For example:

| Field | Value | Source | Status |
|---|---|---|---|
| Original bill | $2,000 | Patient-uploaded PDF | Unverified |
| Insurance responsibility | $700 | Authorized insurer record | Insurer-confirmed |
| Provider balance | $850 | Hospital staff portal | Provider-reported |
| Charity-care approval | Pending | Hospital program | Not decided |

TrumpCare would identify that the insurer's reported patient responsibility and the hospital's current balance differ.

It would flag the discrepancy for clarification rather than automatically choosing one figure.

Potential evidence states could include:

- Self-reported.
- Patient-document provided.
- Institution-attested.
- Retrieved from an authenticated source.
- Conflicting.
- Outdated.
- Confirmed by the responsible decision-maker.

AI can identify suspicious or inconsistent documents, but **it cannot prove a document is genuine based on appearance alone**.

For higher-trust actions such as grants and payouts, stronger verification may be necessary.

#### What about the CareCard?

The CareCard is not itself an authoritative record.

The card links a patient to their TrumpCare case.

When a participating hospital scans it, the hospital's authenticated staff account or integration provides the source identity.

That is what makes hospital-originated evidence more trustworthy.

---

### 9. What Does Gemini Actually Do?

The original AI approach emphasized ranking patients who requested grants.

The proposed redesign gives Gemini a different role.

**Gemini becomes an intelligent financial assistance navigator and document-processing assistant.**

Potential responsibilities:

##### Document understanding

Read uploaded medical bills, explanations of benefits, income statements, and assistance forms.

Extract structured information while preserving the original documents.

Flag ambiguous or missing values rather than inventing them.

##### Policy understanding

Read official financial assistance policies.

Extract relevant requirements such as income thresholds, residency conditions, accepted documents, and application deadlines.

Associate extracted requirements with the original policy source and its effective date.

##### Preliminary matching

Help identify relevant programs using available patient information and structured eligibility rules.

The system should explain why each match appears relevant and which conditions remain unverified.

##### Application preparation

Map the patient's reusable profile to different application forms.

Identify missing fields.

Prepare documents for patient or caseworker review.

##### Plain-language explanations

Explain what a bill means, what an application requires, and what happens next.

The explanation should distinguish between facts, possible interpretations, and unresolved issues.

##### Caseworker assistance

Summarize case history, missing documentation, discrepancies, and available options.

AI should not independently grant money, deny eligibility, change bank recipients, or declare a hospital balance valid.

Final decisions remain with the appropriate people and organizations.

---

### 10. Who Controls the Patient's Information?

The proposed principle is that **the patient controls access to their TrumpCare case**, subject to lawful processing and necessary administrative permissions.

This doesn't mean the patient directly administers hospital systems or government programs.

It means TrumpCare would act as a central workspace through which the patient manages information and authorizes appropriate sharing.

There would be several roles.

##### Patient

Can access their own assistance case, provide information, review applications, authorize sharing, and track progress.

##### Hospital staff

Can access specifically authorized patient cases and provide relevant records or assistance status information.

##### Caseworker or counselor

Can help prepare applications, verify documents, and coordinate assistance within their assigned permissions.

##### Fund administrator

Can evaluate applications to a particular community fund and approve disbursements within its rules.

##### External program

Retains authority over its own eligibility criteria, decisions, and funds.

##### Donor

May see appropriately aggregated financial information and permitted public audit records, but never private patient documentation.

#### Identity and security considerations

A CareCard should not be enough by itself to expose sensitive financial or healthcare records.

Depending on the interaction, the system may need additional verification, an authenticated device, a staff-assisted process, or stronger authentication.

Not every patient will have a government-issued ID, email address, or smartphone.

The exact identity and account recovery approach remains undecided.

A production system would also need substantial privacy, security, consent, retention, and regulatory review.

For the hackathon, all patient and financial data should be fictional or synthetic.

---

### 11. The Community Care Fund

We are not necessarily eliminating community funding.

We are changing its role.

Originally, the fund was the central mechanism for solving the patient's financial problem.

In the revised proposal, the fund would exist to help address remaining expenses that other programs don't cover.

Potential funding sources might include:

- Individual donations.
- Participating nonprofit organizations.
- Dedicated charitable contributions.
- Partner-managed financial assistance funds.

However, these sources are potential arrangements, not commitments.

TrumpCare should never display available financial support based on money it has not actually received or been authorized to administer.

A grant application does not guarantee an award.

The fund would also need documented eligibility rules, anti-fraud controls, privacy protections, a method of verifying expenses, and human oversight.

For a hackathon, mock grants can demonstrate the proposed workflow. They must be clearly labeled as simulated.

---

### 12. What Happens to the Existing Technical Stack?

We don't necessarily need to discard the work already completed.

Much of the architecture can be repurposed.

| Existing technology | Proposed role in the new concept |
|---|---|
| Next.js + TypeScript | Main patient, staff, and dashboard web application |
| Vercel | Web deployment |
| Tiger Data / PostgreSQL | Patient cases, evidence, policies, applications, and status tracking |
| Gemini | Document understanding, policy extraction, application preparation, explanations |
| NFC CareCard | Convenient patient identification and case linkage |
| 3D printing | Physical prototype cards and kiosk hardware |
| Capital One Nessie | Mock financial transactions, grant disbursements, and payment demonstrations |
| Solana devnet | Optional public, privacy-safe audit records for simulated payouts |

The largest architectural changes would likely involve introducing a proper assistance program directory, reusable application profiles, evidence tracking, and a multi-program application state machine.

Some of the existing grant workflow could remain.

The original AI ranking mechanism would become less central.

Importantly, we have **not yet decided** which of these changes should be implemented immediately or how much existing code should be replaced.

The current repository still primarily documents the older charity-fund-centered design.

---

### 13. Proposed Frontend Experience

The application should support both kiosk/tablet and laptop/desktop use.

These would share the same backend but have different interfaces tailored to the user.

#### Patient experience

The patient interface should be simple, accessible, and action-oriented.

Potential screens:

1. Welcome and enrollment.
2. CareCard check-in or secure login.
3. Medical bills and hospital visits.
4. Assistance opportunities.
5. Missing information and supporting documents.
6. Applications and statuses.
7. Confirmed reductions and remaining balances.
8. Next steps and notifications.

The interface should avoid overwhelming patients with complex eligibility rules and financial terminology.

It should be possible to understand what action is required without reading long explanations.

#### Hospital or caseworker dashboard

A laptop-oriented dashboard could include:

- Assigned patient cases.
- Verification requests.
- Documents requiring review.
- Incomplete applications.
- Pending external decisions.
- Conflicting financial records.
- Assistance outcomes.
- Audit history.

This could use the clean, light-blue dashboard aesthetic we're considering for the frontend.

#### Public funding dashboard

If the community fund remains part of the project, a separate public dashboard could show:

- Verified donations.
- Available funds.
- Approved payouts.
- Actual disbursements.
- Aggregate financial activity.
- Public transaction proofs where appropriate.

Individual patient financial and medical information must remain private.

---

### 14. Proposed Hackathon Demonstration

A compelling demonstration would show the difference between navigating financial assistance manually and using TrumpCare.

##### The scenario

A fictional patient visits a participating hospital and receives a $5,000 medical bill.

##### Part 1 — The CareCard

The patient presents their physical CareCard.

An authenticated mock hospital terminal scans it.

The hospital attaches a billing record to the patient's TrumpCare case.

The patient can now leave the hospital without repeating that initial intake.

##### Part 2 — Discovering assistance

TrumpCare uses the fictional patient's financial circumstances and available documents to identify potentially relevant financial assistance programs.

The application displays why each program may apply and what information is still required.

##### Part 3 — One reusable application

The patient opens one unified assistance dashboard.

Information already provided is reused in multiple application packets.

The platform highlights missing documentation rather than asking the patient to restart each application.

##### Part 4 — External decisions

A simulated hospital administrator reviews one application and records an approved charity-care reduction.

A second fictional program records another decision.

The patient's balance changes only when an actual simulated decision has been confirmed in the demonstration.

##### Part 5 — Remaining financial gap

The updated case shows what assistance has been confirmed, what remains pending, and what the patient still owes.

A caseworker may evaluate a supplemental community grant.

##### Part 6 — Payment and proof

An approved mock grant can be paid through Nessie.

If retained, Solana can record a privacy-safe test transaction receipt.

##### Part 7 — Final patient view

The patient returns to their dashboard and sees the complete financial picture.

They can distinguish between confirmed savings, pending applications, payments, and the remaining amount owed.

**The key demonstration is not that TrumpCare independently makes the bill disappear. It is that multiple disconnected processes can be coordinated through one patient experience.**

---

### 15. What Would Make This Different From Existing Healthcare Assistance Tools?

There are already organizations and products that help patients locate charity care, review bills, and prepare applications.

Therefore, we should not claim to have invented the concept of healthcare financial navigation.

The potential differentiation comes from the combination of:

##### A persistent patient-controlled case

Rather than helping with one application and ending the interaction, TrumpCare maintains an ongoing record of financial assistance efforts.

##### Reusable verified evidence

Patients shouldn't have to repeatedly collect the same documents.

Information carries its source and verification status, and can be reused when another program accepts it.

##### Multiple independent decision-makers

Hospitals, charities, insurers, and other organizations can remain independent while the patient sees a coordinated process.

##### CareCard-assisted hospital onboarding

At participating hospitals, patients could establish the connection to their financial assistance case during the original visit.

##### Coordinated financial outcomes

The platform distinguishes bill reductions, grant payments, insurance adjustments, and patient payments.

It can show how those events affect the remaining balance without double-counting assistance.

##### An accessible experience

Patients can use a personal device, a shared kiosk, or a staff-assisted workflow.

The physical CareCard provides an alternative to requiring every patient to manage a conventional online account.

**This is the proposed differentiator. We still need to validate whether it is sufficiently original and useful compared with existing services.**

---

### 16. Major Questions We Still Haven't Answered

This section is especially important.

We should not present the project as if all major product, technical, and institutional problems have been solved.

#### A. Hospital adoption

- Will hospitals actually want to use TrumpCare?
- Who at the hospital would operate the staff interface?
- What incentive would justify the additional workflow?
- Would hospitals permit patients to associate visits with an external platform?
- How much integration would eventually be necessary?
- Could the independent product become useful enough without hospital partnerships?

We have discussed the possible value of hospital participation, but no real partnership has been established.

#### B. Source-of-truth verification

- What evidence is sufficient to treat a medical bill as authentic?
- How would we confirm the provider's current balance without an integration?
- How do we detect altered documents?
- How do we reconcile conflicting hospital and insurer records?
- Who can update a verified balance?
- How long should verified records remain valid?

A hospital-attested record is stronger evidence than a random patient upload, but it is not automatically error-free.

#### C. Automatic application submission

This could be the single hardest product challenge.

Different assistance programs use different application methods.

Some may accept online submissions. Others require specific portals, printed documents, signatures, or manual review.

We have not yet determined:

- Which programs we can actually submit to automatically.
- Whether an authorized API exists.
- Whether submitting on a patient's behalf is permitted.
- How patient consent would work.
- How we obtain reliable submission confirmations.
- How we track decisions without partner integrations.
- How appeals and missing-document requests are handled.

A completed PDF is not equivalent to an accepted application.

We must not promise automatic submissions everywhere.

#### D. Eligibility screening

- Which programs should TrumpCare support first?
- How do we maintain current eligibility policies?
- How do we handle changing income requirements?
- What happens when information is incomplete?
- How do we handle exceptions and discretionary decisions?
- What happens when two programs have conflicting requirements?
- How do we avoid giving someone false confidence that they qualify?

The platform can identify possible eligibility, but the external organization determines actual eligibility.

#### E. Financial assistance coordination

- Can different assistance programs be used together?
- Which funding sources reduce the bill versus make a payment?
- Do some programs prohibit overlapping assistance?
- What happens if a decision arrives after another payment?
- How are refunds, reversals, and corrections handled?
- Who confirms that a grant has actually been applied?

The funding process cannot simply subtract every potential award from the patient's bill.

#### F. Community fund governance

- Should TrumpCare operate its own fund at all?
- Who would supply the money?
- Who would legally administer the funds?
- Who decides eligibility?
- How would fraud be prevented?
- Should grants be paid directly to verified providers?
- How should limited funding be allocated?

We should not assume an unlimited or imaginary source of funding.

#### G. Identity and enrollment

- Does every patient need an account?
- Can patients receive a CareCard without an email address?
- What verification is necessary during enrollment?
- What happens if a patient loses their card?
- How do we protect records on shared kiosks?
- What happens when a patient cannot produce conventional identification?
- How should representatives or family members be authorized?

We have a proposed direction, not a complete identity system.

#### H. Privacy and security

We would eventually need to resolve:

- What personal information is actually necessary.
- Consent and data-sharing permissions.
- Encryption and access controls.
- Staff and administrator authentication.
- Data retention and deletion.
- Security auditing.
- Potential HIPAA applicability and other privacy obligations.
- Rules governing actual patient data and financial transactions.

The hackathon demonstration should use fictional information.

#### I. The CareCard's long-term purpose

We need to determine whether the CareCard is:

- Mainly a convenient login and case retrieval device.
- A way for hospitals to associate visits with a patient case.
- A portable identity mechanism across participating institutions.
- Or a combination of these functions.

Its value should justify the physical hardware.

A patient should still be able to access assistance without possessing a CareCard.

#### J. The business model

This is almost entirely unresolved.

Possibilities include:

- A free patient-facing service supported by partners.
- Software sold to hospitals and financial counseling organizations.
- Nonprofit operation.
- Grants or institutional funding.
- A hybrid model.

We have not established whether the product would be commercially viable or who would be willing to pay.

#### K. The true scope of the MVP

We have not finalized which parts of the redesigned system are essential for the hackathon.

A possible focused demonstration would include:

1. One CareCard-connected hospital encounter.
2. One reusable patient assistance profile.
3. A small directory of real, sourced assistance policies.
4. Preliminary eligibility screening.
5. Application packet generation.
6. A simulated external approval.
7. An updated bill balance.
8. An optional mock grant payment.

But this scope has not been agreed upon.

---

### 17. What We Have Actually Agreed On

The following principles are the clearest outcomes of our discussions so far.

**1. TrumpCare should primarily be a centralizer.**
Its job is to reduce the difficulty of navigating multiple healthcare financial assistance systems.

**2. We should prioritize existing assistance before inventing new funding.**
The product should help patients access real programs rather than depend entirely on a community donation pool.

**3. The OSAP analogy is useful.**
We want the simplicity of one intake and coordinated financial aid, but we do not have OSAP's government authority or verification infrastructure.

**4. The patient should not have to manage every program manually.**
TrumpCare should reuse information and coordinate as much of the process as legitimately possible.

**5. Hospitals should be optional partners.**
The product should offer independent value, with improved verification and workflow when institutions participate.

**6. The CareCard should connect to a backend record.**
It should not physically store sensitive medical or financial information.

**7. Same-day hospital scanning is the preferred partnered experience.**
A patient should be able to associate their visit with TrumpCare during care rather than return specifically for verification later.

**8. Source-of-truth information matters.**
Uploaded documents and official records must not be treated as equally reliable.

**9. AI should assist, not become the decision-making authority.**
Gemini is most useful for document understanding, program discovery, and application preparation.

**10. Funding decisions belong to the responsible organizations.**
TrumpCare coordinates assistance; it doesn't acquire independent authority over every hospital, nonprofit, or government fund.

**11. The project should support kiosk and laptop experiences.**
The interface should adapt to patients, staff, and administrators.

**12. The concept is still evolving.**
We have not finalized the verification model, application engine, funding structure, partner strategy, or implementation scope.

---

### 18. The Main Product Risk

The greatest risk is that we accidentally build a visually impressive application that only tells patients what financial assistance they might qualify for.

That would be another informational tool.

Our larger ambition is to **remove actual administrative work from the patient**.

For example, instead of telling someone:

*"You might qualify for hospital financial assistance. Here is a link."*

TrumpCare should ideally be able to say:

*"We identified a program that may apply. Your existing documents cover most of its requirements. We prepared the application. Review the remaining information, authorize submission, and we'll help you track its status."*

That is a meaningful improvement.

But we still have to prove how far the workflow can proceed without institution-specific integrations.

**We should measure success by tasks completed and friction removed, not by how many AI-generated recommendations appear on the screen.**

---

### 19. Long-Term Vision

Imagine a healthcare financial assistance system in which:

A patient visits a participating hospital and presents their CareCard.

Their relevant visit information is linked to their TrumpCare case with appropriate authorization.

When the bill becomes available, TrumpCare helps evaluate it, identify possible discrepancies, screen for existing assistance, and prepare applications.

Programs process those applications under their own rules.

The patient can monitor everything through one interface.

Approved assistance is recorded and reconciled with their outstanding balance.

If a balance remains, TrumpCare helps identify further assistance or payment arrangements.

The patient doesn't have to understand the internal administrative processes of every hospital, insurer, charity, or government program.

The organizations remain independent.

**TrumpCare provides the coordination layer between them.**

That is the long-term vision, not a claim that these integrations or institutional relationships already exist.

---

### 20. Proposed Positioning

##### One-line description

**TrumpCare is a unified platform for finding, applying for, and coordinating medical financial assistance.**

##### Short pitch

Healthcare financial assistance is fragmented. Hospitals, insurers, government programs, and charities operate independently, leaving patients to navigate different eligibility requirements, forms, and application processes.

TrumpCare aims to bring those processes together.

Patients provide their information once, discover relevant assistance, reuse supporting documents, and track applications through one centralized case. Participating hospitals can contribute trusted records through a CareCard-assisted workflow, while patients without hospital partnerships can still use the independent platform.

The result is a more accessible, transparent, and coordinated way to pursue financial assistance for medical expenses.

##### Possible tagline

**One card. One application. Every avenue for care.**

This tagline describes the intended experience, not a guarantee that every existing assistance program can currently be accessed or applied to through TrumpCare.

---

### 21. Final Assessment

The proposed redesign addresses several weaknesses of the original charity-focused concept.

It shifts the product away from an invented pool of money and toward the real challenge of coordinating existing financial assistance.

It gives AI a clearer and more defensible purpose.

It gives the CareCard a more meaningful role.

It introduces a stronger reason for hospitals, financial counselors, and patients to use the same platform.

It also introduces difficult new challenges involving external applications, institutional verification, data access, privacy, and real-world adoption.

**We have not solved all of those challenges.**

We should not assume that hospitals will adopt the product, assistance programs will accept automated submissions, or every patient's financial information can be independently verified.

Those are exactly the assumptions we need to challenge before finalizing the concept.

The direction we are exploring is:

**TrumpCare should not be another organization patients must apply to for help. It should be the system that makes applying to existing organizations simpler.**

If we can demonstrate that convincingly—through real source information, reusable applications, transparent verification, and coordinated outcomes—we will have a much more clearly defined product than the original community-fund concept.

**Current status: Promising direction, significant open questions, final product definition not yet decided.**

---

**Hackathon:** HackUMass XIV, November 2026.

**Affiliation note:** Independent student hackathon project. No affiliation with, endorsement from, or authorization by any political figure, hospital, insurer, government agency, or assistance program is implied.
