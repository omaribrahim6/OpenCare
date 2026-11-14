"use client";

import { TapRings } from "@/components/TapRings";
import { firstName } from "@/lib/format";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { TapResult } from "@abdulcare/contracts";
import { EndSessionButton } from "@/components/KioskSession";
import { tap } from "@/lib/api";
import { formatCents } from "@/lib/mock";

type State = { phase: "loading" } | { phase: "error" } | { phase: "done"; result: TapResult };

/**
 * Card tap landing. Cookies can't be set while a server page renders, so this POSTs the token to
 * /api/tap on mount; the route sets the session cookie and returns a TapResult.
 */
export function TapLanding({ token }: { token: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const started = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice in dev; one tap should be one request.
    if (started.current) return;
    started.current = true;
    tap(token)
      .then((result) => setState({ phase: "done", result }))
      .catch(() => setState({ phase: "error" }));
  }, [token]);

  if (state.phase === "loading") {
    return (
      <main className="page station station-tap-result" style={{ textAlign: "center" }}>
        <TapRings size={132} />
        <p role="status" aria-live="polite" className="big" style={{ fontSize: "1.6rem" }}>
          Reading your card…
        </p>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main className="page station station-tap-result">
        <h1>Something went wrong</h1>
        <p>We couldn&apos;t read this card just now. Please tap it again, or ask staff for help.</p>
        <Link className="btn secondary" href="/kiosk">
          Back to start
        </Link>
      </main>
    );
  }

  const result = state.result;

  if (result.kind === "unpaired_device") {
    return (
      <main className="page station station-tap-result" style={{ textAlign: "center" }}>
        <TapRings size={132} />
        <h1>Tap at a participating kiosk</h1>
        <p className="muted">
          This is an AbdulCare CareCard. To use it, tap it on the kiosk phone at a participating clinic or pharmacy. No
          information is shown on this device.
        </p>
      </main>
    );
  }

  if (result.kind === "unknown_card") {
    return (
      <main className="page station station-tap-result">
        <h1>We don&apos;t recognize this card</h1>
        <p>This card isn&apos;t linked to anyone yet, or it has been turned off.</p>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>What to do</h2>
          <p>Ask a staff member to help you enroll or get a replacement card.</p>
          <Link className="btn secondary" href="/kiosk">
            Back to start
          </Link>
        </div>
      </main>
    );
  }

  if (result.kind === "intake") {
    return (
      <main className="page station station-tap-result">
        <p className="muted">Hospital intake · patient selected</p>
        <h1>{result.patient.displayName}</h1>
        <p>
          {result.plan ? `Insurance on file: ${result.plan.payerName}.` : "No insurance plan on file."} Log today&apos;s
          visit to start their bill.
        </p>
        <Link
          className="btn block"
          href="/intake"
          onClick={() => {
            try {
              sessionStorage.setItem("intake-patient", JSON.stringify(result.patient));
            } catch {}
          }}
        >
          Log the visit
        </Link>
      </main>
    );
  }

  if (result.kind === "redemption") {
    return (
      <main className="page station station-tap-result">
        <p className="muted">Provider terminal · patient identified</p>
        <h1>{result.patient.displayName}</h1>
        {result.redeemableGrants.length === 0 ? (
          <p className="card">This patient has no approved grants to collect here.</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {result.redeemableGrants.map((g) => (
              <li key={g.id} className="card" style={{ marginBottom: 0 }}>
                <p className="big" style={{ margin: 0 }}>
                  {formatCents(g.approvedCents)}
                </p>
                <p className="muted">Approved grant for {g.bill.merchant}</p>
                <Link className="btn block" href={`/provider?grant=${encodeURIComponent(g.id)}`}>
                  Review and confirm
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  return (
    <main className="page station station-tap-result">
      <p className="muted">Checked in</p>
      <h1>Hi, {firstName(result.patient.displayName)}</h1>
      <p>Your hospital bill is ready, with insurance and the hospital&apos;s assistance already applied.</p>
      <div className="stack">
        <Link className="btn block" href="/kiosk/bill">
          See my bill
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 24 }}>
        Not you? <EndSessionButton label="End session" className="btn secondary" style={{ minHeight: 40 }} />
      </p>
    </main>
  );
}
