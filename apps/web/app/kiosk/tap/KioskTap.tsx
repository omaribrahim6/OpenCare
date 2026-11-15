"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startKioskDemoSession, startPatientDemo } from "@/lib/api";

// The kiosk welcome screen (SPEC §4, screen 1): a rigged character hangs from the
// scanner disc at the top of the phone, where the NFC antenna is.

export type KioskLang = "en" | "es" | "ar";

const COPY: Record<KioskLang, {
  dir: "ltr" | "rtl";
  title: string;
  head: [string, string, string];
  tapHere: string;
  useCard: string;
  ended: string;
}> = {
  en: {
    dir: "ltr",
    title: "Touch your CareCard to the top of the phone",
    head: ["Touch your CareCard to the ", "top", " of the phone"],
    tapHere: "Tap here",
    useCard: "Use your card",
    ended: "Your session has ended.",
  },
  es: {
    dir: "ltr",
    title: "Toque la parte superior del teléfono con su CareCard",
    head: ["Toque la ", "parte superior", " del teléfono con su CareCard"],
    tapHere: "Toque aquí",
    useCard: "Use su tarjeta",
    ended: "Su sesión terminó.",
  },
  ar: {
    dir: "rtl",
    title: "ضع بطاقة CareCard على أعلى الهاتف",
    head: ["ضع بطاقة CareCard على ", "أعلى الهاتف", ""],
    tapHere: "المس هنا",
    useCard: "استخدم بطاقتك",
    ended: "انتهت جلستك.",
  },
};

const CHARACTERS: Record<string, string> = {
  abdul: "abdul-el-sayed",
  aoc: "alexandria-ocasio-cortez",
  bernie: "bernie-sanders",
  trump: "donald-trump",
};

/**
 * Holding the scanner this long with a finger starts the demo patient (for presenters). On a
 * paired kiosk it is a real session that goes through the whole system; elsewhere it stays in
 * this browser with fictional data.
 */
const DEMO_HOLD_MS = 1200;

type Floater = { kind: string; style: React.CSSProperties };
type Stream = { t: number; wobble: number; dur: number; delay: number; len: number; alt: boolean };

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function KioskTap({ lang, ended, who }: { lang: KioskLang; ended: boolean; who?: string }) {
  const t = COPY[lang];
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scanner = useRef<HTMLDivElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const streams = useRef<SVGSVGElement>(null);
  const pokedAt = useRef(-1e9);
  const kick = useRef<() => void>(() => {});
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [scene, setScene] = useState<"loading" | "in" | "none">("loading");
  const [poked, setPoked] = useState(false);
  const [showEnded, setShowEnded] = useState(ended);

  // Restart a one-shot CSS animation on the scanner.
  const flash = (cls: string) => {
    const el = scanner.current;
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  // Floating shapes are random, so they are made after hydration.
  useEffect(() => {
    const kinds = ["plus", "plus", "plus w", "dot", "dot", "ring", "card"];
    setFloaters(Array.from({ length: 26 }, () => {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const size = kind === "card" ? rand(16, 26) : kind === "dot" ? rand(4, 9) : rand(9, 18);
      return {
        kind,
        style: {
          "--x": `${rand(-2, 98).toFixed(1)}%`,
          "--s": `${size.toFixed(1)}px`,
          "--d": `${rand(9, 18).toFixed(1)}s`,
          "--delay": `${(-rand(0, 18)).toFixed(1)}s`,
          "--sway": `${rand(-40, 40).toFixed(0)}px`,
          "--spin": `${rand(-200, 200).toFixed(0)}deg`,
          "--o": rand(0.35, 0.85).toFixed(2),
        } as React.CSSProperties,
      };
    }));
  }, []);

  // Streams: curves from the screen edges into the scanner, each carrying a comet.
  useEffect(() => {
    const svg = streams.current;
    const box = scanner.current;
    const head = headline.current;
    const el = root.current;
    if (!svg || !box || !head || !el) return;
    const seeds: Stream[] = Array.from({ length: 11 }, (_, i) => ({
      t: i / 10,
      wobble: rand(-0.18, 0.18),
      dur: rand(3.8, 6.5),
      delay: -rand(0, 6),
      len: rand(60, 130),
      alt: Math.random() < 0.3,
    }));
    const draw = () => {
      const w = document.documentElement.clientWidth;
      const h = window.innerHeight;
      const r = box.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const R = r.width / 2;
      el.style.setProperty("--kt-fg-h", `${Math.max(120, h - head.getBoundingClientRect().top + 50)}px`);
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.textContent = "";
      for (const seed of seeds) {
        // Start points sweep from the left edge, along the bottom, up the right edge.
        const u = seed.t * 3;
        let x0: number;
        let y0: number;
        if (u < 0.7) { x0 = -20; y0 = h * (0.45 + (u / 0.7) * 0.55); }
        else if (u > 2.3) { x0 = w + 20; y0 = h * (0.45 + ((3 - u) / 0.7) * 0.55); }
        else { x0 = ((u - 0.7) / 1.6) * w; y0 = h + 20; }
        const a = Math.atan2(y0 - cy, x0 - cx);
        const ex = cx + Math.cos(a) * R * 1.05;
        const ey = cy + Math.sin(a) * R * 1.05;
        const c1x = x0 + (cx - x0) * 0.15 + seed.wobble * w;
        const c1y = y0 + (cy - y0) * 0.55;
        const c2x = cx + Math.cos(a) * R * 3.2 - seed.wobble * w * 0.6;
        const c2y = cy + Math.sin(a) * R * 2.4;
        const d = `M${x0.toFixed(1)} ${y0.toFixed(1)} C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
        for (const cls of ["base", "trail", seed.alt ? "comet alt" : "comet"]) {
          const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
          p.setAttribute("d", d);
          p.setAttribute("pathLength", "1000");
          p.setAttribute("class", cls);
          p.style.cssText = `--dur:${seed.dur.toFixed(2)}s;--delay:${seed.delay.toFixed(2)}s;--len:${seed.len.toFixed(0)}`;
          svg.appendChild(p);
        }
      }
    };
    draw();
    window.addEventListener("resize", draw);
    void document.fonts?.ready.then(draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  // The 3D character. Three.js loads only in the browser, after first paint.
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      kick.current();
    };
    motion.addEventListener("change", onMotion);
    void import("./scene").then(({ startScene }) => {
      if (cancelled || !canvas.current || !scanner.current || !headline.current) return;
      const started = startScene({
        canvas: canvas.current,
        scanner: scanner.current,
        floor: headline.current,
        modelUrl: `/models/${CHARACTERS[who ?? ""] ?? CHARACTERS.abdul}-rigged.glb`,
        isReduced: () => reduced,
        pokedAt: () => pokedAt.current,
        onLoaded: () => setScene("in"),
        onFailed: () => setScene("none"),
        onCaught: () => flash("is-caught"),
        onNudge: () => flash("is-nudge"),
      });
      stop = started.stop;
      kick.current = started.kick;
    }).catch(() => setScene("none"));
    return () => {
      cancelled = true;
      motion.removeEventListener("change", onMotion);
      stop();
    };
  }, [who]);

  useEffect(() => {
    if (!showEnded) return;
    const timer = window.setTimeout(() => setShowEnded(false), 5000);
    return () => window.clearTimeout(timer);
  }, [showEnded]);

  // A finger on the glass does nothing for NFC, so say so. Holding it starts the demo.
  const hold = useRef(0);
  const unpoke = useRef(0);
  const onPointerDown = () => {
    flash("is-poke");
    pokedAt.current = performance.now() / 1000;
    kick.current();
    setPoked(true);
    window.clearTimeout(unpoke.current);
    unpoke.current = window.setTimeout(() => setPoked(false), 1800);
    window.clearTimeout(hold.current);
    hold.current = window.setTimeout(async () => {
      if (await startKioskDemoSession()) {
        router.push("/kiosk/check");
        return;
      }
      try {
        startPatientDemo();
        router.push("/kiosk/check?demo=1");
      } catch {
        // Storage blocked: the demo can't keep a session, so stay on the welcome screen.
      }
    }, DEMO_HOLD_MS);
  };
  const cancelHold = () => window.clearTimeout(hold.current);
  useEffect(() => () => {
    window.clearTimeout(hold.current);
    window.clearTimeout(unpoke.current);
  }, []);

  let i = 0;
  const words = (s: string) =>
    s.split(/(\s+)/).map((part, n) =>
      part.trim() ? <span key={`${n}-${part}`} className="w" style={{ "--i": i++ } as React.CSSProperties}>{part}</span> : part,
    );
  const [pre, hl, post] = t.head;

  return (
    <div
      ref={root}
      className={`kt${scene === "in" ? " is-model-in" : ""}${scene === "none" ? " is-no3d" : ""}`}
      lang={lang}
      dir={t.dir}
    >
      <div className="kt-backdrop" aria-hidden="true">
        <div className="kt-blob kt-b1" />
        <div className="kt-blob kt-b2" />
        <div className="kt-blob kt-b3" />
        <div className="kt-blob kt-b4" />
        <div className="kt-grid" />
        <svg className="kt-streams" ref={streams} />
        <div className="kt-floaters">
          {floaters.map((f, n) => <span key={n} className={f.kind} style={f.style} />)}
        </div>
        <div className="kt-edge" />
      </div>

      <canvas className="kt-canvas" ref={canvas} aria-hidden="true" />

      <div className="kt-fg" aria-hidden="true">
        <div className="kt-wave kt-w1" />
        <div className="kt-wave kt-w2" />
        <div className="kt-wave kt-w3" />
      </div>

      <main className="kt-main">
        <section className="kt-zone" aria-label="Card reader">
          <div className="kt-scanner" ref={scanner} onAnimationEnd={(e) => {
            if (e.animationName === "kt-burst") e.currentTarget.classList.remove("is-caught", "is-poke");
            if (e.animationName === "kt-nudge") e.currentTarget.classList.remove("is-nudge");
          }}>
            <div className="kt-fx" aria-hidden="true">
              <span className="ring-outer" />
              <span className="halo" />
              <span className="ripple" />
              <span className="orbit" />
              <span className="sweep" />
              <span className="burst" />
            </div>
            <div
              className="kt-core"
              onPointerDown={onPointerDown}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onContextMenu={(e) => e.preventDefault()}
            >
              <svg className="kt-nfc" viewBox="0 0 48 48" aria-hidden="true">
                <path d="M14 19.5a6 6 0 0 1 0 9" />
                <path d="M20 14.5a13 13 0 0 1 0 19" />
                <path d="M26 9.5a20 20 0 0 1 0 29" />
                <path d="M32 5a26.5 26.5 0 0 1 0 38" />
              </svg>
              <span className="kt-label" key={poked ? "use" : "tap"} aria-live="polite">
                {poked ? t.useCard : t.tapHere}
              </span>
            </div>
          </div>
        </section>

        <h1 className="kt-headline" ref={headline} aria-label={t.title}>
          {words(pre)}
          <span className="w hl" style={{ "--i": i++ } as React.CSSProperties}>{hl}</span>
          <span className="w up" style={{ "--i": i++ } as React.CSSProperties} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
          </span>
          {words(post)}
        </h1>
        <p className="kt-ended" role="status">{showEnded ? t.ended : ""}</p>
      </main>
    </div>
  );
}
