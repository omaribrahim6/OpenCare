"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Bill, Grant, GrantStatus, PortalOverviewResponse } from "@abdulcare/contracts";
import { GoldCareCard } from "@/components/desk/GoldCareCard";
import { Icon } from "@/components/Icon";
import { LogoMark } from "@/components/Logo";
import { STATUS_LABEL } from "@/components/StatusBadge";
import { cleanName, firstName, shortDate, stepLabel, usd } from "@/lib/format";
import { PortalError, getOverview, signIn, signOut } from "./portal-api";

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
      <main className="u-portal u-center" aria-busy="true">
        <p className="u-muted">Loading your account…</p>
      </main>
    );
  }
  if (state.kind === "signed_out") {
    return (
      <SignIn
        cardToken={cardToken}
        onSignedIn={() => {
          // The card token must not stay in the address bar or history.
          if (cardToken) window.history.replaceState(null, "", "/user");
          setState({ kind: "loading" });
          void load();
        }}
      />
    );
  }
  if (state.kind === "error") {
    return (
      <main className="u-portal u-center">
        <div className="d-card u-error">
          <p>{state.message}</p>
          <button className="d-btn d-btn-teal" onClick={() => void load()}>
            <Icon name="refresh" /> Try again
          </button>
        </div>
      </main>
    );
  }
  return (
    <Dashboard
      data={state.data}
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
          <LogoMark />
          OpenCare
        </div>
        <div className="u-login-card" aria-hidden="true">
          <GoldCareCard name="Your name" memberId="XXXX-XXX-XXXX" dob="XX-XX-XXXX" />
        </div>
        <h1>{useCard ? "CareCard found" : "Sign in to your account"}</h1>
        <p>
          {useCard
            ? "Enter your birth date to open your account."
            : "Your account ID is printed on the front of your CareCard. You can also tap the card on the top of your phone."}
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

function Dashboard({ data, onSignOut }: { data: PortalOverviewResponse; onSignOut: () => void }) {
  const { patient, profile, plan, bills, claims } = data;
  const name = cleanName(patient.displayName);
  const owed = bills.reduce((s, b) => s + b.remainingCents, 0);
  const charged = bills.reduce((s, b) => s + b.chargesCents, 0);
  const reduced = bills.reduce((s, b) => s + b.insurerPaidCents + b.hospitalAssistanceCents, 0);
  const fundPaid = bills.reduce((s, b) => s + b.fundPaidCents, 0);
  const openClaims = claims.filter((g) => OPEN.includes(g.status)).length;

  return (
    <div className="u-portal">
      <header className="u-bar">
        <Link href="/" className="u-brand" aria-label="OpenCare home">
          <LogoMark />
          <span>My account</span>
        </Link>
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
                <ClaimRow key={g.id} grant={g} />
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
              {bills.map((b) => (
                <BillRow key={b.visit.id} bill={b} />
              ))}
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

function ClaimRow({ grant: g }: { grant: Grant }) {
  const paid = g.status === "paid" ? (g.approvedCents ?? 0) : 0;
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
        <span className={`d-pill dot ${PILL[g.status]}`}>{STATUS_LABEL[g.status]}</span>
      </div>
      {(paid > 0 || g.receipt?.explorerUrl) && (
        <div className="u-row-foot">
          {paid > 0 && <span>Paid to {g.provider.name}{g.paidAt ? ` on ${shortDate(g.paidAt)}` : ""}</span>}
          {g.receipt?.explorerUrl && (
            <a href={g.receipt.explorerUrl} target="_blank" rel="noreferrer">
              Devnet receipt <Icon name="external" size={13} />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function BillRow({ bill: b }: { bill: Bill }) {
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

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
