"use client";

// Linked rails in the patient portal: pay monthly instead of all at once (a recurring bill on the
// patient's own Nessie account, interest-free), and check your place in the queue against the
// day's public anchor on Solana devnet without seeing anyone else's data.

import { useEffect, useState } from "react";
import { usd } from "@/lib/format";
import { getPlan, getProofs, startPlan, type PaymentPlanView, type PlanOption, type QueueProof } from "./portal-api";

export function PlanOffer({ visitId, onStarted }: { visitId: string; onStarted?: () => void }) {
  const [plan, setPlan] = useState<PaymentPlanView | null>(null);
  const [options, setOptions] = useState<PlanOption[]>([]);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlan(visitId)
      .then((r) => {
        setPlan(r.plan);
        // No bank account on file: a plan can't be set up, so offer nothing.
        setOptions(r.available ? r.suggestion.options : []);
        setSuggested(r.suggestion.months);
      })
      .catch(() => setOptions([]));
  }, [visitId]);

  if (plan) {
    return (
      <p className="u-plan-on" role="status">
        On a plan: {plan.months} payments of {usd(plan.monthlyCents)} from your checking, first on{" "}
        {new Date(`${plan.firstDue}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. No interest.
      </p>
    );
  }
  if (options.length === 0) return null;

  async function choose(months: number) {
    setBusy(months);
    setError(null);
    try {
      const r = await startPlan(visitId, months);
      setPlan(r.plan);
      onStarted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The plan couldn't be set up");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="u-plan">
      <p className="u-plan-title">Or pay monthly, with no interest</p>
      <div className="u-plan-options">
        {options.map((o) => (
          <button key={o.months} type="button" className="d-btn" data-suggested={o.months === suggested} onClick={() => void choose(o.months)} disabled={busy !== null}>
            {busy === o.months ? "Setting up…" : `${o.months} × ${usd(o.monthlyCents)}`}
          </button>
        ))}
      </div>
      {suggested && <p className="u-muted u-plan-note">{suggested} months keeps each payment near 5% of your monthly income.</p>}
      {error && <p className="d-login-error" role="alert">{error}</p>}
    </div>
  );
}

export function QueueProofs() {
  const [proofs, setProofs] = useState<QueueProof[] | null>(null);
  useEffect(() => {
    getProofs()
      .then((r) => setProofs(r.proofs))
      .catch(() => setProofs([]));
  }, []);
  if (!proofs || proofs.length === 0) return null;
  return (
    <section className="d-card u-section u-proof" aria-labelledby="u-proof">
      <div className="d-card-head">
        <h2 id="u-proof">Your place in line, proven</h2>
      </div>
      <ul className="u-list">
        {proofs.map((p) => (
          <li key={p.grantId} className="u-proof-item">
            <p>
              On {new Date(`${p.day}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })} you were{" "}
              <strong>#{p.rank}</strong> of {p.outOf} in the queue.{" "}
              {p.verified ? "This matches the public anchor on Solana." : "This doesn't match the public anchor."}
            </p>
            <p className="u-muted">
              The fund published one fingerprint of the whole queue that day. Your {p.proof.length} proof steps rebuild it from your own
              entry, without showing anyone else&apos;s.{" "}
              {p.explorerUrl && (
                <a href={p.explorerUrl} target="_blank" rel="noreferrer">
                  See the anchor
                </a>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
