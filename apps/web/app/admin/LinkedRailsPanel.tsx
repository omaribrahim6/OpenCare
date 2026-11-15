"use client";

// Linked rails on the caseworker's case: the bank check (the patient's Nessie activity as monthly
// totals, next to the income on file) and, once the hospital is paid, a refund back to the fund
// when insurance pays late or a charge is reversed. Informational only: nothing here changes the
// score, the order or the amount.

import { useEffect, useState } from "react";
import type { Grant } from "@abdulcare/contracts";
import { usd } from "@/lib/format";

interface BankCheckView {
  check: { days: number; monthlyDepositsCents: number; monthlySpendingCents: number; monthlyBillsCents: number; spendingShare: number | null };
  statedMonthlyIncomeCents: number | null;
  incomeMatches: boolean | null;
}

export function BankCheck({ grantId }: { grantId: string }) {
  const [view, setView] = useState<BankCheckView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/review/grants/${encodeURIComponent(grantId)}/bank`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error?.message ?? "Bank check unavailable"))))
      .then(setView)
      .catch((e: Error) => setError(e.message));
  }, [grantId]);

  return (
    <section className="dr-sec">
      <h3>Bank check · Nessie, last 90 days</h3>
      {error && <p className="dr-hint">{error}</p>}
      {!view && !error && <p className="dr-hint">Reading the patient&rsquo;s account…</p>}
      {view && (
        <>
          <dl className="dr-bank">
            <div><dt>Money in</dt><dd>{usd(view.check.monthlyDepositsCents)}/mo</dd></div>
            <div><dt>Income on file</dt><dd>{view.statedMonthlyIncomeCents != null ? `${usd(view.statedMonthlyIncomeCents)}/mo` : "Not stated"}</dd></div>
            <div><dt>Spending</dt><dd>{usd(view.check.monthlySpendingCents)}/mo</dd></div>
            <div><dt>Bills due</dt><dd>{usd(view.check.monthlyBillsCents)}/mo</dd></div>
          </dl>
          <p className="dr-hint">
            {view.incomeMatches === null
              ? "No stated income to compare."
              : view.incomeMatches
                ? "Deposits match the income on file (within 20%)."
                : "Deposits don't match the income on file. Worth a look; it doesn't change the score."}{" "}
            Totals only: no merchants or descriptions leave the bank.
          </p>
        </>
      )}
    </section>
  );
}

export function RefundToFund({ grant, onDone }: { grant: Grant; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.floor((grant.approvedCents ?? 0) / 100)));
  const [reason, setReason] = useState("Insurance paid late");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (grant.status !== "paid" || !grant.visit) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/grants/${encodeURIComponent(grant.id)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: Math.round(Number(amount) * 100), reason }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message ?? "The refund didn't go through");
      setResult(`${usd(body.refund.amountCents)} is back in the fund. Nessie transfer …${String(body.refund.transferId).slice(-6)}${body.refund.signature ? ", with a public receipt" : ""}.`);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) return <p className="dr-hint" role="status">{result}</p>;
  if (!open) {
    return (
      <button type="button" className="d-btn dr-refund-open" onClick={() => setOpen(true)}>
        Record a refund from {grant.provider.name}
      </button>
    );
  }
  return (
    <div className="dr-refund">
      <label>
        <span>Amount back to the fund ($, whole dollars)</span>
        <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>
        <span>Reason</span>
        <input className="input" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="dr-refund-actions">
        <button type="button" className="d-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button type="button" className="d-btn d-btn-teal" onClick={() => void submit()} disabled={busy}>
          {busy ? "Moving it in Nessie…" : "Refund to the fund"}
        </button>
      </div>
      {error && <p className="d-login-error" role="alert">{error}</p>}
    </div>
  );
}
