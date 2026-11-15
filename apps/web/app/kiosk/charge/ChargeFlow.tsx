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
  MAX_LABEL,
  MAX_LINES,
  money,
  parseCents,
  total,
  type ChargeLine,
} from "./bill";
import { CARD_PATH, savePending } from "./pending";
import { Summary } from "./Summary";

// /kiosk/charge: hospital staff build an itemized bill and press Charge. The patient then sees the
// bill and scans a card or phone at the top of the kiosk phone, which opens /kiosk/charge/card:
// insurance and the hospital's policy come off there, then the patient pays the rest or asks the
// community care fund. Holding a finger on the reader opens the same page, for presenters.

type Row = { key: number; label: string; amount: string };
type Phase = "build" | "tap" | "reading";

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

export function ChargeFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("build");
  const [rows, setRows] = useState<Row[]>(() => [row()]);
  const [preset, setPreset] = useState<string | null>(null);
  const [bill, setBill] = useState<ChargeLine[] | null>(null);
  const [holding, setHolding] = useState(false);
  const hold = useRef(0);

  useEffect(() => () => window.clearTimeout(hold.current), []);

  const lines = linesOf(rows);
  const original = lines ? total(lines) : rows.reduce((s, r) => s + (parseCents(r.amount) ?? 0), 0);
  const canCharge = lines !== null && lines.length > 0 && lines.length <= MAX_LINES;

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const loadPreset = () => {
    setRows(CAR_ACCIDENT_PRESET.map((l) => row(l.label, l.cents)));
    setPreset(CAR_ACCIDENT_PRESET_ID);
  };
  const clearBill = () => {
    setRows([row()]);
    setPreset(null);
  };

  // Charge: save the bill for /kiosk/charge/card, then wait for the card scan, which opens that page.
  const charge = () => {
    if (!lines || !canCharge) return;
    savePending({ items: lines, preset, createdAt: new Date().toISOString(), outcome: null });
    setBill(lines);
    setPhase("tap");
  };
  const cancelCharge = () => {
    window.clearTimeout(hold.current);
    setHolding(false);
    setPhase("build");
  };
  const readByHold = () => {
    setHolding(false);
    setPhase("reading");
    router.push(`${CARD_PATH}?via=hold`);
  };
  const startHold = () => {
    window.clearTimeout(hold.current);
    setHolding(true);
    hold.current = window.setTimeout(readByHold, HOLD_MS);
  };
  const endHold = () => {
    window.clearTimeout(hold.current);
    setHolding(false);
  };

  if (phase !== "build" && bill) {
    return (
      <main className="kc-scan kc">
        <section className="kc-pay" aria-labelledby="kc-title">
          {/* The reader sits at the top edge, over the phone's NFC antenna. A finger held on it
              for a second also reads the card: the presenter fallback. */}
          <button
            type="button"
            className={`kc-disc${holding ? " is-holding" : ""}${phase === "reading" ? " is-paying" : ""}`}
            aria-label="Card reader"
            disabled={phase === "reading"}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") readByHold(); }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="kc-ring" />
            <span className="kc-ring" />
            <span className="kc-fill" />
            {phase === "reading" ? <span className="kc-spin kc-spin-lg" /> : <Icon name="tap" size={44} strokeWidth={1.6} />}
          </button>
          <h1 id="kc-title">
            {phase === "reading" ? "CareCard read" : <>Tap your CareCard on the <span className="kc-hl">top</span> of this phone</>}
            {phase !== "reading" && (
              <svg className="kc-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
            )}
          </h1>
          <p className="kc-nfc" role="status">
            {phase === "reading" ? "Checking your insurance…" : "We'll take off your insurance and the hospital's help before you pay anything."}
          </p>
        </section>
        <section className="kc-billcard" aria-label="Your bill">
          <h2>Your bill</h2>
          <Summary items={bill} finalLabel="Amount due" />
        </section>
        {phase === "tap" && <button type="button" className="kc-skip" onClick={cancelCharge}>Cancel</button>}
      </main>
    );
  }

  return (
    <main className="page station station-session kc kc-build">
      <div className="station-bar">
        <Logo href={null} />
        <span className="kc-who"><Icon name="hospital" size={15} /> Hospital staff</span>
      </div>
      {!LIVE && <p className="kc-demo"><Icon name="info" size={15} /> Demo · simulated payment</p>}

      <section aria-labelledby="kc-title">
        <h1 id="kc-title">Itemized bill</h1>
        <p className="muted kc-sub">Add each charge, then hand the phone to the patient.</p>

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
        <button type="button" className="kc-add" onClick={() => setRows((rs) => [...rs, row()])} disabled={rows.length >= MAX_LINES}>
          <Icon name="plus" size={16} /> Add line item
        </button>

        {/* The final charge and the Charge button stay on screen while staff scroll the lines. */}
        <div className="kc-checkout">
          {lines === null && <p className="kc-hint" role="status">Every line needs a description and an amount above $0.</p>}
          <div className="kc-total">
            <span>Final charge · {lines?.length ?? 0} {lines?.length === 1 ? "item" : "items"}</span>
            <strong>{money(original)}</strong>
          </div>
          <button type="button" className="btn btn-lg kc-primary" disabled={!canCharge} onClick={charge}>
            <Icon name="card" size={18} /> Charge patient
          </button>
        </div>
      </section>
    </main>
  );
}
