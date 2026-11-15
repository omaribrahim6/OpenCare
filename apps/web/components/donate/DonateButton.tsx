"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, SolanaMark } from "@/components/Icon";
import { ApiRequestError, donateByCard } from "@/lib/api";
import { explorerTx, shortSig, usd } from "@/lib/format";
import type { DonationResponse } from "@/lib/types";
import "./donate.css";

// A Donate button for public pages. It opens a sheet where the donor picks an amount, donates
// through POST /api/fund/donations (a Nessie deposit into the fund plus a memo-only Solana devnet
// receipt), then shows the receipt. "Print receipt" opens the Solana receipt and prints it.
// The donor stays anonymous: nothing about them is sent or stored.

const PRESETS = [25, 50, 100, 250];
const MIN_DOLLARS = 1; // the API takes whole dollars, $1 to $10,000 (Nessie keeps whole dollars)
const MAX_DOLLARS = 10_000;

type Step = "pick" | "sending" | "done" | "receipt";

/** The memo the server writes on chain for this donation: ac_don_ + the first 20 hex of sha256(key). */
async function memoFor(key: string): Promise<string | null> {
  try {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
    return `ac_don_${hex.slice(0, 20)}`;
  } catch {
    return null;
  }
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function DonateButton({ className = "", label = "Donate" }: { className?: string; label?: string }) {
  const router = useRouter();
  const sheet = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [entry, setEntry] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DonationResponse | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const attemptKey = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  const dollars = /^\d+$/.test(entry) ? Number(entry) : NaN;
  const valid = Number.isInteger(dollars) && dollars >= MIN_DOLLARS && dollars <= MAX_DOLLARS;

  const open = () => {
    setStep("pick");
    setError(null);
    setDone(null);
    setMemo(null);
    attemptKey.current = null;
    sheet.current?.showModal();
  };
  const close = () => {
    if (step === "sending") return;
    sheet.current?.close();
    // New totals on the page behind (the landing numbers refresh within a minute).
    if (done) router.refresh();
  };

  const choose = (value: string) => {
    setError(null);
    attemptKey.current = null; // a new amount is a new donation
    setEntry(value.replace(/[^\d]/g, "").slice(0, 5));
  };

  const donate = async () => {
    if (!valid || step === "sending") return;
    setStep("sending");
    setError(null);
    // One key per attempt, reused on a retry, so a double submit can't donate twice.
    attemptKey.current ??= crypto.randomUUID();
    const key = attemptKey.current;
    try {
      const result = await donateByCard({ amountCents: dollars * 100, idempotencyKey: key });
      setDone(result);
      setMemo(await memoFor(key));
      attemptKey.current = null;
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "That didn't go through. Try again; it won't be counted twice.");
      setStep("pick");
    }
  };

  // Print receipt: show the Solana receipt, then open the print dialog once it has painted.
  const printReceipt = () => {
    setStep("receipt");
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const d = done?.donation;
  const sig = d?.solanaSignature ?? null;
  const explorer = sig ? (done?.explorerUrl ?? explorerTx(sig)) : null;

  const body = (() => {
    if (step === "receipt" && d) {
      return (
        <div className="dn-body dn-chain">
          <div className="dn-chain-head">
            <span className="dn-chain-mark"><SolanaMark size={20} /></span>
            <div>
              <p className="dn-kicker">Solana receipt</p>
              <h2 id={titleId} className="dn-chain-title">Donation to the OpenCare community care fund</h2>
            </div>
          </div>
          <p className="dn-chain-amount">{usd(d.amountCents)}</p>
          <dl className="dn-facts">
            <div><dt>Status</dt><dd>{sig ? <span className="dn-ok"><Icon name="check" size={14} /> Confirmed on chain</span> : "Recording on Solana…"}</dd></div>
            <div><dt>Network</dt><dd>Solana devnet</dd></div>
            <div><dt>Recorded</dt><dd>{when(d.at)}</dd></div>
            <div><dt>Program</dt><dd>Memo (on-chain note, no payment)</dd></div>
            {memo && <div><dt>Memo</dt><dd className="dn-mono">{memo}</dd></div>}
            <div><dt>Bank deposit</dt><dd className="dn-mono">{d.nessieDepositId ?? "—"}</dd></div>
            <div><dt>Donor</dt><dd>Anonymous</dd></div>
          </dl>
          <div className="dn-sig">
            <span>Transaction signature</span>
            <code>{sig ?? "Pending: the signature appears once Solana confirms it."}</code>
          </div>
          {explorer && (
            <p className="dn-verify">
              Verify it yourself at <a href={explorer} target="_blank" rel="noreferrer">explorer.solana.com</a>. The memo
              holds only an anonymous reference, never your name or card.
            </p>
          )}
          <div className="dn-actions">
            <button type="button" className="dn-btn" onClick={() => setStep("done")}>Back</button>
            <button type="button" className="dn-btn dn-btn-ink" onClick={() => window.print()}>
              <Icon name="receipt" size={16} /> Print
            </button>
          </div>
        </div>
      );
    }

    if (step === "done" && d) {
      return (
        <div className="dn-body dn-done">
          <span className="dn-check" aria-hidden="true"><Icon name="check" size={26} strokeWidth={2.2} /></span>
          <p className="dn-kicker">Donation sent</p>
          <h2 id={titleId} className="dn-amount">{usd(d.amountCents)}</h2>
          <p className="dn-muted dn-to">to the OpenCare community care fund. Thank you.</p>
          <dl className="dn-facts">
            <div><dt>Date</dt><dd>{when(d.at)}</dd></div>
            <div><dt>For</dt><dd>Hospital bills, approved by a person</dd></div>
            <div><dt>From</dt><dd>Anonymous donor</dd></div>
            <div>
              <dt>Solana receipt</dt>
              <dd>
                {explorer && sig ? (
                  <a href={explorer} target="_blank" rel="noreferrer" className="dn-chain-link">
                    <span className="dn-mono">{shortSig(sig)}</span> <Icon name="external" size={13} />
                  </a>
                ) : (
                  <span className="dn-pending"><span className="dn-pulse" aria-hidden="true" /> Recording on Solana…</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="dn-note">
            <Icon name="lock" size={14} /> The public ledger shows the amount and an anonymous reference, never your name.
          </p>
          <div className="dn-actions">
            <button type="button" className="dn-btn" onClick={printReceipt}>
              <Icon name="receipt" size={16} /> Print receipt
            </button>
            <button type="button" className="dn-btn dn-btn-ink" onClick={close} autoFocus>Done</button>
          </div>
        </div>
      );
    }

    const sending = step === "sending";
    return (
      <div className="dn-body">
        <div className="dn-head">
          <span className="dn-heart" aria-hidden="true"><Icon name="heart" size={20} /></span>
          <button type="button" className="dn-x" aria-label="Close" onClick={close} disabled={sending}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <h2 id={titleId} className="dn-title">Donate to the community care fund</h2>
        <p className="dn-muted">Every dollar pays hospitals directly, after a person approves the claim. Your gift gets a public Solana receipt.</p>
        <div className="dn-presets" role="group" aria-label="Amount">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="dn-chip"
              aria-pressed={entry === String(p)}
              onClick={() => choose(String(p))}
              disabled={sending}
            >
              ${p}
            </button>
          ))}
        </div>
        <label className={`dn-custom${entry && !valid ? " is-bad" : ""}`}>
          <span className="dn-custom-label">Other amount</span>
          <span className="dn-custom-field">
            <span aria-hidden="true">$</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              aria-label="Donation amount in whole dollars"
              aria-invalid={Boolean(entry) && !valid}
              value={entry}
              onChange={(e) => choose(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void donate(); }}
              disabled={sending}
            />
          </span>
        </label>
        <p className={`dn-hint${error || (entry && !valid) ? " is-bad" : ""}`} role={error ? "alert" : undefined}>
          {error ?? (entry && !valid ? "Whole dollars, from $1 to $10,000." : "Whole dollars, from $1 to $10,000. Anonymous.")}
        </p>
        <div className="dn-actions">
          <button type="button" className="dn-btn" onClick={close} disabled={sending}>Cancel</button>
          <button type="button" className="dn-btn dn-btn-ink" onClick={() => void donate()} disabled={!valid || sending}>
            {sending ? <><span className="dn-spin" aria-hidden="true" /> Donating…</> : `Donate ${valid ? usd(dollars * 100).replace(/\.00$/, "") : ""}`}
          </button>
        </div>
      </div>
    );
  })();

  return (
    <>
      <button type="button" className={`dn-trigger ${className}`} onClick={open}>
        <Icon name="heart" size={16} /> {label}
      </button>
      {mounted &&
        createPortal(
          <dialog
            ref={sheet}
            className={`dn-sheet${step === "receipt" ? " is-receipt" : ""}`}
            aria-labelledby={titleId}
            onCancel={(e) => { e.preventDefault(); close(); }}
            onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          >
            {body}
          </dialog>,
          document.body,
        )}
    </>
  );
}
