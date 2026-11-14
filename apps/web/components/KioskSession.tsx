"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { endSession } from "@/lib/api";
import { Logo, LogoMark } from "./Logo";

const IDLE_MS = 90_000;
const WARN_MS = 15_000;

/**
 * Wraps patient-facing kiosk screens: progress bar, "End session" control, and an
 * idle timeout that clears the screen and returns to the welcome prompt (SPEC §4).
 */
export function KioskSession({
  step,
  totalSteps = 4,
  demo = false,
  children,
  navigation,
  title,
}: {
  step: number;
  totalSteps?: number;
  demo?: boolean;
  children: React.ReactNode;
  navigation?: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const last = useRef(Date.now());

  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
      setSecondsLeft(null);
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= IDLE_MS) {
        clearInterval(t);
        endSession(demo)
          .catch(() => {})
          .finally(() => router.replace("/kiosk?ended=idle"));
      } else if (idle >= IDLE_MS - WARN_MS) {
        setSecondsLeft(Math.ceil((IDLE_MS - idle) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [router, demo]);

  if (navigation) {
    return (
      <div className="desk patient-desk">
        <aside className="d-side">
          <div className="d-logo"><LogoMark /> Patient</div>
          {navigation}
        </aside>
        <main className="d-main">
          <header className="d-head">
            <strong>{title}</strong>
            <EndSessionButton demo={demo} className="d-btn patient-end-session" />
          </header>
          <div className="patient-mobile-nav">{navigation}</div>
          <div className="d-body">
            {secondsLeft !== null && (
              <p className="patient-panel" role="alert">Session ends in {secondsLeft} seconds. Tap anywhere to stay signed in.</p>
            )}
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <main className="page station station-session">
      <div className="station-bar">
        <Logo href={null} />
        <EndSessionButton demo={demo} style={{ minHeight: 44 }} />
      </div>
      {totalSteps > 0 && (
      <ol className="steps" aria-label={`Step ${step} of ${totalSteps}`}>
        {["Bills", "Request help", "Status"].slice(0, totalSteps).map((label, i) => (
          <li key={label} className={i < step ? "done" : ""} aria-current={i + 1 === step ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      )}
      {secondsLeft !== null && (
        <div className="card" role="alert">
          <strong>Still there?</strong> This session ends in {secondsLeft} seconds. Tap anywhere to keep going.
        </div>
      )}
      {children}
    </main>
  );
}

/** Ends the patient session on the server (clears the cookie), then returns to the welcome screen. */
export function EndSessionButton({
  label = "End session",
  className = "btn secondary",
  style,
  demo = false,
}: {
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  demo?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        endSession(demo)
          .catch(() => {})
          .finally(() => router.replace("/kiosk?ended=user"));
      }}
    >
      {label}
    </button>
  );
}
