"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { LIVE, sendKioskCharge, type KioskChargeResult } from "@/lib/api";
import { CHECK_MESSAGE_MS, CHECK_STEP_MS, CHECK_STEPS, discountsFor, money, total, type ChargeMethod } from "../bill";
import { clearPending, demoCharge, loadPending, savePending, type ChargeOutcome, type PendingCharge } from "../pending";
import { Summary } from "../Summary";

// /kiosk/charge/card: where a CareCard tap lands (today the presenter's hold on the reader; later
// the NFC scan). AI walks the bill staff set up: the uninsured self-pay discount, the hospital's
// financial assistance policy, then the prompt-pay discount, with the balance counting down. The
// patient then sends what is left to the community care fund, and the request goes to admin.

const ICONS: Record<(typeof CHECK_STEPS)[number]["id"], IconName> = { selfpay: "shield", policy: "hospital", discounts: "receipt" };
const SETTLE_MS = 1800;

type Phase = "checking" | "result" | "asking" | "done";

const receiptNumber = () => `KC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Counts the shown amount toward `target`, and always lands on it even if frames are paused. */
function useCountTo(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const land = () => {
      setShown(target);
      from.current = target;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return land();
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1100);
      const eased = 1 - Math.pow(1 - p, 3);
      // Count in whole dollars so no cents flicker past, then land on the exact amount.
      const value = p < 1 ? Math.round((begin + (target - begin) * eased) / 100) * 100 : target;
      setShown(value);
      from.current = value;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const fallback = window.setTimeout(land, 1300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [target]);
  return shown;
}

function sentNote(sent: KioskChargeResult | null): string {
  if (!sent) return "Sending to admin…";
  if (sent.sent) return "Sent to a reviewer at admin.";
  switch (sent.reason) {
    case "mock": return "Demo mode: this stays on this phone.";
    case "not_kiosk": return "Not sent to admin: pair this phone as a kiosk with the staff PIN first.";
    case "unavailable": return "Not sent to admin yet: the admin route isn't live. It stays on this phone.";
    default: return "Couldn't reach admin. It stays on this phone.";
  }
}

export function CardCheck({ method }: { method: ChargeMethod }) {
  const router = useRouter();
  const [charge, setCharge] = useState<PendingCharge | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [working, setWorking] = useState(-1); // the step loading now
  const [landed, setLanded] = useState(0); // steps finished
  const [message, setMessage] = useState(0);
  const started = useRef(false);
  const alive = useRef(true);
  const choices = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Walk the bill once, when the page opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = loadPending() ?? demoCharge();
    setCharge(pending);
    // Already settled (a reload, or the reader opened the page again): show it, don't redo it.
    if (pending.outcome) {
      setLanded(CHECK_STEPS.length);
      setPhase("done");
      return;
    }
    void (async () => {
      await sleep(900);
      for (let i = 0; i < CHECK_STEPS.length; i++) {
        if (!alive.current) return;
        setMessage(0);
        setWorking(i);
        await sleep(CHECK_STEP_MS);
        if (!alive.current) return;
        setLanded(i + 1);
      }
      setWorking(-1);
      await sleep(1200);
      if (alive.current) setPhase("result");
    })();
  }, []);

  // Bring the choices into view once the check is done.
  useEffect(() => {
    if (phase !== "result") return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    choices.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, [phase]);

  // Rotate the loading messages of the step in progress.
  useEffect(() => {
    if (working < 0) return;
    const timer = window.setInterval(() => setMessage((m) => m + 1), CHECK_MESSAGE_MS);
    return () => window.clearInterval(timer);
  }, [working]);

  const items = charge?.items ?? [];
  const original = total(items);
  const off = discountsFor(original);
  const takenOff = CHECK_STEPS.slice(0, landed).reduce((s, step) => s + off[step.id], 0);
  const remaining = original - CHECK_STEPS.reduce((s, step) => s + off[step.id], 0);
  const balance = useCountTo(charge ? original - takenOff : 0);
  const discounts = CHECK_STEPS.map((step) => ({ label: step.title, cents: off[step.id] })).filter((d) => d.cents > 0);

  // The only choice: send what is left to the community care fund.
  const askFund = async () => {
    if (!charge) return;
    setPhase("asking");
    const outcome: ChargeOutcome = { kind: "fund_request", no: receiptNumber(), at: new Date().toISOString(), method, discounts, cents: remaining, sent: null };
    const settled = { ...charge, outcome };
    savePending(settled);
    const [sent] = await Promise.all([
      sendKioskCharge({ items: charge.items, discounts, method, preset: charge.preset, outcome: "fund_request" }),
      sleep(SETTLE_MS),
    ]);
    const done = { ...settled, outcome: { ...outcome, sent } };
    savePending(done);
    if (!alive.current) return;
    setCharge(done);
    setPhase("done");
  };

  const newBill = () => {
    clearPending();
    router.push("/kiosk/charge");
  };

  const bar = (
    <div className="station-bar">
      <Logo href={null} />
      <span className="kc-who"><Icon name="user" size={15} /> Patient</span>
    </div>
  );

  if (!charge) return <main className="page station station-session kc">{bar}</main>;

  const outcome = charge.outcome;
  if (phase === "done" && outcome) {
    return (
      <main className="page station station-session kc kc-receipt">
        {bar}
        {!LIVE && <p className="kc-demo"><Icon name="info" size={15} /> Demo · simulated decisions</p>}
        <section aria-labelledby="kc-title">
          <div className="kc-paid kc-asked">
            <Icon name="heart" size={30} />
            <div>
              <h1 id="kc-title">Request sent to the community care fund</h1>
              <p className="muted">
                {new Date(outcome.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {outcome.no}
              </p>
            </div>
          </div>
          <p className="kc-lead">
            A reviewer will look at your request for <b>{money(outcome.cents)}</b>. If it&apos;s approved, the fund pays the
            hospital directly. You don&apos;t need to do anything else.
          </p>
          <p className="kc-track">
            <Icon name="external" size={15} />
            <span>
              Track this claim at{" "}
              <Link href="/user">{typeof window === "undefined" ? "" : window.location.host}/user</Link>
            </span>
          </p>
          <Summary items={charge.items} discounts={outcome.discounts} finalLabel="Requested from the fund" />
          <dl className="kc-meta">
            <div><dt>Request</dt><dd>Reviewed by a person</dd></div>
            <div><dt>Paid to</dt><dd>The hospital, if approved</dd></div>
          </dl>
          <p className={`kc-sent${outcome.sent?.sent ? " is-sent" : ""}`} role="status">
            <Icon name={outcome.sent?.sent ? "check" : "info"} size={15} />
            {sentNote(outcome.sent)}
          </p>
          <button type="button" className="btn btn-lg kc-primary" onClick={newBill}>
            <Icon name="plus" size={18} /> New bill
          </button>
        </section>
      </main>
    );
  }

  const checked = phase !== "checking";
  return (
    <main className="page station station-session kc kc-card">
      {bar}
      {!LIVE && <p className="kc-demo"><Icon name="info" size={15} /> Demo · simulated decisions</p>}
      <section className="bw" aria-labelledby="kc-title">
        <p className={`kc-ai-chip${checked ? " is-done" : ""}`} role="status">
          <span className="kc-ai" aria-hidden="true"><Icon name="sparkles" size={15} /></span>
          {checked ? "AI checked your bill" : "AI is checking your bill"}
        </p>
        <h1 id="kc-title">{checked ? "Your bill, checked" : "Checking your bill"}</h1>
        <p className="muted kc-sub">{checked ? "Here's what's left after every discount." : "CareCard read. AI is finding every discount for you."}</p>

        <div className="bw-balance">
          <span>{checked ? "Left after discounts" : "Balance"}</span>
          <strong>{money(balance)}</strong>
          <div className="bw-meter" role="presentation">
            <i style={{ width: original ? `${Math.min(100, (takenOff / original) * 100)}%` : 0 }} />
          </div>
          <small>{takenOff > 0 ? `${money(takenOff)} taken off${checked ? "" : " so far"}` : `${money(original)} charged`}</small>
        </div>

        <ol className="bw-steps" aria-live="polite">
          <li className="bw-step" data-tone="done">
            <span className="bw-icon"><Icon name="bill" size={18} /></span>
            <span className="bw-text"><strong>Your bill</strong><small>{items.length} itemized charges</small></span>
            <span className="bw-amount">{money(original)}</span>
          </li>
          {CHECK_STEPS.map((step, i) => {
            if (i < landed) {
              return (
                <li key={step.id} className="bw-step" data-tone="saved">
                  <span className="bw-icon"><Icon name={ICONS[step.id]} size={18} /></span>
                  <span className="bw-text"><strong>{step.title}</strong><small>{step.detail}</small></span>
                  <span className="bw-amount">−{money(off[step.id])}<em>simulated</em></span>
                </li>
              );
            }
            if (i === working) {
              return (
                <li key={step.id} className="bw-step" data-tone="work">
                  <span className="bw-icon kc-ai kc-ai-lg" aria-hidden="true"><Icon name="sparkles" size={19} /></span>
                  <span className="bw-text"><strong>{step.title}</strong><small>AI · {step.working[message % step.working.length]}…</small></span>
                  <span className="bw-amount kc-checking">Calculating</span>
                </li>
              );
            }
            return null;
          })}
        </ol>

        {checked && (
          <div className="kc-choices" ref={choices}>
            <div className="bw-panel bw-ask kc-fund">
              <h2>Get help with the last {money(remaining)}</h2>
              <p>The community care fund can pay it directly to the hospital. A person reviews every request; no forms needed.</p>
              <button type="button" className="btn btn-lg kc-primary" disabled={phase === "asking"} onClick={() => void askFund()}>
                {phase === "asking" ? <><span className="kc-spin" /> Sending request…</> : <><Icon name="heart" size={18} /> Send to the community fund</>}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
