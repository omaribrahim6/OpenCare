"use client";

import { useEffect, useRef, useState } from "react";
import type { CaseInsight, DonorKind, IdentityRevealResponse, LedgerCase, LedgerDonation, OrganizationProfile } from "@abdulcare/contracts";
import { Icon, SolanaMark } from "@/components/Icon";
import { ApiRequestError, getLedgerDetail, revealIdentity } from "@/lib/api";
import { explorerTx, shortDate, shortSig, stepLabel, usd } from "@/lib/format";
import { CATEGORY_LABEL, INSURANCE_LABEL } from "@/lib/types";

// One public ledger case in full: what care cost, the itemized bill, what insurance and the
// hospital covered, the need score and the decision, tied to its devnet receipt. Identity is
// hidden; a paired caseworker device can reveal it, and every reveal is logged and counted here.

const POLICY_STATUS: Record<string, string> = {
  approved_simulated: "Approved",
  denied_simulated: "Didn't apply",
  submitted_simulated: "Submitted",
  prepared: "Prepared",
};

export function LedgerCaseDrawer({ reference, onClose }: { reference: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [c, setC] = useState<LedgerCase | null>(null);
  const [donation, setDonation] = useState<LedgerDonation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [identity, setIdentity] = useState<IdentityRevealResponse | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    getLedgerDetail(reference)
      .then((r) => {
        setC(r.case ?? null);
        setDonation(r.donation ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [reference]);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    try {
      const r = await revealIdentity(reference, reason);
      setIdentity(r);
      setC((prev) => (prev ? { ...prev, identityReveals: r.identityReveals } : prev));
    } catch (e) {
      setRevealError(
        e instanceof ApiRequestError && (e.status === 401 || e.status === 403)
          ? "Only a caseworker device can reveal identity. Pair this browser as a reviewer at /pair."
          : (e as Error).message,
      );
    } finally {
      setRevealing(false);
    }
  }

  const declined = c?.status === "rejected";
  const sig = c?.payout.solanaSignature ?? null;

  return (
    <dialog ref={dialog} className="lc-drawer" aria-label="Ledger details" onClose={onClose} onCancel={onClose}>
      <header className="lc-head">
        <div>
          <span className="lc-kicker">{donation ? "Donation" : "Case"} <span className="mono">{reference}</span></span>
          <h2>
            {c ? c.visit.description : donation ? `${usd(donation.amountCents)} from ${donation.donor.name}` : error ? "Not available" : "Loading…"}
          </h2>
        </div>
        <button type="button" className="v-quiet v-icon-button" aria-label="Close details" onClick={() => dialog.current?.close()}>
          <Icon name="x" />
        </button>
      </header>

      {error && (
        <div className="notice notice-bad" role="alert"><Icon name="alert" /><span>{error}</span></div>
      )}

      {donation && <DonationBody d={donation} />}

      {c && (
        <div className="lc-body">
          <div className="lc-outcome">
            <span className={`chip chip-dot ${declined ? "chip-bad" : "chip-ok"}`}>{declined ? "Declined" : c.status === "paid" ? "Paid to hospital" : "Approved"}</span>
            {sig ? (
              <a className="sig" href={explorerTx(sig)} target="_blank" rel="noreferrer">
                <SolanaMark size={12} /> {declined ? "Decision receipt" : "Payout receipt"} {shortSig(sig)}
              </a>
            ) : (
              <span className="muted">No Solana receipt</span>
            )}
          </div>

          <dl className="lc-totals">
            <div><dt>Cost of care</dt><dd>{usd(c.chargesCents)}</dd></div>
            <div><dt>Insurance paid</dt><dd>{usd(c.insurerPaidCents)}</dd></div>
            <div><dt>Hospital assistance</dt><dd>{usd(c.hospitalAssistanceCents)}</dd></div>
            <div><dt>{declined ? "Fund paid" : "Community fund paid"}</dt><dd>{usd(c.fundPaidCents)}</dd></div>
          </dl>

          {c.insight && <InsightSection insight={c.insight} />}

          <section className="lc-section">
            <h3><Icon name="hospital" /> Visit</h3>
            <p className="lc-meta">
              {c.visit.hospital.name} · {CATEGORY_LABEL[c.visit.category] ?? c.visit.category} · {shortDate(c.visit.date)} · attested by {c.visit.attestedBy}
            </p>
            {c.suspicious && (
              <div className="notice notice-warn" role="note">
                <Icon name="alert" />
                <span><strong>Flagged:</strong> the visit text tried to instruct the review system (&ldquo;{c.suspicious.excerpt}&rdquo;). It changed nothing.</span>
              </div>
            )}
          </section>

          <section className="lc-section">
            <h3><Icon name="bill" /> Itemized bill</h3>
            <table className="table lc-table">
              <tbody>
                {c.visit.lineItems.map((li, i) => (
                  <tr key={i}><td>{li.description}</td><td className="right num">{usd(li.cents)}</td></tr>
                ))}
                <tr className="lc-total-row"><td>Total charges</td><td className="right num">{usd(c.visit.totalCents)}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="lc-section">
            <h3><Icon name="layers" /> How the bill came down</h3>
            <ol className="lc-steps">
              {c.steps.map((s, i) => (
                <li key={i}>
                  <span>{stepLabel(s.label)}</span>
                  <span className="num">{i === 0 ? usd(s.balanceCents) : `−${usd(s.reductionCents)}`}</span>
                  <span className="num muted">{usd(s.balanceCents)} left</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="lc-section">
            <h3><Icon name="shield" /> Insurance</h3>
            {c.plan ? (
              <p className="lc-meta">
                {c.plan.payerName}: deductible {usd(c.plan.deductibleCents)}, {c.plan.coinsurancePct}% coinsurance, out-of-pocket max {usd(c.plan.outOfPocketMaxCents)}.
                {c.insurance && <> Patient share {usd(c.insurance.patientResponsibilityCents)}; insurer paid {usd(c.insurance.insurerPaysCents)}.</>}
              </p>
            ) : (
              <p className="lc-meta">No insurance on file (self-pay).</p>
            )}
          </section>

          {c.applications.length > 0 && (
            <section className="lc-section">
              <h3><Icon name="landmark" /> Hospital assistance policies</h3>
              <ul className="lc-policies">
                {c.applications.map((a, i) => (
                  <li key={i}>
                    <div className="lc-row">
                      <strong>{a.name}</strong>
                      <span className={`chip ${a.reductionCents > 0 ? "chip-ok" : "chip-line"}`}>{POLICY_STATUS[a.status] ?? a.status}</span>
                      <span className="num">{a.reductionCents > 0 ? `−${usd(a.reductionCents)}` : "—"}</span>
                    </div>
                    <small className="muted">{a.criteria.map((k) => k.detail).join(" · ")} · {a.source}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="lc-section">
            <h3><Icon name="users" /> Patient (no identity)</h3>
            <dl className="lc-facts">
              <div><dt>Work situation</dt><dd>{c.patient.employment ?? "Not on file"}</dd></div>
              <div><dt>Region</dt><dd>{c.patient.region ?? "Not shown"}</dd></div>
              <div><dt>Age band</dt><dd>{c.patient.ageBand ?? "Not shown"}</dd></div>
              <div><dt>Household</dt><dd>{c.patient.householdSize ?? "Unknown"}</dd></div>
              <div><dt>Monthly income</dt><dd>{c.patient.monthlyIncomeCents == null ? "Unknown" : usd(c.patient.monthlyIncomeCents)}</dd></div>
              <div><dt>Income vs poverty line</dt><dd>{c.patient.incomePctOfPoverty == null ? "Unknown" : `${c.patient.incomePctOfPoverty}%`}</dd></div>
              <div><dt>Insurance</dt><dd>{c.patient.insurance ? INSURANCE_LABEL[c.patient.insurance] : "Unknown"}</dd></div>
              <div><dt>Fund grants, last 90 days</dt><dd>{c.patient.priorPaidCount90d}</dd></div>
            </dl>
            {c.hardshipNote && (
              <blockquote className="lc-note">
                <small className="muted">Patient&apos;s note</small>
                <br />
                {c.hardshipNote}
              </blockquote>
            )}
          </section>

          {c.need && (
            <section className="lc-section">
              <h3><Icon name="gauge" /> Need score {c.need.score}/100 <small className="muted">({c.need.formulaVersion})</small></h3>
              <ul className="lc-factors">
                {c.need.factors.map((f) => (
                  <li key={f.key}>
                    <span>{f.label}</span>
                    <span className="muted">{f.input}</span>
                    <span className="num">{f.points}/{f.maxPoints}</span>
                  </li>
                ))}
              </ul>
              {c.need.incomeMismatch && <p className="lc-meta"><Icon name="alert" /> Reported income and bank deposits disagree.</p>}
            </section>
          )}

          <section className="lc-section">
            <h3><Icon name="scale" /> Decision</h3>
            <p className="lc-meta">
              Requested {usd(c.decision.requestedCents)} on {shortDate(c.decision.requestedAt)}
              {c.decision.decidedAt && <>; decided {shortDate(c.decision.decidedAt)}</>}
              {c.decision.approvedCents != null && <>; approved {usd(c.decision.approvedCents)}</>}.
            </p>
            {c.decision.note && <blockquote className="lc-note">{c.decision.note}</blockquote>}
            {c.decision.approvals.length > 0 && (
              <p className="lc-meta">
                Approved by {c.decision.approvals.map((a) => a.reviewerLabel).join(" and ")}
                {c.decision.approvals.length > 1 ? " (two caseworkers, as required above $500)" : ""}.
              </p>
            )}
            {c.payout.nessiePaymentId && <p className="lc-meta">Bank transfer to the hospital: <span className="mono">{c.payout.nessiePaymentId}</span></p>}
          </section>

          <section className="lc-section">
            <h3><Icon name="store" /> {declined ? "Hospital that billed" : "Paid to"}</h3>
            <OrgFacts org={c.hospital} />
          </section>

          <section className="lc-section">
            <h3><Icon name="wallet" /> Paid from</h3>
            <dl className="lc-facts">
              <div><dt>Fund</dt><dd>{c.payer.name}</dd></div>
              <div><dt>Nessie fund account</dt><dd className="mono lc-wrap">{c.payer.nessieAccountId ?? "Not shown"}</dd></div>
              <div className="lc-full"><dt>Solana treasury</dt><dd className="mono lc-wrap">{c.payer.treasuryAddress ?? "Not shown"}</dd></div>
            </dl>
          </section>

          <section className="lc-section lc-identity">
            <h3><Icon name="lock" /> Identity</h3>
            <p className="lc-meta">
              Name, date of birth, SSN and address are kept private in the fund&apos;s database and never put on-chain.
              Caseworkers can reveal them for an audit; {c.identityReveals === 0 ? "no one has" : `caseworkers have done so ${c.identityReveals} time${c.identityReveals === 1 ? "" : "s"}`}.
            </p>
            {identity ? (
              <dl className="lc-facts lc-revealed">
                <div><dt>Legal name</dt><dd>{identity.identity.legalName}</dd></div>
                <div><dt>Date of birth</dt><dd>{identity.identity.dateOfBirth}</dd></div>
                <div><dt>SSN</dt><dd className="mono">{identity.identity.ssn}</dd></div>
                <div><dt>Address</dt><dd>{identity.identity.address ?? "Not on file"}</dd></div>
                <div><dt>Phone</dt><dd>{identity.identity.phone ?? "Not on file"}</dd></div>
                <div><dt>Member ID</dt><dd>{identity.identity.memberId ?? "None"}</dd></div>
                <p className="muted lc-small">
                  Revealed by {identity.revealedBy} at {new Date(identity.revealedAt).toLocaleString()}; this reveal is logged.
                </p>
              </dl>
            ) : (
              <div className="lc-reveal">
                <input
                  className="input"
                  placeholder="Reason for the audit (logged)"
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Reason for revealing identity"
                />
                <button type="button" className="btn btn-sm" onClick={reveal} disabled={revealing}>
                  <Icon name="eye" /> {revealing ? "Revealing…" : "Reveal identity (caseworker)"}
                </button>
              </div>
            )}
            {revealError && <p className="lc-error" role="alert">{revealError}</p>}
          </section>
        </div>
      )}
    </dialog>
  );
}

const DONOR_KIND: Record<DonorKind, string> = {
  state_program: "State program",
  federal_program: "Federal program",
  hospital: "Hospital (community benefit)",
  foundation: "Foundation",
  corporate: "Company",
  community: "Community group",
  individual: "Individual",
};

const URGENCY: Record<CaseInsight["urgency"], string> = {
  critical: "chip-bad",
  high: "chip-warn",
  moderate: "chip-info",
  low: "chip-line",
};

export function InsightSection({ insight }: { insight: CaseInsight }) {
  return (
    <section className="lc-section lc-insight">
      <h3><Icon name="sparkles" /> Triage insight</h3>
      <div className="lc-tags">
        <span className={`chip chip-dot ${URGENCY[insight.urgency]}`}>{insight.urgency[0].toUpperCase() + insight.urgency.slice(1)} urgency</span>
        {insight.labels.map((l) => <span key={l} className="chip chip-line">{l}</span>)}
      </div>
      <p className="lc-meta">{insight.summary}</p>
      {insight.considerations.length > 0 && (
        <ul className="lc-bullets">
          {insight.considerations.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <p className="lc-meta"><strong>Suggested:</strong> {insight.recommendationText}</p>
      <small className="muted">Computed from the case data by the published rules. Advice only; a caseworker decides.</small>
    </section>
  );
}

function OrgFacts({ org }: { org: OrganizationProfile }) {
  return (
    <>
      <p className="lc-meta"><strong>{org.name}</strong>{org.description ? ` · ${org.description}` : ""}</p>
      <dl className="lc-facts">
        <div><dt>Type</dt><dd>{org.nonprofit == null ? org.kind : org.nonprofit ? `Nonprofit ${org.kind}` : `For-profit ${org.kind}`}</dd></div>
        <div><dt>Beds</dt><dd>{org.beds ?? "Not listed"}</dd></div>
        <div className="lc-full"><dt>Address</dt><dd>{org.address ?? "Not listed"}</dd></div>
        <div><dt>EIN</dt><dd className="mono">{org.ein ?? "Not listed"}</dd></div>
        <div><dt>NPI</dt><dd className="mono">{org.npi ?? "Not listed"}</dd></div>
        <div><dt>Phone</dt><dd>{org.phone ?? "Not listed"}</dd></div>
        <div><dt>Website</dt><dd className="lc-wrap">{org.website ?? "Not listed"}</dd></div>
        <div><dt>Fund payouts received</dt><dd>{usd(org.totalReceivedCents)} ({org.payoutCount})</dd></div>
        <div><dt>Nessie merchant</dt><dd className="mono lc-wrap">{org.nessieMerchantId ?? "None"}</dd></div>
        <div className="lc-full"><dt>Solana wallet</dt><dd className="mono lc-wrap">{org.solanaWallet ?? "None"}</dd></div>
      </dl>
    </>
  );
}

function DonationBody({ d }: { d: LedgerDonation }) {
  const o = d.donor;
  return (
    <div className="lc-body">
      <div className="lc-outcome">
        <span className="chip chip-dot chip-ok">Received</span>
        {d.solanaSignature ? (
          <a className="sig" href={explorerTx(d.solanaSignature)} target="_blank" rel="noreferrer">
            <SolanaMark size={12} /> Donation receipt {shortSig(d.solanaSignature)}
          </a>
        ) : (
          <span className="muted">No Solana receipt</span>
        )}
      </div>
      <dl className="lc-totals">
        <div><dt>Amount</dt><dd>{usd(d.amountCents)}</dd></div>
        <div><dt>Date</dt><dd>{shortDate(d.at)}</dd></div>
        <div><dt>Given by this donor in total</dt><dd>{usd(o.totalGivenCents)}</dd></div>
        <div><dt>Gifts from this donor</dt><dd>{o.giftCount}</dd></div>
      </dl>

      <section className="lc-section">
        <h3><Icon name="heart" /> Donor</h3>
        <p className="lc-meta"><strong>{o.name}</strong> · {DONOR_KIND[o.kind]}</p>
        {o.description && <p className="lc-meta">{o.description}</p>}
        {o.anonymous ? (
          <p className="lc-meta muted">This donor asked not to be named. The amount, date and receipts stay public.</p>
        ) : (
          <dl className="lc-facts">
            <div><dt>EIN</dt><dd className="mono">{o.ein ?? "Not applicable"}</dd></div>
            <div><dt>Contact</dt><dd>{o.contact ?? "Not listed"}</dd></div>
            <div className="lc-full"><dt>Address</dt><dd>{o.address ?? "Not listed"}</dd></div>
            <div><dt>Website</dt><dd className="lc-wrap">{o.website ?? "Not listed"}</dd></div>
            <div><dt>Giving since</dt><dd>{o.firstGiftAt ? shortDate(o.firstGiftAt) : "Unknown"}</dd></div>
          </dl>
        )}
      </section>

      {d.purpose && (
        <section className="lc-section">
          <h3><Icon name="info" /> Purpose</h3>
          <blockquote className="lc-note">{d.purpose}</blockquote>
        </section>
      )}

      <section className="lc-section">
        <h3><Icon name="receipt" /> Proof</h3>
        <dl className="lc-facts">
          <div><dt>Paid by</dt><dd>{d.rail === "nessie" ? "Bank transfer" : "Devnet SOL"}</dd></div>
          <div><dt>Nessie deposit</dt><dd className="mono lc-wrap">{d.nessieDepositId ?? "None"}</dd></div>
          <div className="lc-full"><dt>Solana receipt</dt><dd className="mono lc-wrap">{d.solanaSignature ?? "Pending"}</dd></div>
        </dl>
      </section>

      <section className="lc-section">
        <h3><Icon name="wallet" /> Received by</h3>
        <dl className="lc-facts">
          <div><dt>Fund</dt><dd>{d.fund.name}</dd></div>
          <div><dt>Available to grant today</dt><dd>{usd(d.fund.availableCents)}</dd></div>
          <div><dt>Nessie fund account</dt><dd className="mono lc-wrap">{d.fund.nessieAccountId ?? "Not shown"}</dd></div>
          <div className="lc-full"><dt>Solana treasury</dt><dd className="mono lc-wrap">{d.fund.treasuryAddress ?? "Not shown"}</dd></div>
        </dl>
      </section>
    </div>
  );
}
