"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { LoadError, NoSession } from "@/components/NoSession";
import { ReadAloud } from "@/components/ReadAloud";
import { applyForDemoSavings, getPatientWorkspace, isNoSession, LIVE } from "@/lib/api";
import { cleanName, explorerTx, shortDate, usd } from "@/lib/format";
import type { Bill, InsurancePlan, PatientBillResponse } from "@/lib/rev6";
import { POLICY_STATUS_LABEL } from "@/lib/rev6";
import { InsuranceProfile } from "./InsuranceProfile";
import { RequestHelpForm } from "./RequestHelpForm";

const IN_FLIGHT = ["pending_review", "approved", "payment_pending"];

type VisitData = PatientBillResponse & { bill: Bill };
type State =
  | { phase: "loading" | "no_session" | "error" }
  | { phase: "ready"; visits: VisitData[]; plan: InsurancePlan | null };

function visitStatus({ bill, grant }: VisitData) {
  if (bill.remainingCents === 0) return bill.patientPaidCents > 0 ? "Paid" : "Fully covered";
  if (grant && IN_FLIGHT.includes(grant.status)) return "Fund request pending";
  if (bill.pendingCents > 0 || bill.applications.some((a) => a.status === "submitted_simulated")) return "Coverage pending";
  if (bill.chargesCents > bill.remainingCents) return "Partially covered";
  return "No coverage yet";
}

function visitHref(demo: boolean, params: Record<string, string> = {}) {
  const query = new URLSearchParams(demo ? { ...params, demo: "1" } : params).toString();
  return query ? `/kiosk/bill?${query}` : "/kiosk/bill";
}

export function BillView({ visitId, showInsurance, demo }: { visitId?: string; showInsurance: boolean; demo: boolean }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const version = useRef(0);
  const load = useCallback(async (background = false) => {
    const request = ++version.current;
    try {
      const { visits, plan } = await getPatientWorkspace(demo);
      if (request !== version.current) return;
      setState({ phase: "ready", visits: visits.filter((visit): visit is VisitData => visit.bill !== null), plan });
    } catch (error) {
      if (request !== version.current) return;
      if (isNoSession(error)) setState({ phase: "no_session" });
      else if (!background) setState({ phase: "error" });
    }
  }, [demo]);
  useEffect(() => {
    void load();
    return () => { version.current++; };
  }, [load]);

  const waiting = state.phase === "ready" && state.visits.some(({ bill, grant }) =>
    bill.pendingCents > 0 || (grant && IN_FLIGHT.includes(grant.status)),
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(true), 4000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  if (state.phase === "loading") return <p role="status" className="patient-panel">Loading your visits…</p>;
  if (state.phase === "no_session") return <NoSession />;
  if (state.phase !== "ready") return <LoadError message="We couldn't load your visits." onRetry={() => void load()} />;

  const selected = state.visits.find(({ bill }) => bill.visit.id === visitId);
  return (
    <div className="patient-workspace">
      {(demo || !LIVE) && <p className="patient-demo muted"><Icon name="info" size={15} /> Demo · fictional data and simulated requests</p>}
      {showInsurance ? (
        <InsuranceProfile demo={demo} plan={state.plan} onSave={() => void load(true)} />
      ) : selected ? (
        <VisitBill demo={demo} key={selected.bill.visit.id} data={selected} refresh={load} />
      ) : (
        <>
          <header className="patient-list-heading"><h1>My visits</h1>{state.visits.length > 0 && <span>{state.visits.length} {state.visits.length === 1 ? "visit" : "visits"}</span>}</header>
          {visitId && <p role="status">That bill is unavailable in this session.</p>}
          {!state.visits.length && <p className="patient-panel">Visits appear here after hospital staff log them with your CareCard.</p>}
          <ul className="patient-visits">
            {state.visits.map((data) => {
              const { bill } = data;
              return (
                <li key={bill.visit.id}>
                  <Link className="patient-visit" href={visitHref(demo, { visit: bill.visit.id })}>
                    <span className="patient-visit-icon"><Icon name="hospital" size={22} /></span>
                    <span className="patient-visit-info">
                      <strong>{cleanName(bill.visit.hospital.name)}</strong>
                      <small>{shortDate(bill.visit.date)} · {bill.visit.description}</small>
                      <span className="patient-status" data-paid={bill.remainingCents === 0}>{visitStatus(data)}</span>
                    </span>
                    <span className="patient-visit-amount"><strong>{usd(bill.remainingCents)}</strong><small>Balance</small></span>
                    <Icon name="chevronRight" size={16} className="patient-chevron" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Coverage({ bill, grant }: VisitData) {
  const [selected, setSelected] = useState("remaining");
  const pending = (type: Bill["events"][number]["type"]) =>
    bill.events.filter((event) => event.type === type && event.status === "pending").reduce((total, event) => total + event.amountCents, 0);
  const pendingFund = pending("fund_grant") || (grant && IN_FLIGHT.includes(grant.status) ? grant.approvedCents ?? grant.requestedCents : 0);
  const parts = [
    { id: "insurance", label: "Insurance", cents: bill.insurerPaidCents, waiting: pending("insurance_adjustment"), detail: bill.plan ? `Coverage from ${cleanName(bill.plan.payerName)}.` : "No insurance plan was used for this visit." },
    { id: "hospital", label: "Hospital assistance", cents: bill.hospitalAssistanceCents, waiting: pending("hospital_assistance"), detail: "Savings approved by the hospital in this simulation." },
    { id: "fund", label: "Community care", cents: bill.fundPaidCents, waiting: pendingFund, detail: "Grants paid directly to the hospital." },
    ...(bill.patientPaidCents > 0 ? [{ id: "payment", label: "You paid", cents: bill.patientPaidCents, waiting: 0, detail: "Payments you already made toward this visit." }] : []),
    { id: "remaining", label: "Still owed", cents: bill.remainingCents, waiting: 0, detail: "Your balance after confirmed coverage and payments." },
  ];
  const active = parts.find((part) => selected === part.id) ?? parts[parts.length - 1];
  return (
    <section className="patient-panel patient-coverage" aria-labelledby="coverage-title">
      <div className="patient-section-header">
        <h2 id="coverage-title">Bill breakdown</h2>
        <span>{usd(bill.chargesCents)} original bill</span>
      </div>
      <div className="patient-bar" role="group" aria-label="Bill coverage breakdown">
        {parts.filter(({ cents }) => cents > 0).map(({ id, label, cents }) => (
          <button
            type="button"
            key={id}
            data-part={id}
            aria-label={`${label}, ${usd(cents)}`}
            aria-pressed={id === active.id}
            onClick={() => setSelected(id)}
            style={{ flexGrow: cents }}
          />
        ))}
      </div>
      <div className="patient-legend">
        {parts.map(({ id, label, cents, waiting }) => (
          <button type="button" key={id} aria-pressed={id === active.id} onClick={() => setSelected(id)}>
            <span className="patient-dot" data-part={id} />
            <span>{label}<strong>{usd(waiting > 0 && cents === 0 ? waiting : cents)}</strong>{waiting > 0 && <small>{cents === 0 ? "Pending" : `${usd(waiting)} pending`}</small>}</span>
          </button>
        ))}
      </div>
      <p className="patient-coverage-detail" aria-live="polite">
        <strong>{active.label}</strong> · {active.detail}
        {active.waiting > 0 && ` ${usd(active.waiting)} is pending.`}
      </p>
    </section>
  );
}

function VisitBill({ data, refresh, demo }: { data: VisitData; refresh: () => Promise<void>; demo: boolean }) {
  const { bill, explanation, grant } = data;
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const eligible = bill.applications.filter((a) => a.status === "prepared" && a.evaluation.eligible && a.evaluation.reductionCents > 0);
  const approvals = bill.applications.filter((a) => a.status === "approved_simulated");
  const pendingPolicy = bill.applications.some((a) => a.status === "submitted_simulated");
  const canApply = (demo || !LIVE) && !grant && bill.remainingCents > 0 && eligible.length > 0;
  const estimated = eligible.reduce((total, application) => total + application.evaluation.reductionCents, 0);
  const receipt = grant?.status === "paid" ? grant.receipt : null;

  return (
    <>
      <Link href={visitHref(demo)} className="patient-back"><Icon name="arrowLeft" size={16} /> All visits</Link>
      <article className="patient-visit-sheet">
        <header className="patient-visit-heading">
          <div>
            <h1>{cleanName(bill.visit.hospital.name)}</h1>
            <p className="patient-visit-subtitle">{bill.visit.description} · {shortDate(bill.visit.date)}</p>
          </div>
          <Icon name="hospital" size={28} />
        </header>
        <div className="patient-balance" aria-live="polite" aria-label="Visit balance">
          <div><span>Remaining balance</span><strong>{usd(bill.remainingCents)}</strong></div>
          <span className="patient-status" data-paid={bill.remainingCents === 0}>{visitStatus(data)}</span>
        </div>
        <Coverage {...data} />
      </article>

      {canApply && (
        <section className="patient-panel patient-action" aria-labelledby="savings-title">
          <h2 id="savings-title">Save {usd(estimated)} on this bill</h2>
          <ul className="patient-lines">
            {eligible.map((application) => (
              <li key={application.id}>
                <span>{application.policy.name}</span><strong>{usd(application.evaluation.reductionCents)}</strong>
              </li>
            ))}
          </ul>
          <p className="muted">Apply for all eligible policies in one step. The hospital decisions are simulated.</p>
          <button type="button" className="btn" disabled={applying} onClick={async () => {
            setApplying(true);
            setError(null);
            try {
              await applyForDemoSavings(bill.visit.id);
              await refresh();
              setApplied(true);
            } catch (error) {
              setError(error instanceof Error ? error.message : "We couldn't apply for savings. Try again.");
            } finally {
              setApplying(false);
            }
          }}>
            {applying ? "Submitting applications…" : "Apply for savings"} <Icon name="arrowRight" />
          </button>
          {error && <p role="alert">{error}</p>}
        </section>
      )}

      {pendingPolicy && <p className="patient-panel" role="status">Hospital assistance is pending a simulated decision.</p>}

      {!canApply && !pendingPolicy && !grant && bill.remainingCents > 0 && (
        <section className="patient-panel patient-action">
          <h2>Get help with the rest</h2>
          <p className="muted">Ask the community care fund to cover {usd(bill.remainingCents)}. A reviewer will look at your request.</p>
          <RequestHelpForm demo={demo} visitId={bill.visit.id} remainingCents={bill.remainingCents} onSent={() => void refresh()} />
        </section>
      )}

      {grant && (
        <section className="patient-panel patient-request" aria-live="polite">
          <span className="patient-request-icon"><Icon name={grant.status === "paid" ? "checkCircle" : "heart"} size={22} /></span>
          <div>
            <h2>Community care request</h2>
            {grant.status === "pending_review" && <p>Request sent for {usd(grant.requestedCents)}. A reviewer will look at it.</p>}
            {(grant.status === "approved" || grant.status === "payment_pending") && <p>Approved. Hospital payment is pending.</p>}
            {grant.status === "paid" && <p>The fund paid {usd(grant.approvedCents)} directly to the hospital.</p>}
            {grant.status === "rejected" && <p>The fund declined this request. Ask the hospital about other payment options.</p>}
            {grant.status === "canceled" && <p>This request was cancelled.</p>}
            {receipt?.nessiePaymentId && <p className="muted">Payment reference {receipt.nessiePaymentId}</p>}
            {receipt?.solanaSignature && (LIVE && !demo ? (
              <a href={receipt.explorerUrl ?? explorerTx(receipt.solanaSignature)} target="_blank" rel="noreferrer">View public receipt</a>
            ) : <p className="muted">Demo receipt recorded</p>)}
          </div>
        </section>
      )}

      <div className="patient-visit-details">
        {approvals.length > 0 && (
          <details className="patient-details">
            <summary><Icon name="shield" size={18} /> {applied ? "Savings applied" : "Hospital savings"} <Icon name="chevronDown" size={16} /></summary>
            <ul className="patient-lines">
              {approvals.map((application) => (
                <li key={application.id}>
                  <span>{application.policy.name}<small>{POLICY_STATUS_LABEL[application.status]}</small></span>
                  <strong>{usd(application.reductionCents)}</strong>
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="patient-details">
          <summary><Icon name="receipt" size={18} /> Itemized charges <Icon name="chevronDown" size={16} /></summary>
          <ul className="patient-lines">
            {bill.visit.lineItems.map((item, index) => <li key={index}><span>{item.description}</span><strong>{usd(item.cents)}</strong></li>)}
          </ul>
        </details>
        {explanation && (
          <details className="patient-details">
            <summary><Icon name="speaker" size={18} /> Bill explanation <Icon name="chevronDown" size={16} /></summary>
            <p>{explanation.summary}</p>
            <ul>{explanation.points.map((point) => <li key={point}>{point}</li>)}</ul>
            <ReadAloud text={[explanation.summary, ...explanation.points].join(" ")} />
          </details>
        )}
      </div>
    </>
  );
}
