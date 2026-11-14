"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Device } from "@abdulcare/contracts";
import { LoadError } from "@/components/NoSession";
import { StatusBadge } from "@/components/StatusBadge";
import { LIVE, currentDevice, getGrant, redeemGrant } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import type { Grant } from "@/lib/types";

const POLL_MS = 3000;
const POLL_LIMIT = 40; // about two minutes

const explorer = (sig: string) => `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=devnet`;

/**
 * Screen 6: Provider terminal. The patient taps their CareCard on this (provider-paired) phone,
 * which opens /t/<token> and lists their approved grants; picking one lands here with ?grant=<id>.
 * The provider confirms explicitly; redeem is idempotent, so a repeat tap or retry never pays twice.
 */
export function ProviderTerminal({ grantId }: { grantId: string | null }) {
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    currentDevice()
      .then((r) => setDevice(r.device))
      .catch(() => setDevice(null));
  }, []);

  const load = useCallback(() => {
    if (!grantId) return;
    setLoadError(null);
    getGrant(grantId)
      .then((r) => setGrant(r.grant))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "This grant didn't load."));
  }, [grantId]);

  useEffect(load, [load]);

  // While the payout or its receipt is in flight, poll GET /api/grants/:id (it reconciles server-side).
  const inFlight =
    grant !== null &&
    (grant.status === "payment_pending" || (grant.status === "paid" && grant.receipt?.receiptStatus !== "receipt_confirmed"));
  useEffect(() => {
    if (!inFlight || !grantId) return;
    if (polls.current >= POLL_LIMIT) return;
    const t = setTimeout(() => {
      polls.current += 1;
      getGrant(grantId)
        .then((r) => setGrant(r.grant))
        .catch(() => {});
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [inFlight, grantId, grant]);

  async function confirm() {
    if (!grant || paying) return;
    setPaying(true);
    setPayError(null);
    try {
      setGrant((await redeemGrant(grant.id)).grant);
      polls.current = 0;
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "The payment didn't start. Try again; it can't pay twice.");
    } finally {
      setPaying(false);
    }
  }

  const header = (
    <p className="muted">
      Provider terminal
      {device ? ` · ${device.label}` : ""}
    </p>
  );

  if (device !== undefined && LIVE && (!device || device.role !== "provider")) {
    return (
      <main className="page">
        {header}
        <div className="card" role="alert">
          <p style={{ marginTop: 0 }}>This browser isn&apos;t paired as a provider terminal.</p>
          <Link className="btn" href="/pair">
            Set up this device
          </Link>
        </div>
      </main>
    );
  }

  if (!grantId) {
    return (
      <main className="page" style={{ textAlign: "center" }}>
        {header}
        <h1>Ask the patient to tap their CareCard on this phone</h1>
        <div className="tap-target" aria-hidden="true" />
        <p className="muted">Their approved grants will open here.</p>
        {!LIVE && (
          <Link className="btn secondary" href="/t/provider">
            Simulate card tap (demo)
          </Link>
        )}
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="page">
        {header}
        <LoadError message={loadError} onRetry={load} />
      </main>
    );
  }

  if (!grant) {
    return (
      <main className="page">
        {header}
        <p role="status" className="card">
          Loading the grant…
        </p>
      </main>
    );
  }

  const amount = formatCents(grant.approvedCents ?? grant.requestedCents);
  const r = grant.receipt;

  return (
    <main className="page">
      {header}
      <div className="card">
        <h1>{grant.status === "paid" ? "Paid" : grant.status === "approved" ? "Approved grant" : "Grant"}</h1>
        <p>
          Patient: <strong>{grant.patient.displayName}</strong>
        </p>
        <p className="big">{amount}</p>
        <p className="muted">
          For {grant.bill.merchant}, paid by the community care fund to {grant.provider.name}
        </p>
        <StatusBadge status={grant.status} />

        {grant.status === "approved" && (
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="btn block" onClick={confirm} disabled={paying}>
              {paying ? "Sending payment…" : `Confirm and collect ${amount}`}
            </button>
            <Link className="btn secondary block" href="/provider">
              Cancel
            </Link>
          </div>
        )}

        {payError && (
          <p role="alert" className="badge bad" style={{ marginTop: 12 }}>
            {payError}
          </p>
        )}

        {grant.status === "payment_pending" && (
          <p role="status" aria-live="polite" style={{ marginTop: 16 }}>
            Sending payment… Don&apos;t tap again; repeat taps won&apos;t pay twice.
          </p>
        )}

        {!["approved", "payment_pending", "paid"].includes(grant.status) && (
          <p style={{ marginTop: 16 }}>This grant can&apos;t be collected right now.</p>
        )}

        {r && (
          <div style={{ marginTop: 16 }} role="status" aria-live="polite">
            <h2>Receipt</h2>
            <table>
              <tbody>
                <tr>
                  <th scope="row">Nessie payment ID</th>
                  <td>
                    <code className="untrusted">{r.nessiePaymentId ?? "Pending"}</code>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Solana receipt</th>
                  <td>
                    {r.solanaSignature ? (
                      <a href={r.explorerUrl ?? explorer(r.solanaSignature)} target="_blank" rel="noreferrer">
                        <code className="untrusted">{r.solanaSignature}</code>
                      </a>
                    ) : (
                      "Pending"
                    )}
                    <br />
                    <small className="muted">
                      {r.receiptStatus === "receipt_confirmed" ? "Confirmed" : "Confirming"} · public test receipt on
                      devnet; no dollar value
                    </small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {grant.status === "paid" && (
          <Link className="btn secondary block" style={{ marginTop: 16 }} href="/provider">
            Next patient
          </Link>
        )}
      </div>
    </main>
  );
}
