"use client";

// One example hospital bill, step by step: each payer (insurance, the hospital's own assistance,
// the community fund) posts its payment to the bill and the balance drops to $0. It runs once by
// itself when it scrolls into view, then it's the reader's.

import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";

interface Step {
  key: "charged" | "insurance" | "hospital" | "fund";
  label: string;
  /** What the patient owes after this step. */
  owesCents: number;
  /** The payment this step posts to the bill, if any. */
  line: { label: string; cents: number } | null;
  plain: string;
}

const CHARGES = [
  { label: "Emergency visit, level 4", cents: 285_000 },
  { label: "X-ray, wrist (3 views)", cents: 135_000 },
  { label: "Splint and supplies", cents: 60_000 },
];
const CHARGED = 480_000;

const STEPS: Step[] = [
  {
    key: "charged",
    label: "The bill",
    owesCents: 480_000,
    line: null,
    plain: "One broken wrist, one emergency visit. That's the bill before anyone helps.",
  },
  {
    key: "insurance",
    label: "Insurance pays",
    owesCents: 216_000,
    line: { label: "Insurance paid", cents: 264_000 },
    plain: "After the deductible and 20% coinsurance, insurance pays $2,640.",
  },
  {
    key: "hospital",
    label: "Hospital assistance",
    owesCents: 43_200,
    line: { label: "Charity care, 80% off", cents: 172_800 },
    plain: "OpenCare checks every assistance policy the hospital has and prepares the applications. Charity care takes 80% off.",
  },
  {
    key: "fund",
    label: "Community fund",
    owesCents: 0,
    line: { label: "Community fund paid", cents: 43_200 },
    plain: "A person approves the last $432, the hospital is paid directly, and the receipt goes on the public ledger.",
  },
];

const HOLD = 3200;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Counts the shown balance toward `target` so the drop is visible. */
function useCountTo(target: number, reduced: boolean) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current;
    const began = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - began) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      // Whole dollars on the way, so cents don't flicker.
      const value = Math.round((start + (target - start) * eased) / 100) * 100;
      from.current = value;
      setShown(p === 1 ? target : value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return shown;
}

export function BillStage() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  const current = STEPS[step];
  const done = step === STEPS.length - 1;
  const owes = useCountTo(current.owesCents, reduced);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seen = new IntersectionObserver(([entry]) => entry.isIntersecting && setInView(true), { threshold: 0.45 });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  // One automatic run once the section is in view, then it's the reader's.
  useEffect(() => {
    if (!auto || reduced || done || !inView) return;
    const timer = window.setTimeout(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), step === 0 ? 1400 : HOLD);
    return () => window.clearTimeout(timer);
  }, [auto, reduced, done, step, inView]);

  const go = useCallback((next: number) => {
    setAuto(false);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  }, []);

  return (
    <section className="ln-calc" aria-labelledby="ln-calc-title" ref={ref}>
      <div className="ln-calc-copy">
        <h2 id="ln-calc-title">How a $4,800 bill gets to $0</h2>
        <ol className="ln-walk">
          {STEPS.map((s, i) => (
            <li key={s.key} data-who={s.key} data-state={i < step ? "done" : i === step ? "now" : "next"}>
              <button type="button" aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
                <span className="ln-walk-label">{s.label}</span>
                <span className="ln-walk-amount">{s.line ? `−${usd(s.line.cents)}` : usd(CHARGED)}</span>
              </button>
              {i === step && <p className="ln-walk-plain">{s.plain}</p>}
            </li>
          ))}
        </ol>
        <div className="ln-walk-nav">
          <button type="button" className="ln-pill ln-pill-quiet" onClick={() => go(step - 1)} disabled={step === 0}>
            Back
          </button>
          <button type="button" className="ln-pill ln-pill-ink" onClick={() => go(done ? 0 : step + 1)}>
            {done ? "Start over" : "Next step"}
          </button>
        </div>
      </div>

      <div className="ln-bill ln-glass">
        <p className="ln-bill-head">
          <strong>Valley General Hospital</strong>
          <span>Itemized emergency bill</span>
        </p>
        <dl className="ln-bill-lines">
          {CHARGES.map((c) => (
            <div key={c.label} className="ln-bill-charge">
              <dt>{c.label}</dt>
              <dd>{usd(c.cents)}</dd>
            </div>
          ))}
          {STEPS.map((s, i) =>
            s.line ? (
              <div key={s.key} className="ln-bill-credit" data-who={s.key} data-on={step >= i} aria-hidden={step < i}>
                <dt>{s.line.label}</dt>
                <dd>&minus;{usd(s.line.cents)}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <div className="ln-bill-bar" aria-hidden="true">
          {STEPS.map((s, i) =>
            s.line ? (
              <span key={s.key} data-who={s.key} style={{ width: step >= i ? `${(s.line.cents / CHARGED) * 100}%` : "0%" }} />
            ) : null,
          )}
          <span data-who="owed" style={{ width: `${(current.owesCents / CHARGED) * 100}%` }} />
        </div>
        <p className="ln-bill-total">
          <span>{done ? "Paid in full" : "Patient owes"}</span>
          <strong>{usd(owes)}</strong>
        </p>
      </div>
    </section>
  );
}
