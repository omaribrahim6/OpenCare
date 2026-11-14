"use client";

import { useState } from "react";
import { donate, formatCents } from "@/lib/mock";
import type { DonationResponse } from "@/lib/types";

type Phase = "closed" | "form" | "sending" | "done" | "error";

const PRESETS = [10, 25, 50];
const MIN_CENTS = 100; // CreateDonationRequest: between $1 and $10,000
const MAX_CENTS = 1_000_000;

/**
 * Card donation (SPEC rev 5 §3 P0): POST /api/fund/donations with { amountCents }, which makes a
 * Nessie deposit into the fund account. Devnet SOL donations wait for a route in the contracts.
 */
export function DonateButton() {
  const [phase, setPhase] = useState<Phase>("closed");
  const [amount, setAmount] = useState("25");
  const [result, setResult] = useState<DonationResponse | null>(null);

  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents >= MIN_CENTS && cents <= MAX_CENTS;

  if (phase === "closed") {
    return (
      <button className="btn" onClick={() => setPhase("form")}>
        Donate to the fund
      </button>
    );
  }

  if (phase === "done" && result) {
    return (
      <div className="card" role="status">
        <h2 style={{ marginTop: 0 }}>Thank you</h2>
        <p>
          Your {formatCents(result.donation.amountCents)} donation was deposited into the fund (mock Nessie deposit).
          The fund now has {formatCents(result.fund.availableCents)} available. The donation will appear in the public
          ledger with its Solana receipt.
        </p>
        <button className="btn secondary" onClick={() => setPhase("closed")}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form
      className="card stack"
      aria-labelledby="donate-title"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setPhase("sending");
        try {
          setResult(await donate(cents));
          setPhase("done");
        } catch {
          setPhase("error");
        }
      }}
    >
      <h2 id="donate-title" style={{ margin: 0 }}>
        Donate by card
      </h2>

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

      <div>
        <label htmlFor="donate-amount">Amount (USD)</label>
        <input
          id="donate-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={!valid}
          aria-describedby="donate-help"
        />
        <small id="donate-help" className="muted">
          Between $1 and $10,000. Prototype: no real card is charged; this makes a deposit in Capital One&apos;s Nessie
          sandbox.
        </small>
      </div>

      {phase === "error" && (
        <p role="alert" className="badge bad">
          The donation didn&apos;t go through. Nothing was charged. Please try again.
        </p>
      )}

      <div className="row">
        <button className="btn" type="submit" disabled={!valid || phase === "sending"}>
          {phase === "sending" ? "Sending…" : valid ? `Donate ${formatCents(cents)}` : "Donate"}
        </button>
        <button className="btn secondary" type="button" onClick={() => setPhase("closed")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
