"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/mock";
import type { Grant } from "@/lib/types";

export function ReviewPanel({ grant }: { grant: Grant }) {
  const [status, setStatus] = useState(grant.status);
  const [amount, setAmount] = useState((grant.requestedCents / 100).toFixed(2));
  const decided = status !== "pending_review";
  const f = grant.fields;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>
          Request {grant.id} · {grant.patientName}
        </h2>
        <StatusBadge status={status} />
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="doc-preview">Source document</div>
        <div>
          <table>
            <tbody>
              <tr><th scope="row">Provider</th><td>{f.provider.value ?? "Unknown"}</td></tr>
              <tr><th scope="row">Document</th><td>{f.documentType.value ?? "Unknown"}</td></tr>
              <tr><th scope="row">Total</th><td>{formatCents(f.totalCents.value)}</td></tr>
              <tr><th scope="row">Date</th><td>{f.date.value ?? "Unknown"}</td></tr>
              <tr><th scope="row">Program</th><td>{grant.programName}<br /><small className="muted">Pharmacy costs, up to $100</small></td></tr>
              <tr><th scope="row">Recipient</th><td>{grant.provider.name}<br /><small className="muted">Allowlisted provider</small></td></tr>
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <label htmlFor="amt">Approved amount (USD)</label>
            <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={decided} />
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" disabled={decided} onClick={() => setStatus("approved")}>
              Approve {amount ? `$${amount}` : ""}
            </button>
            <button className="btn danger" disabled={decided} onClick={() => setStatus("rejected")}>
              Reject
            </button>
          </div>
          {decided && (
            <p role="status" style={{ marginTop: 12 }}>
              Decision recorded (mock). The amount and recipient are now fixed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
