"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EndSessionButton } from "@/components/KioskSession";
import { LoadError, NoSession } from "@/components/NoSession";
import { ReadAloud } from "@/components/ReadAloud";
import { getMyBill, isNoSession } from "@/lib/api";
import { explorerTx, shortSig, stepLabel, usd } from "@/lib/format";
import type { PatientBillResponse } from "@/lib/rev6";
import { POLICY_STATUS_LABEL } from "@/lib/rev6";
import { RequestHelpForm } from "./RequestHelpForm";

type State = { phase: "loading" } | { phase: "no_session" } | { phase: "error" } | { phase: "done"; data: PatientBillResponse };

const IN_FLIGHT = ["pending_review", "approved", "payment_pending"];

/** Patient app: the bill shrinking step by step, then "Request help", then the result. */
export function BillView({ justSent }: { justSent: boolean }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  const load = useCallback(() => {
    getMyBill()
      .then((data) => setState({ phase: "done", data }))
      .catch((e) => setState({ phase: isNoSession(e) ? "no_session" : "error" }));
  }, []);
  useEffect(load, [load]);

  // While the request waits for review or the payout runs, check again so the $0 shows up live.
  const waiting = state.phase === "done" && state.data.grant != null && IN_FLIGHT.includes(state.data.grant.status);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [waiting, load]);

  if (state.phase === "loading") {
    return (
      <p role="status" aria-live="polite" className="card">
        Loading your bill…
      </p>
    );
  }
  if (state.phase === "no_session") return <NoSession />;
  if (state.phase === "error") return <LoadError message="We couldn't load your bill just now." onRetry={load} />;

  const { bill, explanation: ex, grant } = state.data;
  if (!bill) {
    return (
      <>
        <h1>No hospital bill yet</h1>
        <p className="card">
          When the hospital logs your visit with your CareCard, your bill shows up here with insurance and the
          hospital&apos;s assistance already applied.
        </p>
        <EndSessionButton label="Done, end session" className="btn secondary block" />
      </>
    );
  }

  const paid = grant?.status === "paid";
  const inFlight = grant != null && IN_FLIGHT.includes(grant.status);
  const remaining = bill.remainingCents;
  const spoken = ex ? [ex.summary, ...ex.points].join(" ") : "";

  return (
    <>
      {justSent && grant?.status === "pending_review" && (
        <p className="card" role="status">
          <strong>Request sent.</strong> A reviewer at the community care fund will look at it. This page updates on its
          own.
        </p>
      )}

      <h1>{paid && remaining === 0 ? "Your bill is paid" : "Your hospital bill"}</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        {bill.visit.description} · {bill.visit.hospital.name} · {bill.visit.date}
      </p>

      <section className={`card bill-total${paid ? " paid" : ""}`} aria-live="polite">
        <span className="muted">{paid ? "You owe" : inFlight ? "Waiting for the fund" : "Left to pay"}</span>
        <strong className="big">{usd(remaining)}</strong>
        {paid && grant?.receipt?.solanaSignature && (
          <a
            className="bill-receipt"
            href={grant.receipt.explorerUrl ?? explorerTx(grant.receipt.solanaSignature)}
            target="_blank"
            rel="noreferrer"
          >
            Public receipt {shortSig(grant.receipt.solanaSignature)}
          </a>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>How your bill got smaller</h2>
        <ol className="bill-steps">
          {bill.steps.map((s, i) => (
            <li key={`${s.label}-${i}`} className={`bill-step${i === 0 ? " charge" : ""} ${s.status}`}>
              <span>
                <strong>{stepLabel(s.label)}</strong>
                <small>
                  {s.status === "pending" ? "Waiting for review" : s.simulated ? "Simulated decision" : i === 0 ? `${bill.visit.lineItems.length} items` : "Confirmed"}
                </small>
              </span>
              <em>{i === 0 ? usd(s.balanceCents) : `${s.status === "pending" ? "" : "−"}${usd(s.reductionCents)}`}</em>
            </li>
          ))}
          <li className="bill-step total">
            <span>
              <strong>{paid ? "You owe" : "Left to pay"}</strong>
            </span>
            <em>{usd(remaining)}</em>
          </li>
        </ol>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer" }}>Hospital assistance we applied for</summary>
          <ul className="bill-policies">
            {bill.applications.map((a) => (
              <li key={a.id}>
                <strong>{a.policy.name}</strong>: {POLICY_STATUS_LABEL[a.status]}
                {a.reductionCents > 0 ? `, ${usd(a.reductionCents)} off` : ""}
                <br />
                <small className="muted">{a.evaluation.reason}</small>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {ex && (
        <section className="card">
          <p style={{ marginTop: 0 }}>{ex.summary}</p>
          {ex.points.length > 0 && (
            <ul>
              {ex.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {ex.disclaimer}
          </p>
          <ReadAloud text={spoken} />
        </section>
      )}

      {!grant && remaining > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Get help with the rest</h2>
          <p>
            The community care fund can pay the {usd(remaining)} that&apos;s left, directly to {bill.visit.hospital.name}.
            Everyone can ask. A person reviews every request, and those with the greatest need are seen first.
          </p>
          <RequestHelpForm visitId={bill.visit.id} remainingCents={remaining} onSent={load} />
        </section>
      )}

      {grant?.status === "rejected" && (
        <p className="card" role="status">
          The fund wasn&apos;t able to cover this request. Ask hospital staff about a payment plan.
        </p>
      )}

      {paid && (
        <p className="card" role="status">
          The community care fund paid {usd(grant?.approvedCents)} to {bill.visit.hospital.name}
          {remaining === 0 ? ". There's nothing else to do." : `. ${usd(remaining)} is still yours to pay.`}
        </p>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn secondary" onClick={load}>
          Refresh
        </button>
        <EndSessionButton label="Done, end session" className="btn secondary" />
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", textAlign: "center" }}>
        <Link href="/kiosk">Back to the start</Link>
      </p>
    </>
  );
}
