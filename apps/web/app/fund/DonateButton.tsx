"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError, donateByCard, recordSolDonation } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import { getPhantom, isValidAddress, looksLikeSignature, sendDevnetSol, TREASURY_ADDRESS } from "@/lib/solana";
import type { DonationResponse, FundSummary } from "@/lib/types";

type Method = "card" | "sol";
type Phase = "closed" | "form" | "sending" | "done" | "error";

const CARD_PRESETS = [10, 25, 50];
const SOL_PRESETS = [0.1, 0.5, 1];
const MIN_CENTS = 100; // CreateDonationRequest: whole dollars, $1 to $10,000
const MAX_CENTS = 1_000_000;

/**
 * Donate (SPEC rev 5 §3 P0).
 * - Card: POST /api/fund/donations { amountCents, idempotencyKey } → a Nessie deposit into the fund.
 *   One key per donation attempt, reused on retry, so a double submit can't donate twice.
 * - Devnet SOL: the donor's Phantom wallet sends to the treasury, then POST /api/fund/donations/solana
 *   { signature }. Donors without Phantom can send from any devnet wallet and paste the signature.
 */
export function DonateButton({ onDonated }: { onDonated?: (fund: FundSummary) => void }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [method, setMethod] = useState<Method>("card");
  const [amount, setAmount] = useState("25");
  const [solAmount, setSolAmount] = useState("0.5");
  const [pasted, setPasted] = useState("");
  const [hasPhantom, setHasPhantom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DonationResponse | null>(null);
  const cardKey = useRef<string | null>(null);
  const solSignature = useRef<string | null>(null);

  useEffect(() => setHasPhantom(getPhantom() !== null), [phase]);

  // Nessie stores whole dollars only, so card donations are whole dollars.
  const cents = Number(amount) * 100;
  const cardValid = /^\d+$/.test(amount.trim()) && cents >= MIN_CENTS && cents <= MAX_CENTS;
  const sol = Number(solAmount);
  const solValid = Number.isFinite(sol) && sol > 0 && sol <= 10;
  const treasuryReady = isValidAddress(TREASURY_ADDRESS);

  function reset() {
    setPhase("closed");
    setError(null);
    setResult(null);
    setPasted("");
    cardKey.current = null;
    solSignature.current = null;
  }

  async function submitCard() {
    // New key for a new attempt; the same key on a retry after an error.
    cardKey.current ??= crypto.randomUUID();
    const r = await donateByCard({ amountCents: cents, idempotencyKey: cardKey.current });
    setResult(r);
    onDonated?.(r.fund);
    cardKey.current = null;
  }

  async function submitSol(fromPaste: boolean) {
    // Keep the signature after the wallet sends, so a failed record call retries without paying again.
    if (fromPaste) solSignature.current = pasted.trim();
    else solSignature.current ??= await sendDevnetSol(sol);
    const r = await recordSolDonation({ signature: solSignature.current });
    setResult(r);
    onDonated?.(r.fund);
    solSignature.current = null;
  }

  async function run(fn: () => Promise<void>) {
    setPhase("sending");
    setError(null);
    try {
      await fn();
      setPhase("done");
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error && /reject|cancel/i.test(e.message)
            ? "The wallet request was canceled. Nothing was sent."
            : "The donation didn't go through. Please try again.",
      );
      setPhase("error");
    }
  }

  if (phase === "closed") {
    return (
      <button className="btn" onClick={() => setPhase("form")}>
        Donate to the fund
      </button>
    );
  }

  if (phase === "done" && result) {
    const d = result.donation;
    return (
      <div className="card" role="status">
        <h2 style={{ marginTop: 0 }}>Thank you</h2>
        {d.rail === "nessie" ? (
          <p>
            Your {formatCents(d.amountCents)} donation was deposited into the fund. The fund now has{" "}
            {formatCents(result.fund.availableCents)} available.
          </p>
        ) : (
          <p>
            Your devnet SOL donation was recorded. Transaction: <code className="untrusted">{d.solanaSignature}</code>
          </p>
        )}
        <p className="muted">It appears in the public ledger below.</p>
        <button className="btn secondary" onClick={reset}>
          Close
        </button>
      </div>
    );
  }

  const busy = phase === "sending";

  return (
    <form
      className="card stack"
      aria-labelledby="donate-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (method === "card" && cardValid) run(submitCard);
        if (method === "sol" && solValid && hasPhantom && treasuryReady) run(() => submitSol(false));
      }}
    >
      <h2 id="donate-title" style={{ margin: 0 }}>
        Donate
      </h2>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>How</legend>
        <div className="row">
          {(
            [
              ["card", "Card (USD)"],
              ["sol", "Devnet SOL"],
            ] as const
          ).map(([m, label]) => (
            <label key={m} className="row" style={{ fontWeight: 400, gap: 8, margin: 0 }}>
              <input
                type="radio"
                name="method"
                checked={method === m}
                onChange={() => {
                  setMethod(m);
                  setError(null);
                }}
                style={{ width: 22, minHeight: 22 }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {method === "card" ? (
        <>
          <div className="row" role="group" aria-label="Preset amounts">
            {CARD_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn${amount === String(p) ? "" : " secondary"}`}
                aria-pressed={amount === String(p)}
                onClick={() => setAmount(String(p))}
                disabled={busy}
              >
                ${p}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="donate-amount">Amount (whole US dollars)</label>
            <input
              id="donate-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                cardKey.current = null; // a different amount is a new donation
              }}
              aria-invalid={!cardValid}
              aria-describedby="donate-help"
              disabled={busy}
            />
            <small id="donate-help" className="muted">
              Whole dollars, $1 to $10,000. Prototype: no real card is charged; this makes a deposit in Capital One&apos;s
              Nessie sandbox.
            </small>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Test network only. Devnet SOL has no dollar value; it shows how donations are publicly verifiable.
          </p>
          <div className="row" role="group" aria-label="Preset amounts">
            {SOL_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn${solAmount === String(p) ? "" : " secondary"}`}
                aria-pressed={solAmount === String(p)}
                onClick={() => setSolAmount(String(p))}
                disabled={busy}
              >
                {p} SOL
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="sol-amount">Amount (devnet SOL)</label>
            <input
              id="sol-amount"
              inputMode="decimal"
              value={solAmount}
              onChange={(e) => {
                setSolAmount(e.target.value);
                solSignature.current = null;
              }}
              aria-invalid={!solValid}
              disabled={busy}
            />
          </div>
          {!treasuryReady ? (
            <p className="badge warn">The treasury address isn&apos;t configured yet.</p>
          ) : !hasPhantom ? (
            <div className="stack">
              <p style={{ margin: 0 }}>
                No Phantom wallet found. Send devnet SOL from any wallet to the treasury, then paste the transaction
                signature:
              </p>
              <code className="untrusted">{TREASURY_ADDRESS}</code>
              <label htmlFor="sol-sig">Transaction signature</label>
              <input id="sol-sig" value={pasted} onChange={(e) => setPasted(e.target.value)} disabled={busy} />
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Phantom will ask you to approve the transfer. Make sure it&apos;s set to Devnet.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="badge bad">
          {error}
        </p>
      )}

      <div className="row">
        {method === "card" && (
          <button className="btn" type="submit" disabled={!cardValid || busy}>
            {busy ? "Sending…" : cardValid ? `Donate ${formatCents(cents)}` : "Donate"}
          </button>
        )}
        {method === "sol" && hasPhantom && treasuryReady && (
          <button className="btn" type="submit" disabled={!solValid || busy}>
            {busy ? "Waiting for wallet…" : `Send ${solValid ? sol : ""} SOL with Phantom`}
          </button>
        )}
        {method === "sol" && !hasPhantom && treasuryReady && (
          <button
            className="btn"
            type="button"
            disabled={!looksLikeSignature(pasted) || busy}
            onClick={() => run(() => submitSol(true))}
          >
            {busy ? "Checking…" : "Record my donation"}
          </button>
        )}
        <button className="btn secondary" type="button" onClick={reset} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
