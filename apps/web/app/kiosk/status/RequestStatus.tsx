"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EndSessionButton } from "@/components/KioskSession";
import { LoadError, NoSession } from "@/components/NoSession";
import { ReadAloud } from "@/components/ReadAloud";
import { STATUS_LABEL, StatusBadge } from "@/components/StatusBadge";
import { isNoSession, listMyGrants } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import type { Grant, GrantStatus } from "@/lib/types";

const NEXT_STEP: Record<GrantStatus, string> = {
  draft: "Finish your request to send it for review.",
  pending_review:
    "A person at the fund will review your request. You can check back any time by tapping your card here.",
  approved: "Take your card to the provider. They'll tap it and confirm, and the fund pays them directly.",
  rejected: "This request wasn't approved. Ask staff about other options.",
  canceled: "This request was canceled before payment.",
  payment_pending: "The fund is paying your provider now.",
  paid: "Your provider has been paid. Nothing else to do.",
};

type State = { phase: "loading" } | { phase: "no_session" } | { phase: "error" } | { phase: "done"; grants: Grant[] };

export function RequestStatus({ justSent }: { justSent: boolean }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  const load = useCallback(() => {
    listMyGrants()
      .then((r) =>
        setState({
          phase: "done",
          grants: [...r.grants].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        }),
      )
      .catch((e) => setState({ phase: isNoSession(e) ? "no_session" : "error" }));
  }, []);

  useEffect(load, [load]);

  if (state.phase === "loading") {
    return (
      <p role="status" aria-live="polite" className="card">
        Loading your requests…
      </p>
    );
  }
  if (state.phase === "no_session") return <NoSession />;
  if (state.phase === "error") return <LoadError message="We couldn't load your requests just now." onRetry={load} />;

  const [latest, ...older] = state.grants;
  if (!latest) {
    return (
      <>
        <h1>No requests yet</h1>
        <Link className="btn block" href="/kiosk/bills">
          Start a request
        </Link>
      </>
    );
  }

  const amount = formatCents(latest.approvedCents ?? latest.requestedCents);
  const waitingSecond = latest.status === "pending_review" && latest.awaitingSecondApproval;
  const next = waitingSecond
    ? "Your request has one approval and is waiting for a second caseworker."
    : NEXT_STEP[latest.status];
  const spoken = `Your request for ${amount} to ${latest.provider.name} is: ${STATUS_LABEL[latest.status]}. ${next}`;

  return (
    <>
      {justSent && (
        <p className="card" role="status">
          <strong>Request sent.</strong> We&apos;ve saved it for review.
        </p>
      )}
      <h1>Your request</h1>
      <div className="card">
        <StatusBadge status={latest.status} />
        <p className="big" style={{ marginTop: 12 }}>
          {amount}
        </p>
        <p>
          To <strong>{latest.provider.name}</strong>
          <br />
          <span className="muted">For {latest.bill.merchant}</span>
        </p>
        <p>{next}</p>
        <div className="row">
          <ReadAloud text={spoken} />
          <button className="btn secondary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {older.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>Earlier requests ({older.length})</summary>
          <ul>
            {older.map((g) => (
              <li key={g.id}>
                {formatCents(g.approvedCents ?? g.requestedCents)} for {g.bill.merchant}: {STATUS_LABEL[g.status]}
              </li>
            ))}
          </ul>
        </details>
      )}

      <EndSessionButton label="Done, end session" className="btn secondary block" />
    </>
  );
}
