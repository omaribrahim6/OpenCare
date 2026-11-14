"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadError, NoSession } from "@/components/NoSession";
import { getBills, isNoSession } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import type { FoundBill } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";

type State = { phase: "loading" } | { phase: "no_session" } | { phase: "error" } | { phase: "done"; bills: FoundBill[] };

export function BillsList() {
  const [state, setState] = useState<State>({ phase: "loading" });

  const load = useCallback(() => {
    setState({ phase: "loading" });
    getBills()
      .then((r) => setState({ phase: "done", bills: r.bills.filter((b) => b.likelyMedical) }))
      .catch((e) => setState({ phase: isNoSession(e) ? "no_session" : "error" }));
  }, []);

  useEffect(load, [load]);

  if (state.phase === "loading") {
    return (
      <p role="status" aria-live="polite" className="card">
        Looking through your bank account for medical bills…
      </p>
    );
  }
  if (state.phase === "no_session") return <NoSession />;
  if (state.phase === "error") return <LoadError message="We couldn't load your bills just now." onRetry={load} />;

  if (state.bills.length === 0) {
    return <p className="card">We didn&apos;t find any medical bills. Ask staff if you think one is missing.</p>;
  }

  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
      {state.bills.map((b) => (
        <li key={b.id} className="card" style={{ marginBottom: 0 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{b.merchant}</strong>
            <span className="big" style={{ fontSize: "1.4rem" }}>
              {formatCents(b.amountCents)}
            </span>
          </div>
          <p className="muted" style={{ margin: "4px 0 12px" }}>
            {b.date ?? "No date"} · <span className="badge info">{b.category ? CATEGORY_LABEL[b.category] : "Medical"}</span>
            {b.reason && (
              <>
                <br />
                Why: {b.reason}
              </>
            )}
          </p>
          <Link
            className="btn block"
            href={`/kiosk/explain?bill=${encodeURIComponent(b.id)}&source=${b.source}`}
          >
            Get help with this bill
          </Link>
        </li>
      ))}
    </ul>
  );
}
