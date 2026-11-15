"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { LIVE, sendKioskCharge, type KioskChargeResult } from "@/lib/api";
import {
  CAR_ACCIDENT_PRESET,
  CAR_ACCIDENT_PRESET_ID,
  centsText,
  discountsFor,
  MAX_LABEL,
  MAX_LINES,
  money,
  parseCents,
  SEARCH_STEP_MS,
  SEARCH_STEPS,
  total,
  type ChargeLine,
  type ChargeMethod,
} from "./bill";
import { watchForTap, type NfcWatch } from "./nfc";

// /kiosk/charge: hospital staff build an itemized bill, run the discount search, then hand the
// phone to the patient, who taps a phone or card to pay. The receipt goes to /admin. The payment
// is simulated: no card data is ever read.

type Row = { key: number; label: string; amount: string };
type Phase = "build" | "search" | "review" | "tap" | "paying" | "receipt";
type NfcState = "off" | "starting" | "on" | "blocked";

const HOLD_MS = 1200;
const PAYING_MS = 1800;

let nextKey = 1;
const row = (label = "", cents?: number): Row => ({ key: nextKey++, label, amount: cents ? centsText(cents) : "" });

/** Rows that are filled in correctly, as bill lines. Null if any row is half filled or invalid. */
function linesOf(rows: Row[]): ChargeLine[] | null {
  const lines: ChargeLine[] = [];
  for (const r of rows) {
    const label = r.label.trim();
    if (!label && !r.amount.trim()) continue;
    const cents = parseCents(r.amount);
    if (!label || label.length > MAX_LABEL || cents === null) return null;
    lines.push({ label, cents });
  }
  return lines;
}

/** Counts a shown amount toward `target`. */
function useCountTo(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = p < 1 ? Math.round(begin + (target - begin) * eased) : target;
      setShown(value);
      from.current = value;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

const receiptNumber = () => `KC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const SEND_NOTE: Record<Exclude<KioskChargeResult, { sent: true }>["reason"], string> = {
  mock: "Demo mode: this receipt stays on this phone.",
  not_kiosk: "Not sent to admin: pair this phone as a kiosk with the staff PIN first.",
  unavailable: "Not sent to admin yet: the admin route isn't live. The receipt stays on this phone.",
  failed: "Couldn't reach admin. The receipt stays on this phone.",
};

export function ChargeFlow() {
  const [phase, setPhase] = useState<Phase>("build");
  const [rows, setRows] = useState<Row[]>(() => [row()]);
  const [preset, setPreset] = useState<string | null>(null);
  const [bill, setBill] = useState<{ items: ChargeLine[]; discounts: ChargeLine[] } | null>(null);
  const [found, setFound] = useState(0); // search steps finished
  const [method, setMethod] = useState<ChargeMethod>("hold");
  const [nfc, setNfc] = useState<NfcState>("off");
  const [holding, setHolding] = useState(false);
  const [sent, setSent] = useState<KioskChargeResult | null>(null);
  const [receipt, setReceipt] = useState<{ no: string; at: Date } | null>(null);
  const watch = useRef<NfcWatch | null>(null);
  const hold = useRef(0);
  const run = useRef(0);

  const lines = linesOf(rows);
  const original = lines ? total(lines) : rows.reduce((s, r) => s + (parseCents(r.amount) ?? 0), 0);
  const items = bill?.items ?? [];
  const discounts = bill?.discounts ?? [];
  const billOriginal = total(items);
  const discountCents = total(discounts);
  const paidCents = billOriginal - discountCents;

  // Discounts found so far, for the running total during the search.
  const foundCents = SEARCH_STEPS.slice(0, found).reduce((s, step) => s + (step.finds === null ? 0 : discounts[step.finds]?.cents ?? 0), 0);
  const running = useCountTo(phase === "search" ? billOriginal - foundCents : phase === "build" ? original : paidCents);

  const stopNfc = useCallback(() => {
    watch.current?.stop();
    watch.current = null;
  }, []);
  useEffect(() => () => {
    stopNfc();
    window.clearTimeout(hold.current);
    run.current++;
  }, [stopNfc]);

  // ---- Build

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const loadPreset = () => {
    setRows(CAR_ACCIDENT_PRESET.map((l) => row(l.label, l.cents)));
    setPreset(CAR_ACCIDENT_PRESET_ID);
  };
  const clearBill = () => {
    setRows([row()]);
    setPreset(null);
  };
  const canSearch = lines !== null && lines.length > 0 && lines.length <= MAX_LINES;

  // ---- Discount search: about 20 s, one step at a time.

  const startSearch = async () => {
    if (!lines || !canSearch) return;
    const id = ++run.current;
    setBill({ items: lines, discounts: discountsFor(total(lines)) });
    setFound(0);
    setPhase("search");
    for (let n = 1; n <= SEARCH_STEPS.length; n++) {
      await new Promise((r) => window.setTimeout(r, SEARCH_STEP_MS));
      if (id !== run.current) return;
      setFound(n);
    }
    await new Promise((r) => window.setTimeout(r, 700));
    if (id === run.current) setPhase("review");
  };
  const skipSearch = () => {
    run.current++;
    setFound(SEARCH_STEPS.length);
    setPhase("review");
  };

  // ---- Charge: the patient taps a phone or card (Web NFC), or holds the circle.

  const paid = useCallback((how: ChargeMethod) => {
    if (!bill) return;
    stopNfc();
    window.clearTimeout(hold.current);
    setHolding(false);
    setMethod(how);
    navigator.vibrate?.(60);
    setPhase("paying");
    setSent(null);
    setReceipt({ no: receiptNumber(), at: new Date() });
    const id = ++run.current;
    const sending = sendKioskCharge({ items: bill.items, discounts: bill.discounts, method: how, preset });
    void Promise.all([sending, new Promise((r) => window.setTimeout(r, PAYING_MS))]).then(([result]) => {
      if (id !== run.current) return;
      setSent(result);
      setPhase("receipt");
    });
  }, [bill, preset, stopNfc]);

  const charge = () => {
    setPhase("tap");
    // Staff pressing Charge is the user gesture Web NFC needs to start scanning.
    const w = watchForTap(() => paid("nfc"));
    watch.current = w;
    if (!w) return setNfc("off");
    setNfc("starting");
    w.ready.then(() => setNfc((s) => (s === "starting" ? "on" : s))).catch(() => {
      if (watch.current === w) watch.current = null;
      setNfc("blocked");
    });
  };
  const cancelCharge = () => {
    stopNfc();
    window.clearTimeout(hold.current);
    setHolding(false);
    setPhase("review");
  };
  const startHold = () => {
    window.clearTimeout(hold.current);
    setHolding(true);
    hold.current = window.setTimeout(() => paid("hold"), HOLD_MS);
  };
  const endHold = () => {
    window.clearTimeout(hold.current);
    setHolding(false);
  };

  const newBill = () => {
    run.current++;
    stopNfc();
    setBill(null);
    setSent(null);
    setReceipt(null);
    setFound(0);
    clearBill();
    setPhase("build");
  };

  // ---- Screens

  const staff = phase === "build" || phase === "search" || phase === "review";
  const scanning = phase === "tap" || phase === "paying";

  return (
    <main className={`${scanning ? "kc-scan" : "page station station-session"} kc kc-${phase}`}>
      {!scanning && <div className="station-bar">
        <Logo href={null} />
        <span className="kc-who">{staff ? <><Icon name="hospital" size={15} /> Hospital staff</> : <><Icon name="user" size={15} /> Patient</>}</span>
      </div>}
      {!LIVE && !scanning && <p className="kc-demo"><Icon name="info" size={15} /> Demo · simulated payment</p>}

      {phase === "build" && (
        <section aria-labelledby="kc-title">
          <h1 id="kc-title">Itemized bill</h1>
          <p className="muted kc-sub">Add each charge before the patient pays.</p>

          <div className="kc-tools">
            <button type="button" className="btn secondary" onClick={loadPreset}>
              <Icon name="sparkles" size={16} /> Car accident demo
            </button>
            <button type="button" className="btn secondary" onClick={clearBill} disabled={rows.length === 1 && !rows[0].label && !rows[0].amount}>
              Clear
            </button>
          </div>

          <ol className="kc-lines">
            {rows.map((r, n) => {
              const bad = r.amount.trim() !== "" && parseCents(r.amount) === null;
              return (
                <li key={r.key} className="kc-line">
                  <input
                    className="kc-label"
                    aria-label={`Line ${n + 1} description`}
                    placeholder="Description"
                    value={r.label}
                    maxLength={MAX_LABEL}
                    onChange={(e) => setRow(r.key, { label: e.target.value })}
                  />
                  <label className={`kc-amount${bad ? " is-bad" : ""}`}>
                    <span aria-hidden="true">$</span>
                    <input
                      aria-label={`Line ${n + 1} amount in dollars`}
                      aria-invalid={bad}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) => setRow(r.key, { amount: e.target.value })}
                      onBlur={() => {
                        const cents = parseCents(r.amount);
                        if (cents !== null) setRow(r.key, { amount: centsText(cents) });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="kc-remove"
                    aria-label={`Remove line ${n + 1}`}
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [row()]))}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="kc-add"
            onClick={() => setRows((rs) => [...rs, row()])}
            disabled={rows.length >= MAX_LINES}
          >
            <Icon name="plus" size={16} /> Add line item
          </button>

          <div className="kc-total">
            <span>Total charges · {lines?.length ?? 0} {lines?.length === 1 ? "item" : "items"}</span>
            <strong>{money(running)}</strong>
          </div>
          {lines === null && <p className="kc-hint" role="status">Every line needs a description and an amount above $0.</p>}
          <button type="button" className="btn btn-lg kc-primary" disabled={!canSearch} onClick={() => void startSearch()}>
            <Icon name="search" size={18} /> Find discounts
          </button>
        </section>
      )}

      {phase === "search" && (
        <section aria-labelledby="kc-title">
          <h1 id="kc-title">Searching for discounts</h1>
          <p className="muted kc-sub">Checking every program this bill could qualify for.</p>
          <div className="kc-total kc-big">
            <span>Balance</span>
            <strong>{money(running)}</strong>
            <div className="kc-meter" role="progressbar" aria-valuemin={0} aria-valuemax={SEARCH_STEPS.length} aria-valuenow={found} aria-label="Discount search progress">
              <i style={{ width: `${(found / SEARCH_STEPS.length) * 100}%` }} />
            </div>
            <small>{foundCents > 0 ? `${money(foundCents)} found so far` : `${money(billOriginal)} charged`}</small>
          </div>
          <ol className="kc-steps" aria-live="polite">
            {SEARCH_STEPS.slice(0, Math.min(found + 1, SEARCH_STEPS.length)).map((step, n) => {
              const done = n < found;
              const d = step.finds === null ? null : discounts[step.finds];
              return (
                <li key={step.label} data-done={done || undefined}>
                  <span className={done ? "kc-tick" : "kc-spin"} aria-hidden="true">{done && <Icon name="check" size={14} />}</span>
                  <span>{step.label}{done ? "" : "…"}</span>
                  {done && d && <b>−{money(d.cents)}</b>}
                </li>
              );
            })}
          </ol>
          <button type="button" className="kc-skip" onClick={skipSearch}>Skip</button>
        </section>
      )}

      {phase === "review" && bill && (
        <section aria-labelledby="kc-title">
          <h1 id="kc-title">Discounts applied</h1>
          <p className="muted kc-sub">{Math.round((discountCents / billOriginal) * 100)}% off the itemized bill.</p>
          <Summary items={items} discounts={discounts} />
          <button type="button" className="btn btn-lg kc-primary" onClick={charge}>
            <Icon name="card" size={18} /> Charge {money(paidCents)}
          </button>
          <button type="button" className="kc-skip" onClick={() => setPhase("build")}>Edit bill</button>
        </section>
      )}

      {(phase === "tap" || phase === "paying") && (
        <section className="kc-pay" aria-labelledby="kc-title">
          {/* The reader sits at the top edge, over the phone's NFC antenna. A finger held on it
              for a second also pays: the presenter fallback where there's no Web NFC (iPhone). */}
          <button
            type="button"
            className={`kc-disc${holding ? " is-holding" : ""}${phase === "paying" ? " is-paying" : ""}`}
            aria-label="Card reader"
            disabled={phase === "paying"}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") paid("hold"); }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="kc-ring" />
            <span className="kc-ring" />
            <span className="kc-fill" />
            {phase === "paying" ? <span className="kc-spin kc-spin-lg" /> : <Icon name="tap" size={44} strokeWidth={1.6} />}
          </button>
          <h1 id="kc-title">
            {phase === "paying" ? "Card read" : <>Hold your card or phone to the <span className="kc-hl">top</span> of this phone</>}
            {phase !== "paying" && (
              <svg className="kc-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
            )}
          </h1>
          <p className="kc-nfc" role="status">
            {phase === "paying" ? "Processing payment (simulated)…" :
              nfc === "starting" ? "Turning on the card reader…" :
              nfc === "blocked" ? "Turn on NFC in this phone's settings to use the card reader." :
              "Waiting for your card…"}
          </p>
          <div className="kc-due">
            <span>Amount due</span>
            <strong>{money(paidCents)}</strong>
          </div>
          {phase === "tap" && <button type="button" className="kc-skip" onClick={cancelCharge}>Cancel</button>}
        </section>
      )}

      {phase === "receipt" && bill && receipt && (
        <section aria-labelledby="kc-title">
          <div className="kc-paid">
            <Icon name="checkCircle" size={30} />
            <div>
              <h1 id="kc-title">Paid {money(paidCents)}</h1>
              <p className="muted">
                {receipt.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {receipt.no}
              </p>
            </div>
          </div>
          <Summary items={items} discounts={discounts} paid />
          <dl className="kc-meta">
            <div><dt>Paid with</dt><dd>{method === "nfc" ? "Contactless card (NFC)" : "Contactless card"}</dd></div>
            <div><dt>Payment</dt><dd>Simulated · no card data read</dd></div>
          </dl>
          <p className={`kc-sent${sent?.sent ? " is-sent" : ""}`} role="status">
            <Icon name={sent?.sent ? "check" : "info"} size={15} />
            {sent?.sent ? "Sent to admin for review." : sent ? SEND_NOTE[sent.reason] : "Sending to admin…"}
          </p>
          <button type="button" className="btn btn-lg kc-primary" onClick={newBill}>
            <Icon name="plus" size={18} /> New bill
          </button>
        </section>
      )}
    </main>
  );
}

/** Original charges (itemized, collapsible), each discount, and what the patient pays. */
function Summary({ items, discounts, paid = false }: { items: ChargeLine[]; discounts: ChargeLine[]; paid?: boolean }) {
  const original = total(items);
  const off = total(discounts);
  return (
    <div className="kc-summary">
      <details>
        <summary>
          <span>Original bill · {items.length} {items.length === 1 ? "item" : "items"}</span>
          <b>{money(original)}</b>
        </summary>
        <ul>
          {items.map((l, n) => <li key={`${n}-${l.label}`}><span>{l.label}</span><span>{money(l.cents)}</span></li>)}
        </ul>
      </details>
      {discounts.map((d) => (
        <div key={d.label} className="kc-row kc-off"><span>{d.label}</span><b>−{money(d.cents)}</b></div>
      ))}
      <div className="kc-row kc-off kc-subtle"><span>Total discount</span><b>−{money(off)}</b></div>
      <div className="kc-row kc-final"><span>{paid ? "Paid" : "Patient pays"}</span><b>{money(original - off)}</b></div>
    </div>
  );
}
