"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { LIVE } from "@/lib/api";
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
} from "./bill";
import { PAID_PATH, savePending } from "./pending";
import { Summary } from "./Summary";

// /kiosk/charge: hospital staff build an itemized bill, run the discount search and press Charge.
// The patient then scans a card or phone at the top of the kiosk phone, which opens
// /kiosk/charge/paid (the receipt, sent to /admin). Holding a finger on the reader opens the same
// page, for presenters. The payment is simulated: no card data is ever read.

type Row = { key: number; label: string; amount: string };
type Phase = "build" | "search" | "review" | "tap" | "paying";

const HOLD_MS = 1200;

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

export function ChargeFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("build");
  const [rows, setRows] = useState<Row[]>(() => [row()]);
  const [preset, setPreset] = useState<string | null>(null);
  const [bill, setBill] = useState<{ items: ChargeLine[]; discounts: ChargeLine[] } | null>(null);
  const [found, setFound] = useState(0); // search steps finished
  const [holding, setHolding] = useState(false);
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

  useEffect(() => () => {
    window.clearTimeout(hold.current);
    run.current++;
  }, []);

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

  // ---- Charge: save the bill for /kiosk/charge/paid, then wait for the card scan, which opens
  // that page. A finger held on the reader opens it too.

  const charge = () => {
    if (!bill) return;
    savePending({ ...bill, preset, createdAt: new Date().toISOString(), receipt: null });
    setPhase("tap");
  };
  const cancelCharge = () => {
    window.clearTimeout(hold.current);
    setHolding(false);
    setPhase("review");
  };
  const paidByHold = () => {
    setHolding(false);
    setPhase("paying");
    router.push(`${PAID_PATH}?via=hold`);
  };
  const startHold = () => {
    window.clearTimeout(hold.current);
    setHolding(true);
    hold.current = window.setTimeout(paidByHold, HOLD_MS);
  };
  const endHold = () => {
    window.clearTimeout(hold.current);
    setHolding(false);
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
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") paidByHold(); }}
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
          <p className="kc-nfc" role="status">{phase === "paying" ? "Processing payment (simulated)…" : "Waiting for your card…"}</p>
          <div className="kc-due">
            <span>Amount due</span>
            <strong>{money(paidCents)}</strong>
          </div>
          {phase === "tap" && <button type="button" className="kc-skip" onClick={cancelCharge}>Cancel</button>}
        </section>
      )}

    </main>
  );
}
