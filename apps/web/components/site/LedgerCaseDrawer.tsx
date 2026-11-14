"use client";

import { useEffect, useRef, useState } from "react";
import type { IdentityRevealResponse, LedgerCase } from "@abdulcare/contracts";
import { Icon, SolanaMark } from "@/components/Icon";
import { ApiRequestError, getLedgerCase, revealIdentity } from "@/lib/api";
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
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [identity, setIdentity] = useState<IdentityRevealResponse | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    getLedgerCase(reference)
      .then((r) => setC(r.case))
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
    <dialog ref={dialog} className="lc-drawer" aria-label="Ledger case" onClose={onClose} onCancel={onClose}>
      <header className="lc-head">
        <div>
          <span className="lc-kicker">Case <span className="mono">{reference}</span></span>
          <h2>{c ? c.visit.description : error ? "Case unavailable" : "Loading case…"}</h2>
        </div>
        <button type="button" className="v-quiet v-icon-button" aria-label="Close case" onClick={() => dialog.current?.close()}>
          <Icon name="x" />
        </button>
      </header>

      {error && (
        <div className="notice notice-bad" role="alert"><Icon name="alert" /><span>{error}</span></div>
      )}

      {c && (
        <div className="lc-body">
          <div className="lc-outcome">
            <span className={`chip chip-dot ${declined ? "chip-bad" : "chip-ok"}`}>{declined ? "Declined" : c.status === "paid" ? "Paid to hospital" : "Approved"}</span>
            {sig ? (
              <a className="sig" href={explorerTx(sig)} target="_blank" rel="noreferrer">
                <SolanaMark size={12} /> {declined ? "Decision receipt" : "Payout receipt"} {shortSig(sig)}
              </a>
            ) : (
              <span className="muted">No devnet receipt</span>
            )}
          </div>

          <dl className="lc-totals">
            <div><dt>Cost of care</dt><dd>{usd(c.chargesCents)}</dd></div>
            <div><dt>Insurance paid</dt><dd>{usd(c.insurerPaidCents)}</dd></div>
            <div><dt>Hospital assistance</dt><dd>{usd(c.hospitalAssistanceCents)}</dd></div>
            <div><dt>{declined ? "Fund paid" : "Community fund paid"}</dt><dd>{usd(c.fundPaidCents)}</dd></div>
          </dl>

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
                  <span>{stepLabel(s.label)}{s.simulated && <small> (simulated)</small>}</span>
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
              <div><dt>Region</dt><dd>{c.patient.region ?? "Not shown"}</dd></div>
              <div><dt>Age band</dt><dd>{c.patient.ageBand ?? "Not shown"}</dd></div>
              <div><dt>Household</dt><dd>{c.patient.householdSize ?? "Unknown"}</dd></div>
              <div><dt>Monthly income</dt><dd>{c.patient.monthlyIncomeCents == null ? "Unknown" : usd(c.patient.monthlyIncomeCents)}</dd></div>
              <div><dt>Income vs poverty line</dt><dd>{c.patient.incomePctOfPoverty == null ? "Unknown" : `${c.patient.incomePctOfPoverty}%`}</dd></div>
              <div><dt>Insurance</dt><dd>{c.patient.insurance ? INSURANCE_LABEL[c.patient.insurance] : "Unknown"}</dd></div>
              <div><dt>Fund grants, last 90 days</dt><dd>{c.patient.priorPaidCount90d}</dd></div>
            </dl>
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
                  {identity.identity.fictional ? "Fictional record. " : ""}Revealed by {identity.revealedBy} at {new Date(identity.revealedAt).toLocaleString()}; this reveal is logged.
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
