"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const IDLE_MS = 90_000;
const WARN_MS = 15_000;

/**
 * Wraps patient-facing kiosk screens: progress bar, "End session" control, and an
 * idle timeout that clears the screen and returns to the welcome prompt (SPEC §4).
 */
export function KioskSession({
  step,
  totalSteps = 4,
  children,
}: {
  step: number;
  totalSteps?: number;
  children: React.ReactNode;
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
        router.replace("/?ended=idle");
      } else if (idle >= IDLE_MS - WARN_MS) {
        setSecondsLeft(Math.ceil((IDLE_MS - idle) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [router]);

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <strong>AbdulCare kiosk</strong>
        <Link href="/?ended=user" className="btn secondary" style={{ minHeight: 44 }}>
          End session
        </Link>
      </div>
      <ol className="steps" aria-label={`Step ${step} of ${totalSteps}`}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <li key={i} className={i < step ? "done" : ""} />
        ))}
      </ol>
      {secondsLeft !== null && (
        <div className="card" role="alert">
          <strong>Still there?</strong> This session ends in {secondsLeft} seconds. Tap anywhere to keep going.
        </div>
      )}
      {children}
    </main>
  );
}
