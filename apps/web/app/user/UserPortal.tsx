"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Bill, Grant, GrantStatus, PortalOverviewResponse, PortalPaymentReceipt } from "@abdulcare/contracts";
import { GoldCareCard } from "@/components/desk/GoldCareCard";
import { Icon } from "@/components/Icon";
import { LogoWordmark } from "@/components/Logo";
import { SiteHeader, SiteNav } from "@/components/SiteNav";
import { STATUS_LABEL } from "@/components/StatusBadge";
import { cleanName, firstName, shortDate, stepLabel, usd } from "@/lib/format";
import { PortalError, getOverview, payBalance, signIn, signOut } from "./portal-api";
import { PlanOffer, QueueProofs } from "./LinkedRails";

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PortalOverviewResponse };

/** Claims still moving: refresh while one is open so an approval shows up without a reload. */
const OPEN: GrantStatus[] = ["pending_review", "approved", "payment_pending"];
const REFRESH_MS = 10_000;

export function UserPortal({ cardToken }: { cardToken: string | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      setState({ kind: "ready", data: await getOverview() });
    } catch (err) {
      if (err instanceof PortalError && err.status === 401) setState({ kind: "signed_out" });
      else setState({ kind: "error", message: err instanceof Error ? err.message : "Couldn't load your account." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = state.kind === "ready" && state.data.claims.some((g) => OPEN.includes(g.status));
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") getOverview().then((data) => setState({ kind: "ready", data }), () => {});
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [open]);

  if (state.kind === "loading") {
    return (
      <>
        <SiteHeader current="account" />
        <main className="u-portal u-center" aria-busy="true">
          <p className="u-muted">Loading your account…</p>
        </main>
      </>
    );
  }
  if (state.kind === "signed_out") {
    return (
      <>
      <SiteHeader current="account" />
      <SignIn
        cardToken={cardToken}
        onSignedIn={() => {
          // The card token must not stay in the address bar or history.
          if (cardToken) window.history.replaceState(null, "", "/user");
          setState({ kind: "loading" });
          void load();
        }}
      />
      </>
    );
  }
  if (state.kind === "error") {
    return (
      <>
      <SiteHeader current="account" />
      <main className="u-portal u-center">
        <div className="d-card u-error">
          <p>{state.message}</p>
          <button className="d-btn d-btn-teal" onClick={() => void load()}>
            <Icon name="refresh" /> Try again
          </button>
        </div>
      </main>
      </>
    );
  }
  return (
    <Dashboard
      data={state.data}
      onRefresh={(data) => setState({ kind: "ready", data })}
      onSignOut={async () => {
        await signOut().catch(() => {});
        setState({ kind: "signed_out" });
      }}
    />
  );
}

// ---------------------------------------------------------------------------- Sign in

function SignIn({ cardToken, onSignedIn }: { cardToken: string | null; onSignedIn: () => void }) {
  const [accountCode, setAccountCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useCard, setUseCard] = useState(Boolean(cardToken));
  const ready = birthDate && (useCard || accountCode.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(useCard && cardToken ? { cardToken, birthDate } : { accountCode: accountCode.trim(), birthDate });
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="d-login u-login">
      <form className="d-login-card" onSubmit={submit}>
        <div className="d-login-brand">
          <LogoWordmark />
        </div>
        <div className="u-login-card" aria-hidden="true">
          <GoldCareCard name="Your name" memberId="XXXX-XXX-XXXX" dob="XX-XX-XXXX" />
        </div>
        <h1>{useCard ? "CareCard found" : "Sign in to your account"}</h1>
        <p>
          {useCard
            ? "Enter your birth date to open your account."
            : "Your account ID is printed on the front of your CareCard."}
        </p>
        {!useCard && (
          <label className="d-login-field">
            <span>Account ID</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              placeholder="otc7-jd4-rx19"
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </label>
        )}
        <label className="d-login-field">
          <span>Birth date</span>
          <input
            type="date"
            autoComplete="bday"
            max={new Date().toISOString().slice(0, 10)}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "u-login-error" : undefined}
          />
        </label>
        {error && (
          <p className="d-login-error" id="u-login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="d-btn d-btn-teal u-wide" disabled={!ready || busy}>
          <Icon name="key" /> {busy ? "Checking…" : "Open my account"}
        </button>
        {cardToken && (
          <button type="button" className="u-link" onClick={() => setUseCard((v) => !v)}>
            {useCard ? "Use my account ID instead" : "Use the CareCard I tapped"}
          </button>
        )}
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------- Dashboard

const PILL: Record<GrantStatus, string> = {
  draft: "",
  pending_review: "amber",
  approved: "teal",
  payment_pending: "blue",
  paid: "green",
  rejected: "red",
  canceled: "",
};

/**
 * How a decided claim turned out. Partial: the fund covered less than was asked (the rest was
 * denied). The patient owes whatever is still left on the bill.
 */
interface Outcome {
  kind: "full" | "partial" | "denied" | "open";
  requestedCents: number;
  coveredCents: number;
  deniedCents: number;
}

function outcomeOf(g: Grant): Outcome {
  const requestedCents = g.requestedCents;
  if (g.status === "rejected") return { kind: "denied", requestedCents, coveredCents: 0, deniedCents: requestedCents };
  if (g.status === "approved" || g.status === "payment_pending" || g.status === "paid") {
    const coveredCents = g.approvedCents ?? 0;
    const deniedCents = Math.max(0, requestedCents - coveredCents);
    return { kind: deniedCents > 0 ? "partial" : "full", requestedCents, coveredCents, deniedCents };
  }
  return { kind: "open", requestedCents, coveredCents: 0, deniedCents: 0 };
}

/** What the patient still pays on a bill: the balance less anything the fund is already sending. */
const outOfPocket = (b: Bill) => Math.max(0, b.remainingCents - b.pendingCents);

/** The newest claim on each visit. */
function latestClaimByVisit(claims: Grant[]): Map<string, Grant> {
  const map = new Map<string, Grant>();
  for (const g of claims) if (g.visit && !map.has(g.visit.id)) map.set(g.visit.id, g); // newest first
  return map;
}

function Dashboard({
  data,
  onRefresh,
  onSignOut,
}: {
  data: PortalOverviewResponse;
  onRefresh: (data: PortalOverviewResponse) => void;
  onSignOut: () => void;
}) {
  const { patient, profile, plan, bills, claims } = data;
  const byVisit = latestClaimByVisit(claims);
  const billFor = (g: Grant) => (g.visit ? bills.find((b) => b.visit.id === g.visit?.id) : undefined);
  // Prompt to pay the rest once the fund has decided and covered only part of a bill, or none of it.
  const toPay = bills.flatMap((b) => {
    const g = byVisit.get(b.visit.id);
    if (!g || OPEN.includes(g.status) || outOfPocket(b) <= 0) return [];
    const o = outcomeOf(g);
    return o.kind === "partial" || o.kind === "denied" ? [{ bill: b, grant: g, outcome: o }] : [];
  });
  const refresh = () => getOverview().then(onRefresh, () => {});
  // The pay sheet lives here, not on the bill, so the receipt stays up after the bill is paid off.
  const [sheet, setSheet] = useState<{ visitId: string; receipt: PortalPaymentReceipt | null } | null>(null);
  const receiptFor = (visitId: string) => data.receipts?.find((r) => r.visitId === visitId) ?? null;
  const sheetBill = sheet ? bills.find((b) => b.visit.id === sheet.visitId) : undefined;
  const name = cleanName(patient.displayName);
  const owed = bills.reduce((s, b) => s + b.remainingCents, 0);
  const charged = bills.reduce((s, b) => s + b.chargesCents, 0);
  const reduced = bills.reduce((s, b) => s + b.insurerPaidCents + b.hospitalAssistanceCents, 0);
  const fundPaid = bills.reduce((s, b) => s + b.fundPaidCents, 0);
  const openClaims = claims.filter((g) => OPEN.includes(g.status)).length;

  return (
    <div className="u-portal">
      <header className="u-bar">
        <Link href="/" className="site-brand" aria-label="OpenCare home">
          <LogoWordmark />
        </Link>
        <SiteNav current="account" />
        <button className="d-btn u-signout" onClick={onSignOut}>
          <Icon name="logout" /> Sign out
        </button>
      </header>

      <main className="u-main">
        <section className="u-hello">
          <div>
            <p className="d-kicker">Welcome back</p>
            <h1>{firstName(name)}</h1>
            <p className="u-muted">Your bills, your claims to the community fund, and what's left to pay.</p>
          </div>
          <div className="u-card-wrap">
            <GoldCareCard
              name={name}
              memberId={patient.accountCode?.toUpperCase() ?? "No account ID"}
              dob={patient.birthYear ? `XX-XX-${patient.birthYear}` : "Not on file"}
            />
          </div>
        </section>

        <section className="u-tiles" aria-label="Summary">
          <Tile icon="bill" label="You still owe" value={usd(owed)} strong />
          <Tile icon="receipt" label="Billed" value={usd(charged)} />
          <Tile icon="shield" label="Discounts" value={usd(reduced)} />
          <Tile icon="heart" label="Fund paid" value={usd(fundPaid)} />
        </section>

        {toPay.length > 0 && (
          <section className="d-card u-section u-due" aria-labelledby="u-due">
            <div className="d-card-head">
              <h2 id="u-due">Left to pay</h2>
            </div>
            <ul className="u-list">
              {toPay.map(({ bill, outcome }) => (
                <li key={bill.visit.id} className="u-due-item">
                  <p className="u-due-title">
                    {outcome.kind === "denied" ? (
                      <>You&apos;ve been denied for {usd(outcome.deniedCents)}.</>
                    ) : (
                      <>
                        You&apos;ve been partially accepted for {usd(outcome.coveredCents)} of {usd(outcome.requestedCents)}.
                      </>
                    )}
                  </p>
                  <p className="u-muted">
                    {bill.visit.description} at {bill.visit.hospital.name}.{" "}
                    {outcome.kind === "partial" && <>The fund denied the other {usd(outcome.deniedCents)}. </>}
                    You have <strong>{usd(outOfPocket(bill))}</strong> still to pay out of pocket.
                  </p>
                  <PayButton amountCents={outOfPocket(bill)} onPay={() => setSheet({ visitId: bill.visit.id, receipt: null })} />
                  <PlanOffer visitId={bill.visit.id} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <QueueProofs />

        <section className="d-card u-section" aria-labelledby="u-claims">
          <div className="d-card-head">
            <h2 id="u-claims">Claims</h2>
            {openClaims > 0 && <span className="d-pill amber dot">{openClaims} open</span>}
          </div>
          {claims.length === 0 ? (
            <p className="u-empty">No claims yet. When you ask the community fund for help at a kiosk, it shows up here.</p>
          ) : (
            <ul className="u-list">
              {claims.map((g) => (
                <ClaimRow key={g.id} grant={g} bill={billFor(g)} />
              ))}
            </ul>
          )}
        </section>

        <section className="d-card u-section" aria-labelledby="u-bills">
          <div className="d-card-head">
            <h2 id="u-bills">Bills</h2>
          </div>
          {bills.length === 0 ? (
            <p className="u-empty">No bills yet. Bills appear here once a hospital logs a visit to your CareCard.</p>
          ) : (
            <ul className="u-list">
              {bills.map((b) => {
                const g = byVisit.get(b.visit.id);
                return (
                  <BillRow
                    key={b.visit.id}
                    bill={b}
                    canPay={!g || !OPEN.includes(g.status)}
                    receipt={receiptFor(b.visit.id)}
                    onPay={() => setSheet({ visitId: b.visit.id, receipt: null })}
                    onViewReceipt={(r) => setSheet({ visitId: b.visit.id, receipt: r })}
                  />
                );
              })}
            </ul>
          )}
        </section>

        <section className="d-card u-section" aria-labelledby="u-profile">
          <div className="d-card-head">
            <h2 id="u-profile">Profile</h2>
          </div>
          <dl className="u-facts">
            <div>
              <dt>Account ID</dt>
              <dd className="u-mono">{patient.accountCode ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Household</dt>
              <dd>{profile.householdSize == null ? "Not on file" : `${profile.householdSize} ${profile.householdSize === 1 ? "person" : "people"}`}</dd>
            </div>
            <div>
              <dt>Monthly income</dt>
              <dd>{profile.monthlyIncomeCents == null ? "Not on file" : usd(profile.monthlyIncomeCents)}</dd>
            </div>
            <div>
              <dt>Insurance</dt>
              <dd>{plan ? plan.payerName : profile.insurance ? capitalize(profile.insurance) : "Not on file"}</dd>
            </div>
          </dl>
          <p className="u-note">
            <Icon name="lock" size={14} /> Only you and the fund's caseworkers see this. The public ledger never shows your name.
          </p>
        </section>
      </main>
      {sheet && sheetBill && (
        <PaySheet
          bill={sheetBill}
          payFrom={data.payFrom ?? null}
          initialReceipt={sheet.receipt}
          liveReceipt={receiptFor(sheet.visitId)}
          onPaid={refresh}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function Tile({ icon, label, value, strong = false }: { icon: string; label: string; value: string; strong?: boolean }) {
  return (
    <div className={`u-tile${strong ? " strong" : ""}`}>
      <span className="u-tile-icon">
        <Icon name={icon as never} size={18} />
      </span>
      <span className="u-tile-label">{label}</span>
      <strong className="u-tile-num">{value}</strong>
    </div>
  );
}

function ClaimRow({ grant: g, bill }: { grant: Grant; bill?: Bill }) {
  const paid = g.status === "paid" ? (g.approvedCents ?? 0) : 0;
  const o = outcomeOf(g);
  const left = bill ? outOfPocket(bill) : null;
  const label = o.kind === "partial" ? "Partly approved" : STATUS_LABEL[g.status];
  return (
    <li className="u-row">
      <div className="u-row-main">
        <strong>{g.visit?.description ?? "Medical bill"}</strong>
        <span className="u-muted">
          {g.provider.name} · asked {shortDate(g.createdAt)}
        </span>
      </div>
      <div className="u-row-side">
        <strong>{usd(g.approvedCents ?? g.requestedCents)}</strong>
        <span className={`d-pill dot ${o.kind === "partial" ? "amber" : PILL[g.status]}`}>{label}</span>
      </div>
      {(o.kind === "partial" || o.kind === "denied") && (
        <p className={`u-outcome ${o.kind}`}>
          {o.kind === "denied"
            ? `You've been denied for ${usd(o.deniedCents)}.`
            : `You've been partially accepted for ${usd(o.coveredCents)} of ${usd(o.requestedCents)}, and denied for ${usd(o.deniedCents)}.`}{" "}
          {left == null
            ? null
            : left > 0
              ? `You have ${usd(left)} still to pay out of pocket.`
              : bill && bill.patientPaidCents > 0
                ? `You paid the remaining ${usd(bill.patientPaidCents)}. Nothing is left to pay.`
                : "Nothing is left to pay on this bill."}
        </p>
      )}
      {(paid > 0 || g.receipt?.explorerUrl) && (
        <div className="u-row-foot">
          {paid > 0 && <span>Paid to {g.provider.name}{g.paidAt ? ` on ${shortDate(g.paidAt)}` : ""}</span>}
          {g.receipt?.explorerUrl && (
            <a href={g.receipt.explorerUrl} target="_blank" rel="noreferrer">
              Solana receipt <Icon name="external" size={13} />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function BillRow({
  bill: b,
  canPay,
  receipt,
  onPay,
  onViewReceipt,
}: {
  bill: Bill;
  canPay: boolean;
  receipt: PortalPaymentReceipt | null;
  onPay: () => void;
  onViewReceipt: (r: PortalPaymentReceipt) => void;
}) {
  return (
    <li className="u-row">
      <details className="u-bill">
        <summary>
          <div className="u-row-main">
            <strong>{b.visit.description}</strong>
            <span className="u-muted">
              {b.visit.hospital.name} · {shortDate(b.visit.date)}
            </span>
          </div>
          <div className="u-row-side">
            <strong>{usd(b.remainingCents)}</strong>
            <span className="u-muted">left of {usd(b.chargesCents)}</span>
          </div>
        </summary>
        <ol className="u-steps" aria-label="How the bill came down">
          {b.steps.map((s, i) => (
            <li key={i}>
              <span>{stepLabel(s.label)}</span>
              <span className="u-num">{i === 0 ? usd(s.balanceCents) : `−${usd(s.reductionCents)}`}</span>
            </li>
          ))}
          <li className="u-steps-total">
            <span>Left to pay</span>
            <span className="u-num">{usd(b.remainingCents)}</span>
          </li>
        </ol>
        {b.pendingCents > 0 && <p className="u-note">{usd(b.pendingCents)} is on its way from the community fund.</p>}
        {b.patientPaidCents > 0 && (
          <div className="u-row-foot u-paid-foot">
            <span>
              <Icon name="check" size={14} /> You paid {usd(b.patientPaidCents)}
              {receipt ? ` on ${shortDate(receipt.paidAt)}` : ""}
            </span>
            {receipt?.explorerUrl && (
              <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                Solana receipt <Icon name="external" size={13} />
              </a>
            )}
            {receipt && (
              <button type="button" className="u-link-btn" onClick={() => onViewReceipt(receipt)}>
                <Icon name="receipt" size={13} /> View receipt
              </button>
            )}
          </div>
        )}
        {canPay && outOfPocket(b) > 0 && <PayButton amountCents={outOfPocket(b)} onPay={onPay} />}
        {b.visit.lineItems.length > 0 && (
          <>
            <p className="u-sub">Itemized charges</p>
            <ul className="u-items">
              {b.visit.lineItems.map((li, i) => (
                <li key={i}>
                  <span>{li.description}</span>
                  <span className="u-num">{usd(li.cents)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </li>
  );
}

/** Opens the pay sheet for what's left on a bill. */
function PayButton({ amountCents, onPay }: { amountCents: number; onPay: () => void }) {
  return (
    <div className="u-pay">
      <button className="d-btn d-btn-teal u-wide" onClick={onPay}>
        <Icon name="bill" /> Pay the rest: {usd(amountCents)}
      </button>
    </div>
  );
}

const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id);
const paidTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Confirm, pay, then a receipt: the amount, where it goes, where it comes from, the bank transaction
 * and the public Solana record. Opened from a bill; stays up after the bill is paid off.
 */
function PaySheet({
  bill,
  payFrom,
  initialReceipt,
  liveReceipt,
  onPaid,
  onClose,
}: {
  bill: Bill;
  payFrom: string | null;
  initialReceipt: PortalPaymentReceipt | null;
  liveReceipt: PortalPaymentReceipt | null;
  onPaid: () => Promise<unknown>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"confirm" | "paying" | "done">(initialReceipt ? "done" : "confirm");
  const [paid, setPaid] = useState<PortalPaymentReceipt | null>(initialReceipt);
  const [error, setError] = useState<string | null>(null);
  const [amountCents] = useState(() => outOfPocket(bill));
  // The newest copy wins: the account refresh fills in the Solana signature once devnet confirms.
  const receipt = liveReceipt?.solanaSignature ? liveReceipt : (paid ?? liveReceipt);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Devnet can take a few seconds longer than the payment: check back until the receipt lands.
  const pendingChain = step === "done" && !receipt?.solanaSignature;
  const refresh = useRef(onPaid);
  refresh.current = onPaid;
  useEffect(() => {
    if (!pendingChain) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      void refresh.current();
      if (tries >= 10) clearInterval(t);
    }, 4000);
    return () => clearInterval(t);
  }, [pendingChain]);

  async function pay() {
    setStep("paying");
    setError(null);
    try {
      const res = await payBalance(bill.visit.id, amountCents);
      setPaid(res.receipt ?? null);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment didn't go through. Try again.");
      setStep("confirm");
    } finally {
      void onPaid(); // show the current balance either way
    }
  }

  const close = () => {
    if (step === "paying") return;
    ref.current?.close();
  };

  return createPortal(
    <dialog
      ref={ref}
      className="u-sheet"
      aria-labelledby="u-sheet-title"
      onClose={onClose}
      onCancel={(e) => {
        if (step === "paying") e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {step !== "done" ? (
        <div className="u-sheet-body">
          <p className="d-kicker">Pay the rest of this bill</p>
          <h2 id="u-sheet-title" className="u-sheet-amount">
            {usd(amountCents)}
          </h2>
          <dl className="u-sheet-facts">
            <div>
              <dt>To</dt>
              <dd>{bill.visit.hospital.name}</dd>
            </div>
            <div>
              <dt>For</dt>
              <dd>
                {bill.visit.description}, {shortDate(bill.visit.date)}
              </dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{payFrom ?? "Your account"}</dd>
            </div>
            <div>
              <dt>Balance after</dt>
              <dd>{usd(Math.max(0, bill.remainingCents - amountCents))}</dd>
            </div>
          </dl>
          <p className="u-sheet-note">
            <Icon name="shield" size={14} /> Payments can&apos;t be undone. You&apos;ll get a receipt, and the payment is
            recorded on Solana without your name.
          </p>
          {error && (
            <p className="d-login-error" role="alert">
              {error}
            </p>
          )}
          <div className="u-sheet-actions">
            <button type="button" className="d-btn" onClick={close} disabled={step === "paying"}>
              Cancel
            </button>
            <button type="button" className="d-btn d-btn-teal" onClick={() => void pay()} disabled={step === "paying"} autoFocus>
              {step === "paying" ? "Paying…" : `Pay ${usd(amountCents)}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="u-sheet-body u-receipt">
          <span className="u-receipt-check" aria-hidden="true">
            <Icon name="check" size={26} />
          </span>
          <p className="d-kicker">Payment sent</p>
          <h2 id="u-sheet-title" className="u-sheet-amount">
            {usd(receipt?.amountCents ?? amountCents)}
          </h2>
          <p className="u-muted u-receipt-to">to {receipt?.hospital ?? bill.visit.hospital.name}. This bill is settled.</p>
          <dl className="u-sheet-facts">
            <div>
              <dt>Date</dt>
              <dd>{receipt ? paidTime(receipt.paidAt) : "Just now"}</dd>
            </div>
            <div>
              <dt>For</dt>
              <dd>{bill.visit.description}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{receipt?.fromAccount ?? payFrom ?? "Your account"}</dd>
            </div>
            {receipt?.bankTransactionId && (
              <div>
                <dt>Bank transaction</dt>
                <dd className="u-mono" title={receipt.bankTransactionId}>
                  {shortId(receipt.bankTransactionId)}
                </dd>
              </div>
            )}
            <div>
              <dt>Solana receipt</dt>
              <dd>
                {receipt?.explorerUrl && receipt.solanaSignature ? (
                  <a href={receipt.explorerUrl} target="_blank" rel="noreferrer" className="u-chain-link">
                    <span className="u-mono">{shortId(receipt.solanaSignature)}</span> <Icon name="external" size={13} />
                  </a>
                ) : (
                  <span className="u-chain-pending">
                    <span className="u-dot-pulse" aria-hidden="true" /> Recording on Solana…
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <p className="u-sheet-note">
            <Icon name="lock" size={14} /> The public record shows the amount and an anonymous reference, never your name.
          </p>
          <div className="u-sheet-actions">
            <button type="button" className="d-btn" onClick={() => window.print()}>
              <Icon name="receipt" /> Print receipt
            </button>
            <button type="button" className="d-btn d-btn-teal" onClick={close} autoFocus>
              Done
            </button>
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
