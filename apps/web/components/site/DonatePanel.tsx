"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, SolanaMark } from "@/components/Icon";
import { ApiRequestError, donateByCard, recordSolDonation } from "@/lib/api";
import { explorerTx, shortSig, usd } from "@/lib/format";
import { getPhantom, isValidAddress, looksLikeSignature, sendDevnetSol, TREASURY_ADDRESS } from "@/lib/solana";
import type { DonationResponse, FundSummary } from "@/lib/types";

type Method = "card" | "sol";

const MIN_CENTS = 100; // whole dollars, $1 to $10,000 (Nessie truncates cents)
const MAX_CENTS = 1_000_000;

/**
 * Donate (SPEC §3 P0), as a keypad transfer card.
 * - Card: POST /api/fund/donations { amountCents, idempotencyKey } → a Nessie deposit into the fund.
 *   One key per attempt, reused on retry, so a double submit can't donate twice.
 * - Devnet SOL: Phantom sends to the treasury, then POST /api/fund/donations/solana { signature }.
 *   Without Phantom, send from any devnet wallet and paste the signature.
 */
export function DonatePanel({ available, onDonated }: { available: number | null; onDonated?: (fund: FundSummary) => void }) {
  const [method, setMethod] = useState<Method>("card");
  const [entry, setEntry] = useState("25");
  const [pasted, setPasted] = useState("");
  const [hasPhantom, setHasPhantom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DonationResponse | null>(null);
  const cardKey = useRef<string | null>(null);
  const solSignature = useRef<string | null>(null);

  useEffect(() => setHasPhantom(getPhantom() !== null), [method]);

  const isSol = method === "sol";
  const value = Number(entry || 0);
  const cents = Math.round(value * 100);
  const cardValid = /^\d+$/.test(entry) && cents >= MIN_CENTS && cents <= MAX_CENTS;
  const solValid = /^\d+(\.\d{0,4})?$/.test(entry) && value > 0 && value <= 10;
  const treasuryReady = isValidAddress(TREASURY_ADDRESS);

  function press(k: string) {
    setError(null);
    cardKey.current = null; // a new amount is a new donation
    solSignature.current = null;
    setEntry((e) => {
      if (k === "del") return e.slice(0, -1);
      if (k === ".") return !isSol || e.includes(".") ? e : (e || "0") + ".";
      const next = e === "0" ? k : e + k;
      if (!isSol && next.length > 5) return e;
      if (isSol && next.replace(".", "").length > 5) return e;
      return next;
    });
  }

  function switchMethod(m: Method) {
    setMethod(m);
    setEntry(m === "card" ? "25" : "0.5");
    setError(null);
  }

  async function run(fn: () => Promise<DonationResponse>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      cardKey.current = null;
      solSignature.current = null;
      setDone(r);
      onDonated?.(r.fund);
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error && /reject|cancel/i.test(e.message)
            ? "The wallet request was canceled. Nothing was sent."
            : "That didn't go through. Try again; it won't be counted twice.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (busy) return;
    if (!isSol && cardValid) {
      run(() => {
        cardKey.current ??= crypto.randomUUID();
        return donateByCard({ amountCents: cents, idempotencyKey: cardKey.current });
      });
    } else if (isSol && treasuryReady && (hasPhantom ? solValid : looksLikeSignature(pasted))) {
      run(async () => {
        if (!hasPhantom) solSignature.current = pasted.trim();
        else solSignature.current ??= await sendDevnetSol(value);
        return recordSolDonation({ signature: solSignature.current });
      });
    }
  }

  const canSend = !busy && (isSol ? treasuryReady && (hasPhantom ? solValid : looksLikeSignature(pasted)) : cardValid);

  if (done) {
    const d = done.donation;
    const sig = d.solanaSignature;
    return (
      <section className="g-card give" id="donate" aria-labelledby="give-title" role="status">
        <h2 id="give-title" className="g-title">
          Donate
        </h2>
        <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", padding: "24px 0" }}>
          <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
            <span
              style={{ display: "grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", background: "var(--mint-soft)", color: "var(--teal)" }}
            >
              <Icon name="check" size={30} strokeWidth={2.2} />
            </span>
            <p style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>
              {d.rail === "nessie" ? `${usd(d.amountCents)} received` : "Gift verified"}
            </p>
            <p className="muted" style={{ maxWidth: 260, fontSize: 14 }}>
              {d.rail === "nessie"
                ? `Thank you. The fund now has ${usd(done.fund.availableCents)} available for patients.`
                : "Thank you. Your devnet SOL transfer is on the ledger."}
            </p>
            {sig && (
              <a className="sig" href={done.explorerUrl ?? explorerTx(sig)} target="_blank" rel="noreferrer">
                <SolanaMark size={12} /> {shortSig(sig)}
              </a>
            )}
          </div>
        </div>
        <button className="ink-btn" onClick={() => setDone(null)}>
          Give again
        </button>
      </section>
    );
  }

  return (
    <section className="g-card give" id="donate" aria-labelledby="give-title">
      <h2 id="give-title" className="g-title">
        Donate
      </h2>

      <div className="give-row">
        <span>From</span>
        <div className="give-select">
          {isSol ? <SolanaMark size={18} /> : <Icon name="card" size={20} />}
          {isSol ? "Devnet SOL wallet" : "Card"}
          <div className="tabs" role="tablist" aria-label="Payment method">
            <button role="tab" aria-selected={!isSol} onClick={() => switchMethod("card")} disabled={busy}>
              Card
            </button>
            <button role="tab" aria-selected={isSol} onClick={() => switchMethod("sol")} disabled={busy}>
              SOL
            </button>
          </div>
        </div>
      </div>

      <div className="give-row">
        <span>To</span>
        <div className="give-to">
          <span className="avatar">
            <Icon name="heart" />
          </span>
          Community care fund
        </div>
      </div>

      <div className="give-amount">
        <output aria-live="polite" aria-label={isSol ? `${entry || 0} SOL` : `${entry || 0} dollars`}>
          {!isSol && <span className="cur">$</span>}
          {entry || "0"}
          <span className="caret" aria-hidden="true" />
          {isSol && <span className="cur" style={{ marginLeft: 10, marginRight: 0 }}>SOL</span>}
        </output>
        <small>
          {isSol
            ? "Test network only; no dollar value"
            : available != null
              ? `Fund available: ${usd(available)}`
              : "Whole dollars, $1 to $10,000"}
        </small>
      </div>

      {isSol && !hasPhantom && treasuryReady ? (
        <div className="give-row">
          <span>No Phantom wallet found. Send devnet SOL to this address, then paste the signature.</span>
          <div className="addr">{TREASURY_ADDRESS}</div>
          <input
            className="input mono"
            aria-label="Transaction signature"
            placeholder="Transaction signature"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={busy}
          />
        </div>
      ) : (
        <div className="keypad" role="group" aria-label="Amount keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} disabled={busy}>
              {k}
            </button>
          ))}
          <button type="button" onClick={() => press(".")} disabled={busy || !isSol} aria-label="Decimal point">
            .
          </button>
          <button type="button" onClick={() => press("0")} disabled={busy}>
            0
          </button>
          <button type="button" onClick={() => press("del")} disabled={busy} aria-label="Delete">
            <Icon name="arrowLeft" />
          </button>
        </div>
      )}

      {isSol && !treasuryReady && <p className="give-msg bad">The treasury address isn&apos;t configured on this deployment.</p>}
      {error && (
        <p className="give-msg bad" role="alert">
          {error}
        </p>
      )}

      <button className="ink-btn" onClick={submit} disabled={!canSend}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {busy ? (isSol && hasPhantom ? "Waiting for wallet" : "Sending") : isSol ? (hasPhantom ? "Send with Phantom" : "Record donation") : "Donate"}
      </button>
    </section>
  );
}
