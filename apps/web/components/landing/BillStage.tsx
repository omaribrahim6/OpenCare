"use client";

// The landing page's centerpiece: one demo hospital bill and three 3D figures. The bill has the
// first step (the figures turn to look at it); each payer after that (insurance, hospital
// assistance, community fund) belongs to one figure, who steps forward with a real, sourced quote
// while the bill card posts the payment and the balance drops.

import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";
import type { CastScene, Gesture } from "./cast-scene";

interface Step {
  key: "charged" | "insurance" | "hospital" | "fund";
  label: string;
  /** What the patient owes after this step. */
  owesCents: number;
  /** The payment this step posts to the bill, if any. */
  line: { label: string; cents: number } | null;
  /** The figure who has the floor, or null when it's the bill's turn. */
  who: { name: string; model: string; gesture: Gesture } | null;
  /** The figure's real quote, or the page's own line when nobody is speaking. */
  quote: string;
  source: { label: string; href: string } | null;
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
    label: "Charged",
    owesCents: 480_000,
    line: null,
    who: null,
    quote: "One broken wrist. One emergency visit. $4,800.",
    source: null,
    plain: "That's the bill before anyone helps. Three payers take their turn before the patient pays anything.",
  },
  {
    key: "insurance",
    label: "After insurance",
    owesCents: 216_000,
    line: { label: "Insurance paid", cents: 264_000 },
    who: { name: "Abdul El-Sayed", model: "/cast/abdul-el-sayed.glb", gesture: "explain" },
    quote:
      "Medicare for All would address the porous nature of health insurance by guaranteeing universal health insurance coverage from birth.",
    source: {
      label: "Senate testimony",
      href: "https://www.help.senate.gov/imo/media/doc/b89fe0f1-9e63-13b1-7746-d56bc2116816/El-Sayed_Medical_Debt_Testimony.pdf",
    },
    plain:
      "Insurance goes first. After the deductible and 20% coinsurance it pays $2,640, which still leaves the patient $2,160.",
  },
  {
    key: "hospital",
    label: "After hospital assistance",
    owesCents: 43_200,
    line: { label: "Charity care, 80% off", cents: 172_800 },
    who: { name: "Alexandria Ocasio-Cortez", model: "/cast/alexandria-ocasio-cortez.glb", gesture: "point" },
    quote: "Every single person who enters Elmhurst Hospital gets treated regardless of their ability to afford care.",
    source: {
      label: "House hearing",
      href: "https://docs.house.gov/meetings/GO/GO00/20220329/114542/HHRG-117-GO00-Transcript-20220329.pdf",
    },
    plain:
      "Hospitals have their own assistance policies. OpenCare checks every one and prepares the applications. Here, charity care takes 80% off.",
  },
  {
    key: "fund",
    label: "After the community fund",
    owesCents: 0,
    line: { label: "Community fund paid", cents: 43_200 },
    who: { name: "Bernie Sanders", model: "/cast/bernie-sanders.glb", gesture: "wag" },
    quote: "We need to understand that health care is a human right and move toward Medicare for All.",
    source: {
      label: "Senate statement",
      href: "https://www.sanders.senate.gov/press-releases/news-sanders-statement-on-joining-the-senate-finance-committee/",
    },
    plain:
      "Donors cover what's left. A person approves the $432, the hospital is paid directly, and the receipt goes on the public ledger.",
  },
];

/** How long each step holds during the one automatic run, in ms. Longer quotes hold longer. */
const HOLD = STEPS.map((s) => 3400 + s.quote.length * 34);

/** The steps that have a figure; the scene numbers its cast in this order. */
const CAST = STEPS.flatMap((s, i) => (s.who ? [{ step: i, key: s.key, who: s.who }] : []));

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
  const [arrived, setArrived] = useState(0);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sceneRef = useRef<CastScene | null>(null);
  const billRef = useRef<HTMLDivElement>(null);

  const current = STEPS[step];
  const done = step === STEPS.length - 1;
  const owes = useCountTo(current.owesCents, reduced);
  const ready = arrived >= CAST.length;

  // Start the 3D cast once the stage is on the page. Three.js loads only here.
  useEffect(() => {
    const canvas = canvasRef.current;
    const slots = slotRefs.current;
    if (!canvas || CAST.some((_, i) => !slots[i])) return;
    let stopped = false;
    void import("./cast-scene").then(({ startCastScene }) => {
      if (stopped) return;
      sceneRef.current = startCastScene({
        canvas,
        members: CAST.map((c, i) => ({ id: c.key, modelUrl: c.who.model, slot: slots[i]!, gesture: c.who.gesture })),
        focus: billRef.current,
        isReduced: () => reducedRef.current,
        onLoaded: () => setArrived((n) => n + 1),
        onFailed: () => {},
      });
    });
    return () => {
      stopped = true;
      sceneRef.current?.stop();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setActive(CAST.findIndex((c) => c.step === step));
    // Once the bill is paid, the speaker gets a moment and then everyone turns to the reader.
    sceneRef.current?.setCheer(false);
    if (!done) return;
    const timer = window.setTimeout(() => sceneRef.current?.setCheer(true), reduced ? 0 : HOLD[step]);
    return () => window.clearTimeout(timer);
  }, [step, done, reduced, arrived]);

  // One automatic run through the steps, then it's the reader's.
  useEffect(() => {
    if (!auto || reduced || done || !ready) return;
    const timer = window.setTimeout(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), HOLD[step]);
    return () => window.clearTimeout(timer);
  }, [auto, reduced, done, step, ready]);

  const go = useCallback((next: number) => {
    setAuto(false);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  }, []);

  return (
    <section
      className="ln-stage"
      aria-label="Example: one hospital bill, step by step"
      data-ready={ready}
      onPointerMove={(e) => sceneRef.current?.setPointer({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => sceneRef.current?.setPointer(null)}
    >
      <canvas className="ln-cast-canvas" ref={canvasRef} aria-hidden="true" />

      <ol className="ln-steps">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button type="button" aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
              <span className="ln-step-label">{s.label}</span>
              <span className="ln-step-amount">{usd(s.owesCents)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="ln-floor">
        <div className="ln-bill ln-glass" ref={billRef}>
          <p className="ln-bill-head">
            <strong>Valley General Hospital</strong>
            <span>Demo bill from a fictional hospital</span>
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
            <span>
              {done ? "Paid in full" : "You owe"}
              <small>
                Step {step + 1} of {STEPS.length}
              </small>
            </span>
            <strong>{usd(owes)}</strong>
          </p>
        </div>

        <div className="ln-cast">
          {CAST.map((c, i) => (
            <div className="ln-slot" key={c.key} data-who={c.key} data-active={c.step === step}>
              <div
                className="ln-figure"
                ref={(el) => {
                  slotRefs.current[i] = el;
                }}
              />
            </div>
          ))}
        </div>

        <div className="ln-voice ln-glass" aria-live={auto ? "off" : "polite"}>
          <figure className="ln-voice-quote" key={current.key}>
            {current.who && current.source ? (
              <>
                <blockquote cite={current.source.href}>&ldquo;{current.quote}&rdquo;</blockquote>
                <figcaption>
                  <strong>{current.who.name}</strong>
                  <a href={current.source.href} target="_blank" rel="noreferrer">
                    {current.source.label}
                  </a>
                </figcaption>
              </>
            ) : (
              <p className="ln-voice-line">{current.quote}</p>
            )}
          </figure>
          <p className="ln-voice-plain" key={`${current.key}-plain`}>
            {current.plain}
          </p>
          <div className="ln-voice-nav">
            <button type="button" className="ln-pill ln-pill-quiet" onClick={() => go(step - 1)} disabled={step === 0}>
              Back
            </button>
            <button type="button" className="ln-pill ln-pill-ink" onClick={() => go(done ? 0 : step + 1)}>
              {done ? "Start over" : "Next step"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
