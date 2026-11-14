"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { DEMO_PATIENT, DEMO_PROVIDER, formatCents } from "@/lib/mock";

type Phase = "waiting" | "grant" | "paying" | "receipt";

// Screen 7: Provider terminal. Mock flow: tap → approved grant → explicit confirm → receipt.
export default function ProviderTerminal() {
  const [phase, setPhase] = useState<Phase>("waiting");

  function confirm() {
    setPhase("paying");
    setTimeout(() => setPhase("receipt"), 1200);
  }

  return (
    <main className="page">
      <p className="muted">
        Provider terminal · {DEMO_PROVIDER.name} · device paired (mock)
      </p>

      {phase === "waiting" && (
        <div style={{ textAlign: "center" }}>
          <h1>Ask the patient to tap their CareCard</h1>
          <div className="tap-target" aria-hidden="true">
            ◉
          </div>
          <button className="btn secondary" onClick={() => setPhase("grant")}>
            Simulate card tap (demo)
          </button>
        </div>
      )}

      {phase !== "waiting" && (
        <div className="card">
          <h1>Approved grant</h1>
          <p>
            Patient: <strong>{DEMO_PATIENT.displayName}</strong>
          </p>
          <p className="big">{formatCents(4500)}</p>
          <p className="muted">From Community Rx Bridge (fictional) to {DEMO_PROVIDER.name}</p>
          <StatusBadge status={phase === "receipt" ? "paid" : phase === "paying" ? "payment_pending" : "approved"} />

          {phase === "grant" && (
            <div className="stack" style={{ marginTop: 16 }}>
              <button className="btn block" onClick={confirm}>
                Confirm and collect {formatCents(4500)}
              </button>
              <button className="btn secondary block" onClick={() => setPhase("waiting")}>
                Cancel
              </button>
            </div>
          )}

          {phase === "paying" && (
            <p role="status" aria-live="polite" style={{ marginTop: 16 }}>
              Sending payment… Don&apos;t tap again; repeat taps won&apos;t pay twice.
            </p>
          )}

          {phase === "receipt" && (
            <div style={{ marginTop: 16 }} role="status">
              <h2>Receipt</h2>
              <table>
                <tbody>
                  <tr><th scope="row">Nessie payment ID</th><td><code>mock_pay_9c21</code></td></tr>
                  <tr>
                    <th scope="row">Solana signature</th>
                    <td>
                      <code>5xQ…mock1</code>
                      <br />
                      <small className="muted">Public test receipt on devnet; no dollar value</small>
                    </td>
                  </tr>
                </tbody>
              </table>
              <button className="btn secondary block" style={{ marginTop: 16 }} onClick={() => setPhase("waiting")}>
                Next patient
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
