"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentResponse, Provider } from "@abdulcare/contracts";
import { LoadError, NoSession } from "@/components/NoSession";
import { ReadAloud } from "@/components/ReadAloud";
import { createDocument, isNoSession, listProviders } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import { RequestHelpForm } from "./RequestHelpForm";

type State =
  | { phase: "loading" }
  | { phase: "no_session" }
  | { phase: "error"; message: string }
  | { phase: "done"; doc: DocumentResponse; providers: Provider[] };

const words = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** Best guess at which participating provider sent this bill: shared name words, else the first. */
function guessProvider(merchant: string, providers: Provider[]): string {
  const m = new Set(words(merchant));
  let best = providers[0]?.id ?? "";
  let bestScore = 0;
  for (const p of providers) {
    const score = words(p.name).filter((w) => m.has(w)).length;
    if (score > bestScore) [best, bestScore] = [p.id, score];
  }
  return best;
}

export function ExplainBill({ billId, source }: { billId: string; source: "nessie_bill" | "nessie_purchase" }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [providerId, setProviderId] = useState("");
  const started = useRef<string | null>(null);

  const load = useCallback(() => {
    setState({ phase: "loading" });
    Promise.all([createDocument({ source, nessieId: billId }), listProviders()])
      .then(([doc, { providers }]) => {
        setProviderId(guessProvider(doc.document.merchant, providers));
        setState({ phase: "done", doc, providers });
      })
      .catch((e) =>
        setState(
          isNoSession(e)
            ? { phase: "no_session" }
            : { phase: "error", message: e instanceof Error ? e.message : "We couldn't open this bill." },
        ),
      );
  }, [billId, source]);

  useEffect(() => {
    // One document per visit, even under React strict mode's double effects.
    if (started.current === billId) return;
    started.current = billId;
    load();
  }, [billId, load]);

  if (!billId) {
    return (
      <>
        <h1>Pick a bill first</h1>
        <Link className="btn block" href="/kiosk/bills">
          See my bills
        </Link>
      </>
    );
  }
  if (state.phase === "loading") {
    return (
      <p role="status" aria-live="polite" className="card">
        Reading this bill…
      </p>
    );
  }
  if (state.phase === "no_session") return <NoSession />;
  if (state.phase === "error") return <LoadError message={state.message} onRetry={load} />;

  const { document, explanation: ex } = state.doc;
  const provider = state.providers.find((p) => p.id === providerId);
  const amount = formatCents(document.amountCents);
  const spoken = [`This bill is ${amount}.`, ex.summary, ...ex.points].join(" ");

  return (
    <>
      <h1>About this bill</h1>
      <div className="card">
        <p className="big">{amount}</p>
        <p>{ex.summary}</p>
        {ex.points.length > 0 && (
          <ul>
            {ex.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {ex.questionsToAsk.length > 0 && (
          <>
            <h3>Questions you could ask</h3>
            <ul>
              {ex.questionsToAsk.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </>
        )}
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {ex.disclaimer}
        </p>
        <ReadAloud text={spoken} />
      </div>

      <h2>What the fund can do</h2>
      <div className="card">
        {state.providers.length === 0 ? (
          <p>No participating provider is set up yet. Please ask staff for help.</p>
        ) : (
          <>
            {state.providers.length > 1 ? (
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="provider">Who should the fund pay?</label>
                <select id="provider" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                  {state.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p>
              If your request is approved, the fund pays <strong>{provider?.name ?? "the provider"}</strong> directly. You
              won&apos;t handle any money.
            </p>
            <p className="muted">
              The fund has a limited budget, so a person reviews requests and helps those with the greatest need first.
              Approval isn&apos;t guaranteed.
            </p>
            <RequestHelpForm documentId={document.id} providerId={providerId} requestedCents={document.amountCents} />
          </>
        )}
      </div>
      <Link className="btn secondary block" href="/kiosk/bills">
        Pick a different bill
      </Link>
    </>
  );
}
