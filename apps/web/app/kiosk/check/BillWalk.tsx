"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { LoadError, NoSession } from "@/components/NoSession";
import { ReadAloud } from "@/components/ReadAloud";
import { applyForSavings, getPatientWorkspace, isNoSession, LIVE } from "@/lib/api";
import { cleanName, shortDate, usd } from "@/lib/format";
import type { Bill, PatientBillResponse, PolicyApplication } from "@/lib/rev6";
import { RequestHelpForm } from "../bill/RequestHelpForm";

// After a kiosk tap: load the patient's latest bill and walk it through every source of
// help in the SPEC §1 order (charged, insurance, each hospital policy, the fund), with the
// balance counting down at each step.

type VisitData = PatientBillResponse & { bill: Bill };
type Tone = "done" | "saved" | "skip" | "wait" | "work";
type Step = {
  id: string;
  icon: IconName;
  title: string;
  detail: string;
  /** Amount taken off at this step, if any. */
  cents: number;
  /** Balance after this step. */
  balance: number;
  tone: Tone;
  simulated: boolean;
};

const IN_FLIGHT = ["pending_review", "approved", "payment_pending"];
const STEP_MS = 1100;

function pickVisit(visits: VisitData[], visitId?: string): VisitData | null {
  const asked = visitId ? visits.find((v) => v.bill.visit.id === visitId) : undefined;
  if (asked) return asked;
  const sorted = [...visits].sort((a, b) => b.bill.visit.createdAt.localeCompare(a.bill.visit.createdAt));
  return sorted.find((v) => v.bill.remainingCents > 0) ?? sorted[0] ?? null;
}

/** The visit to walk: the one the kiosk asked for, else the newest with a balance left. */
async function loadVisit(demo: boolean, visitId?: string) {
  const { visits } = await getPatientWorkspace(demo);
  return pickVisit(visits.filter((v): v is VisitData => v.bill !== null), visitId);
}

/** Policies the patient qualifies for that haven't been submitted yet. */
function applicable(bill: Bill) {
  return bill.applications.filter((a) => a.status === "prepared" && a.evaluation.eligible && a.evaluation.reductionCents > 0);
}

function policyStep(a: PolicyApplication, balance: number): Step {
  const base = { id: a.id, icon: "shield" as IconName, simulated: true };
  if (a.status === "approved_simulated" && a.reductionCents > 0) {
    return { ...base, title: a.policy.name, detail: "Approved by the hospital (simulated).", cents: a.reductionCents, balance: balance - a.reductionCents, tone: "saved" };
  }
  if (a.status === "submitted_simulated") {
    return { ...base, title: a.policy.name, detail: "Waiting for the hospital's decision (simulated).", cents: 0, balance, tone: "wait" };
  }
  if (a.status === "prepared" && a.evaluation.eligible) {
    return { ...base, title: a.policy.name, detail: `You qualify. Application prepared for ${usd(a.evaluation.reductionCents)}.`, cents: 0, balance, tone: "wait" };
  }
  return { ...base, title: a.policy.name, detail: a.evaluation.reason || "This policy doesn't apply to this visit.", cents: 0, balance, tone: "skip" };
}

function buildSteps({ bill, grant }: VisitData): Step[] {
  const steps: Step[] = [];
  let balance = bill.chargesCents;
  steps.push({
    id: "charge",
    icon: "hospital",
    title: "Your visit",
    detail: `${cleanName(bill.visit.hospital.name)} · ${bill.visit.description} · ${shortDate(bill.visit.date)}`,
    cents: 0,
    balance,
    tone: "done",
    simulated: false,
  });
  if (bill.insurance && bill.plan) {
    balance -= bill.insurerPaidCents;
    steps.push({
      id: "insurance",
      icon: "shield",
      title: `Insurance · ${cleanName(bill.plan.payerName)}`,
      detail: `Your plan paid its share. Your part is the deductible plus ${bill.plan.coinsurancePct}% coinsurance (simulated).`,
      cents: bill.insurerPaidCents,
      balance,
      tone: bill.insurerPaidCents > 0 ? "saved" : "skip",
      simulated: true,
    });
  } else {
    steps.push({ id: "insurance", icon: "shield", title: "Insurance", detail: "No insurance on file, so we check the hospital's self-pay help next.", cents: 0, balance, tone: "skip", simulated: false });
  }
  for (const application of bill.applications) {
    const step = policyStep(application, balance);
    balance = step.balance;
    steps.push(step);
  }
  if (bill.patientPaidCents > 0) {
    balance -= bill.patientPaidCents;
    steps.push({ id: "paid", icon: "wallet", title: "You paid", detail: "Payments you already made toward this visit.", cents: bill.patientPaidCents, balance, tone: "saved", simulated: false });
  }
  if (grant && grant.status === "paid") {
    balance -= bill.fundPaidCents;
    steps.push({ id: "fund", icon: "heart", title: "Community care fund", detail: "Paid directly to the hospital.", cents: bill.fundPaidCents, balance, tone: "saved", simulated: false });
  } else if (grant && IN_FLIGHT.includes(grant.status)) {
    steps.push({ id: "fund", icon: "heart", title: "Community care fund", detail: grant.status === "pending_review" ? "Your request is with a reviewer." : "Approved. Payment to the hospital is pending.", cents: 0, balance, tone: "wait", simulated: false });
  }
  // The server's remaining balance is the source of truth for the last number.
  steps[steps.length - 1].balance = bill.remainingCents;
  return steps;
}

/** Counts the shown balance toward `target`. */
function useCountTo(target: number, reduced: boolean) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    // Background tabs don't run animation frames, so jump straight to the number there.
    if (reduced || document.hidden) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      // Count in whole dollars so no cents flicker past, then land on the exact amount.
      const value = p < 1 ? Math.round((begin + (target - begin) * eased) / 100) * 100 : target;
      setShown(value);
      from.current = value;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return shown;
}

type State =
  | { phase: "loading" | "no_session" | "error" | "empty" }
  | { phase: "ready"; data: VisitData };

export function BillWalk({ demo, visitId }: { demo: boolean; visitId?: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [shown, setShown] = useState(0);
  const [applying, setApplying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reduced, setReduced] = useState(false);
  const run = useRef(0);

  const walk = useCallback(async () => {
    const id = ++run.current;
    const alive = () => id === run.current;
    const fast = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(fast);
    const pause = (ms: number) => new Promise((r) => window.setTimeout(r, fast ? 0 : ms));
    setState({ phase: "loading" });
    setShown(0);
    setFinished(false);
    try {
      let data = await loadVisit(demo, visitId);
      if (!alive()) return;
      if (!data) return setState({ phase: "empty" });
      setState({ phase: "ready", data });
      await pause(500);
      setShown(1); // the visit
      await pause(STEP_MS);
      if (!alive()) return;
      setShown(2); // insurance
      await pause(STEP_MS);
      // Apply for every hospital policy the patient qualifies for; the decisions are simulated.
      if (!data.grant && applicable(data.bill).length > 0) {
        setApplying(true);
        await applyForSavings(data.bill.visit.id, demo);
        const next = await loadVisit(demo, visitId);
        if (!alive()) return;
        if (next) data = next;
        setState({ phase: "ready", data });
        setApplying(false);
      }
      const total = buildSteps(data).length;
      for (let n = 3; n <= total; n++) {
        if (!alive()) return;
        setShown(n);
        await pause(STEP_MS);
      }
      if (alive()) setFinished(true);
    } catch (error) {
      if (!alive()) return;
      setApplying(false);
      setState({ phase: isNoSession(error) ? "no_session" : "error" });
    }
  }, [demo, visitId]);

  useEffect(() => {
    void walk();
    return () => { run.current++; };
  }, [walk]);

  const refresh = useCallback(async () => {
    try {
      const data = await loadVisit(demo, visitId);
      if (data) setState({ phase: "ready", data });
    } catch (error) {
      if (isNoSession(error)) setState({ phase: "no_session" });
    }
  }, [demo, visitId]);

  const steps = state.phase === "ready" ? buildSteps(state.data) : [];
  // Once the walk is done, steps added later (a fund request) show at once.
  const visible = finished ? steps : steps.slice(0, shown);
  const current = visible[visible.length - 1];
  const target = current ? current.balance : 0;
  const balance = useCountTo(target, reduced);

  if (state.phase === "no_session") return <NoSession />;
  if (state.phase === "error") return <LoadError message="We couldn't load your bill." onRetry={() => void walk()} />;
  if (state.phase === "empty") {
    return (
      <section className="bw">
        <h1 className="bw-title">No bills yet</h1>
        <p className="bw-sub">Visits appear here after hospital staff log them with your CareCard.</p>
      </section>
    );
  }

  const data = state.phase === "ready" ? state.data : null;
  const bill = data?.bill;
  const charges = bill?.chargesCents ?? 0;
  const saved = Math.max(0, charges - balance);
  const href = (path: string) => (demo ? `${path}${path.includes("?") ? "&" : "?"}demo=1` : path);

  return (
    <section className="bw" aria-labelledby="bw-title">
      {(demo || !LIVE) && <p className="bw-demo"><Icon name="info" size={15} /> Demo · fictional data and simulated decisions</p>}
      <h1 id="bw-title" className="bw-title">{finished ? "Your bill, checked" : "Checking your bill"}</h1>
      <p className="bw-sub">
        {bill ? `${cleanName(bill.visit.hospital.name)} · ${shortDate(bill.visit.date)}` : "Reading your card…"}
      </p>

      <div className="bw-balance" aria-hidden={!finished}>
        <span>{finished ? "Left to pay" : "Balance"}</span>
        <strong>{usd(current ? balance : charges)}</strong>
        <div className="bw-meter" role="presentation">
          <i style={{ width: charges ? `${Math.min(100, (saved / charges) * 100)}%` : 0 }} />
        </div>
        <small>{saved > 0 ? `${usd(saved)} taken off so far` : bill ? `${usd(charges)} charged` : " "}</small>
      </div>

      <ol className="bw-steps" aria-live="polite">
        {visible.map((step) => (
          <li key={step.id} className="bw-step" data-tone={step.tone}>
            <span className="bw-icon"><Icon name={step.tone === "skip" ? "x" : step.tone === "wait" ? "clock" : step.icon} size={18} /></span>
            <span className="bw-text">
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </span>
            <span className="bw-amount">
              {step.id === "charge" ? usd(charges) : step.cents > 0 ? `−${usd(step.cents)}` : step.tone === "skip" ? "No change" : "Pending"}
              {step.simulated && step.cents > 0 && <em>simulated</em>}
            </span>
          </li>
        ))}
        {state.phase === "loading" && <li className="bw-step" data-tone="work"><span className="bw-icon bw-spin" /> <span className="bw-text"><strong>Reading your card</strong></span></li>}
        {applying && (
          <li className="bw-step" data-tone="work">
            <span className="bw-icon bw-spin" />
            <span className="bw-text"><strong>Checking hospital assistance</strong><small>Applying for every policy you qualify for (simulated).</small></span>
          </li>
        )}
      </ol>

      {finished && data && bill && (
        <div className="bw-result">
          {bill.remainingCents === 0 ? (
            <div className="bw-panel bw-done">
              <Icon name="checkCircle" size={26} />
              <div><h2>Nothing left to pay</h2><p>Every dollar of this visit is covered.</p></div>
            </div>
          ) : data.grant && IN_FLIGHT.includes(data.grant.status) ? (
            <div className="bw-panel">
              <Icon name="heart" size={24} />
              <div>
                <h2>Request sent to the community care fund</h2>
                <p>{data.grant.status === "pending_review" ? `A reviewer will look at your request for ${usd(data.grant.requestedCents)}. You don't need to do anything else.` : "Approved. The fund is paying the hospital directly."}</p>
              </div>
            </div>
          ) : data.grant?.status === "rejected" ? (
            <div className="bw-panel">
              <Icon name="info" size={24} />
              <div><h2>The fund couldn&apos;t cover this</h2><p>Ask the hospital&apos;s billing office about a payment plan.</p></div>
            </div>
          ) : (
            <div className="bw-panel bw-ask">
              <h2>Get help with the last {usd(bill.remainingCents)}</h2>
              <p>The community care fund can pay it directly to the hospital. A person reviews every request; no forms needed.</p>
              <RequestHelpForm demo={demo} visitId={bill.visit.id} remainingCents={bill.remainingCents} onSent={() => void refresh()} />
            </div>
          )}
          {data.explanation && (
            <div className="bw-explain">
              <p>{data.explanation.summary}</p>
              <ReadAloud text={[data.explanation.summary, ...data.explanation.points].join(" ")} className="btn secondary" />
            </div>
          )}
          <Link className="bw-link" href={href(`/kiosk/bill?visit=${encodeURIComponent(bill.visit.id)}`)}>
            See the full bill and charges <Icon name="chevronRight" size={16} />
          </Link>
        </div>
      )}
    </section>
  );
}
