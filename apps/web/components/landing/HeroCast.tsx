"use client";

// The landing hero's right half: one of three Medicare for All advocates at a time, close up in 3D,
// with their real, sourced words. Abdul El-Sayed opens; the floor passes in turn every few seconds
// until the reader picks someone.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Gesture, PortraitScene } from "./portrait-scene";

interface Speaker {
  id: string;
  name: string;
  role: string;
  model: string;
  gesture: Gesture;
  quote: string;
  source: { label: string; href: string };
}

const SPEAKERS: Speaker[] = [
  {
    id: "abdul",
    name: "Abdul El-Sayed",
    role: "Physician, former Detroit health director",
    model: "/cast/abdul-el-sayed.glb",
    gesture: "explain",
    quote:
      "Medicare for All would address the porous nature of health insurance by guaranteeing universal health insurance coverage from birth.",
    source: {
      label: "Senate testimony",
      href: "https://www.help.senate.gov/imo/media/doc/b89fe0f1-9e63-13b1-7746-d56bc2116816/El-Sayed_Medical_Debt_Testimony.pdf",
    },
  },
  {
    id: "aoc",
    name: "Alexandria Ocasio-Cortez",
    role: "U.S. Representative, New York",
    model: "/cast/alexandria-ocasio-cortez.glb",
    gesture: "present",
    quote: "Every single person who enters Elmhurst Hospital gets treated regardless of their ability to afford care.",
    source: {
      label: "House hearing",
      href: "https://docs.house.gov/meetings/GO/GO00/20220329/114542/HHRG-117-GO00-Transcript-20220329.pdf",
    },
  },
  {
    id: "bernie",
    name: "Bernie Sanders",
    role: "U.S. Senator, Vermont",
    model: "/cast/bernie-sanders.glb",
    gesture: "wag",
    quote: "We need to understand that health care is a human right and move toward Medicare for All.",
    source: {
      label: "Senate statement",
      href: "https://www.sanders.senate.gov/press-releases/news-sanders-statement-on-joining-the-senate-finance-committee/",
    },
  },
];

/** How long each speaker holds the floor, in ms. Longer quotes hold longer. */
const HOLD = SPEAKERS.map((s) => 4200 + s.quote.length * 38);
/** The canvas fades out, the speaker changes, and it fades back in. */
const SWAP_MS = 280;

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

export function HeroCast() {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<boolean[]>(() => SPEAKERS.map(() => false));
  const [swapping, setSwapping] = useState(false);
  const [auto, setAuto] = useState(true);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PortraitScene | null>(null);
  const shownRef = useRef(-1);

  // Start the 3D scene. Three.js loads only here, after the page is up.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stopped = false;
    void import("./portrait-scene").then(({ startPortraitScene }) => {
      if (stopped) return;
      sceneRef.current = startPortraitScene({
        canvas,
        members: SPEAKERS.map((s) => ({ id: s.id, modelUrl: s.model, gesture: s.gesture })),
        isReduced: () => reducedRef.current,
        onLoaded: (i) => setLoaded((l) => l.map((v, j) => v || j === i)),
        onFailed: () => {},
      });
    });
    return () => {
      stopped = true;
      sceneRef.current?.stop();
      sceneRef.current = null;
    };
  }, []);

  // Put the current speaker on stage once their model is in; fade across a change of speaker.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !loaded[index] || shownRef.current === index) return;
    if (shownRef.current < 0 || reduced) {
      shownRef.current = index;
      scene.show(index);
      return;
    }
    setSwapping(true);
    const timer = window.setTimeout(() => {
      shownRef.current = index;
      scene.show(index);
      setSwapping(false);
    }, SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [index, loaded, reduced]);

  // Pass the floor in turn until the reader picks someone.
  const next = (index + 1) % SPEAKERS.length;
  useEffect(() => {
    if (!auto || reduced || !loaded[index] || !loaded[next]) return;
    const timer = window.setTimeout(() => setIndex(next), HOLD[index]);
    return () => window.clearTimeout(timer);
  }, [auto, reduced, index, next, loaded]);

  const pick = (i: number) => {
    setAuto(false);
    setIndex(i);
  };

  const s = SPEAKERS[index];
  const ready = loaded[index] && shownRef.current === index && !swapping;

  return (
    <div
      className="ln-portrait"
      onPointerMove={(e) => sceneRef.current?.setPointer({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => sceneRef.current?.setPointer(null)}
    >
      <canvas className="ln-portrait-canvas" ref={canvasRef} data-on={ready} aria-hidden="true" />

      <figure className="ln-say ln-glass" key={s.id} aria-live={auto ? "off" : "polite"}>
        <blockquote cite={s.source.href}>&ldquo;{s.quote}&rdquo;</blockquote>
        <figcaption>
          <strong>{s.name}</strong>
          <span>{s.role}</span>
          <a href={s.source.href} target="_blank" rel="noreferrer">
            {s.source.label}
          </a>
        </figcaption>
      </figure>

      <div className="ln-who" role="group" aria-label="Choose who speaks">
        {SPEAKERS.map((sp, i) => (
          <button
            type="button"
            key={sp.id}
            aria-pressed={i === index}
            onClick={() => pick(i)}
            style={{ "--hold": `${HOLD[i]}ms` } as CSSProperties}
            data-run={auto && !reduced && i === index && loaded[index] && loaded[next] ? "true" : undefined}
          >
            {sp.name.split(" ").at(-1)}
          </button>
        ))}
      </div>
    </div>
  );
}
