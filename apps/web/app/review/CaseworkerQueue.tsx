"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadError } from "@/components/NoSession";
import { ApiRequestError, getReviewQueue } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import type { ReviewQueue as Queue } from "@/lib/types";
import { ReviewQueue } from "./ReviewQueue";

type State =
  | { phase: "loading" }
  | { phase: "not_reviewer" }
  | { phase: "error"; message: string }
  | { phase: "done"; queue: Queue };

/** Loads GET /api/review/queue (caseworker device) and renders the budget header and ranked list. */
export function CaseworkerQueue({ formulaPreview }: { formulaPreview: boolean }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  const load = useCallback(() => {
    setState((s) => (s.phase === "done" ? s : { phase: "loading" }));
    getReviewQueue(formulaPreview)
      .then((queue) => setState({ phase: "done", queue }))
      .catch((e) =>
        setState(
          e instanceof ApiRequestError && (e.status === 401 || e.status === 403)
            ? { phase: "not_reviewer" }
            : { phase: "error", message: e instanceof Error ? e.message : "The queue didn't load." },
        ),
      );
  }, [formulaPreview]);

  useEffect(load, [load]);

  if (state.phase === "loading") {
    return (
      <p role="status" aria-live="polite" className="card">
        Ranking pending requests… this can take a few seconds.
      </p>
    );
  }
  if (state.phase === "not_reviewer") {
    return (
      <div className="card" role="alert">
        <p style={{ marginTop: 0 }}>This browser isn&apos;t paired as a caseworker device.</p>
        <Link className="btn" href="/pair">
          Set up this device
        </Link>
      </div>
    );
  }
  if (state.phase === "error") return <LoadError message={state.message} onRetry={load} />;

  const { queue } = state;
  const totalRequested = queue.items.reduce((sum, it) => sum + it.grant.requestedCents, 0);

  return (
    <>
      <div className="budget-bar card" role="group" aria-label="Fund budget">
        <div>
          <div className="muted">Available to grant</div>
          <div className="big">{formatCents(queue.availableCents)}</div>
        </div>
        <div>
          <div className="muted">Requested in this queue</div>
          <div className="big" style={{ fontSize: "1.6rem" }}>
            {formatCents(totalRequested)}
          </div>
        </div>
        <div>
          <div className="muted">Order</div>
          {queue.source === "gemini" ? (
            <span className="badge info">Ranked by Gemini</span>
          ) : (
            <span className="badge warn">Formula order</span>
          )}
        </div>
        <button className="btn secondary" onClick={load}>
          Refresh
        </button>
      </div>

      <p className="muted">
        {queue.source === "gemini"
          ? "Gemini compared these requests using anonymized factor values only. The formula score sits beside each rank so you can see where they differ."
          : "Gemini's ranking wasn't available or didn't pass its checks, so requests are in formula order with standard explanations."}{" "}
        The order is a recommendation. You decide every grant and can open any request in any order.
      </p>

      {queue.items.length === 0 ? (
        <p className="card">Nothing waiting for review.</p>
      ) : (
        <ReviewQueue
          key={queue.rankedAt}
          items={queue.items}
          order={queue.source}
          availableCents={queue.availableCents}
        />
      )}
    </>
  );
}
