"use client";

import { useState } from "react";

type Method = "card" | "sol";
type Phase = "closed" | "form" | "sending" | "done";

const PRESETS = [10, 25, 50];

/**
 * Donate (SPEC rev 5 §3 P0). Card = a Nessie deposit into the fund account; SOL = devnet SOL to the treasury.
 * Mock: no request is sent yet. The api/payments lanes will provide the route.
 */
export function DonateButton() {
  const [phase, setPhase] = useState<Phase>("closed");
  const [method, setMethod] = useState<Method>("card");
  const [amount, setAmount] = useState("25");

  if (phase === "closed") {
    return (
      <button className="btn" onClick={() => setPhase("form")}>
        Donate to the fund
      </button>
    );
  }

  if (phase === "done") {
    return (
      <div className="card" role="status">
        <h2 style={{ marginTop: 0 }}>Thank you</h2>
        <p>
          {method === "card"
            ? `Your $${amount} donation was deposited into the fund (mock Nessie deposit).`
            : `Your ${amount} devnet SOL donation was sent to the fund treasury.`}{" "}
          It will appear in the public ledger below with its Solana receipt.
        </p>
        <button className="btn secondary" onClick={() => setPhase("closed")}>
          Close
        </button>
      </div>
    );
  }

  const valid = Number(amount) > 0;

  return (
    <form
      className="card stack"
      aria-labelledby="donate-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setPhase("sending");
        setTimeout(() => setPhase("done"), 900);
      }}
    >
      <h2 id="donate-title" style={{ margin: 0 }}>
        Donate
      </h2>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>How</legend>
        <div className="row">
          <label className="row" style={{ fontWeight: 400, gap: 8, margin: 0 }}>
            <input
              type="radio"
              name="method"
              checked={method === "card"}
              onChange={() => setMethod("card")}
              style={{ width: 22, minHeight: 22 }}
            />
            Card (USD)
          </label>
          <label className="row" style={{ fontWeight: 400, gap: 8, margin: 0 }}>
            <input
              type="radio"
              name="method"
              checked={method === "sol"}
              onChange={() => setMethod("sol")}
              style={{ width: 22, minHeight: 22 }}
            />
            Devnet SOL
          </label>
        </div>
      </fieldset>

      {method === "card" && (
        <div className="row" role="group" aria-label="Preset amounts">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`btn${amount === String(p) ? "" : " secondary"}`}
              aria-pressed={amount === String(p)}
              onClick={() => setAmount(String(p))}
            >
              ${p}
            </button>
          ))}
        </div>
      )}

      <div>
        <label htmlFor="donate-amount">{method === "card" ? "Amount (USD)" : "Amount (devnet SOL)"}</label>
        <input id="donate-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <small className="muted">
          {method === "card"
            ? "Prototype: no real card is charged. This makes a mock deposit in Capital One's Nessie sandbox."
            : "Test network only. Devnet SOL has no dollar value."}
        </small>
      </div>

      <div className="row">
        <button className="btn" type="submit" disabled={!valid || phase === "sending"}>
          {phase === "sending" ? "Sending…" : "Donate"}
        </button>
        <button className="btn secondary" type="button" onClick={() => setPhase("closed")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
