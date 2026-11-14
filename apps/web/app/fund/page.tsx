"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadError } from "@/components/NoSession";
import { getFundSummary } from "@/lib/api";
import { FORMULA_WEIGHTS, formatCents } from "@/lib/mock";
import type { FundSummary } from "@/lib/types";
import { SECOND_APPROVAL_ABOVE_CENTS } from "@/lib/types";
import { DonateButton } from "./DonateButton";

const explorer = (sig: string) => `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=devnet`;
const shortSig = (sig: string) => (sig.length > 16 ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : sig);

// Screen 7: Fund dashboard. Aggregates only; no patient-level information.
export default function FundDashboard() {
  const [s, setSummary] = useState<FundSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getFundSummary()
      .then(setSummary)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  if (!s) {
    return (
      <main className="page wide">
        <h1>Community care fund</h1>
        {failed ? (
          <LoadError message="The fund summary didn't load." onRetry={load} />
        ) : (
          <p role="status" className="card">
            Loading the fund…
          </p>
        )}
      </main>
    );
  }

  const secondApprovalAbove = s.rules?.secondApprovalAboveCents ?? SECOND_APPROVAL_ABOVE_CENTS;
  const tiles = [
    { label: `Donated (${s.donationCount ?? 0} donations)`, value: formatCents(s.totalCents) },
    { label: "Available", value: formatCents(s.availableCents) },
    { label: "Reserved for approved grants", value: formatCents(s.reservedCents) },
    { label: `Paid out (${s.paidCount} grants)`, value: formatCents(s.paidCents) },
  ];

  return (
    <main className="page wide">
      <h1>Community care fund</h1>
      <p className="muted">
        Every donation and payout has a public test receipt on Solana devnet. Receipts carry only an opaque
        reference, never patient information.
      </p>
      <div style={{ marginBottom: 16 }}>
        <DonateButton onDonated={(fund) => setSummary(fund)} />
      </div>
      <div className="grid2">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="muted">{t.label}</div>
            <div className="big">{t.value}</div>
          </div>
        ))}
      </div>

      <h2>How the fund decides</h2>
      <div className="card">
        <p>
          A caseworker reviews every request in private and decides each grant. The rules below are public, so anyone can
          see how requests are prioritized.
        </p>
        <ul>
          <li>Grants over {formatCents(secondApprovalAbove)} need a second caseworker&apos;s approval</li>
          <li>The queue is ordered by need; the formula (version {FORMULA_WEIGHTS.formulaVersion}) weighs:</li>
        </ul>
        <table>
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">What it measures</th>
              <th scope="col" style={{ textAlign: "right" }}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {FORMULA_WEIGHTS.weights.map((w) => (
              <tr key={w.label}>
                <td>{w.label}</td>
                <td>{w.measures}</td>
                <td style={{ textAlign: "right" }}>{w.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Names, age, sex, race, ethnicity, religion, nationality, immigration status, disability and diagnosis are never
          used.
        </p>
      </div>

      <h2>Public ledger</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Reference</th>
              <th scope="col">Amount</th>
              <th scope="col">Signature</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {s.recent.map((e, i) => (
              <tr key={`${e.reference}-${i}`}>
                <td>{e.type[0].toUpperCase() + e.type.slice(1)}</td>
                <td><code>{e.reference}</code></td>
                <td>{formatCents(e.amountCents)}</td>
                <td>
                  {e.solanaSignature ? (
                    <a href={explorer(e.solanaSignature)} target="_blank" rel="noreferrer">
                      <code>{shortSig(e.solanaSignature)}</code>
                    </a>
                  ) : (
                    "Pending"
                  )}
                </td>
                <td>{new Date(e.at).toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.recent.length === 0 && <p className="muted">No activity yet.</p>}
      </div>
    </main>
  );
}
