"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, SolanaMark, type IconName } from "@/components/Icon";
import { VioletOverview } from "@/components/site/VioletOverview";
import { DonatePanel } from "@/components/site/DonatePanel";
import { LedgerCaseDrawer } from "@/components/site/LedgerCaseDrawer";
import { getFundSummary, getLedger } from "@/lib/api";
import { explorerTx, shortDate, shortSig, usd, usdParts } from "@/lib/format";
import { FORMULA_WEIGHTS } from "@/lib/mock";
import type { LedgerEntry, LedgerResponse } from "@abdulcare/contracts";
import type { FundSummary } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";

type FundTab = "overview" | "ledger" | "about";

const EVENT: Record<string, { label: string; icon: IconName; bg: string; fg: string; sign: string }> = {
  donation: { label: "Donation", icon: "heart", bg: "var(--mint-soft)", fg: "#2a7a5f", sign: "+" },
  reservation: { label: "Reserved for a grant", icon: "lock", bg: "#ecf2fd", fg: "#225dca", sign: "" },
  release: { label: "Reservation released", icon: "refresh", bg: "#f0f1f0", fg: "#5d625f", sign: "" },
  payout: { label: "Paid to hospital", icon: "store", bg: "var(--rose-soft)", fg: "#a5513f", sign: "−" },
  pending: { label: "Approved, paying", icon: "clock", bg: "#ecf2fd", fg: "#225dca", sign: "−" },
  declined: { label: "Request declined", icon: "xCircle", bg: "#f0f1f0", fg: "#5d625f", sign: "" },
  receipt: { label: "Receipt", icon: "receipt", bg: "var(--sky-soft)", fg: "#4f6a9d", sign: "" },
};

const WEIGHT_COLORS = ["var(--mint)", "var(--sky)", "var(--lilac)", "var(--rose)", "var(--sand)", "#dadddb"];

export function FundWorkspace({ initialTab, onLedger }: { initialTab: FundTab; onLedger?: () => void }) {
  const ledgerOnly = initialTab === "ledger";
  const donationDialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FundTab>(initialTab);
  const [s, setS] = useState<FundSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    if (!ledgerOnly) getFundSummary().then(setS).catch(() => setFailed(true));
    getLedger()
      .then(setLedger)
      .catch(() => setFailed(true));
  }, [ledgerOnly]);
  useEffect(load, [load]);

  function exportLedger() {
    if (!ledger?.entries.length) return;
    const field = (value: string | number | null | undefined) => {
      const text = String(value ?? "");
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const rows = ledger.entries.map((e) => [
      EVENT[e.kind]?.label ?? e.kind,
      e.at,
      e.reference,
      e.donorLabel ?? e.hospital ?? "",
      e.summary ?? "",
      e.chargesCents == null ? "" : e.chargesCents / 100,
      e.insurerPaidCents == null ? "" : e.insurerPaidCents / 100,
      e.hospitalAssistanceCents == null ? "" : e.hospitalAssistanceCents / 100,
      e.amountCents / 100,
      e.needScore ?? "",
      e.solanaSignature,
    ].map(field).join(","));
    const url = URL.createObjectURL(new Blob([
      ["Event,Date,Reference,Funder or hospital,Care,Cost of care (USD),Insurance paid (USD),Hospital assistance (USD),Fund amount (USD),Need score,Solana signature", ...rows].join("\r\n"),
    ], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "opencare-public-ledger.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showDonation() {
    const dialog = donationDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  return (
    <section className="pub violet d-fund-workspace" aria-label="Community fund">
      {!ledgerOnly && <nav className="d-fund-tabs" aria-label="Fund">
        <button type="button" aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>Overview</button>
        <button type="button" aria-pressed={tab === "about"} onClick={() => setTab("about")}>Fund rules</button>
      </nav>}
      {tab !== "about" && <div className="v-page-header">
        <h1 className="pub-h1">
        {tab === "overview" ? "Community fund" : "Ledger"}
        <small>
          {tab === "overview"
            ? "Pays medical bills straight to the provider. A caseworker approves every grant."
            : "Every dollar in and every case decided, with the bill behind it. Open a case to audit it; no one is named."}
        </small>
      </h1>
        <div className="v-page-actions">
          {s?.recent[0] && <span className="v-outline v-date"><Icon name="calendar" /> {shortDate(s.recent[0].at)}</span>}
          <button className="v-outline" onClick={exportLedger} disabled={!ledger?.entries.length}><Icon name="arrowUpRight" /> Export</button>
        </div>
      </div>}

      {failed && (
        <div className="notice notice-bad" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" />
          <span>
            The fund figures didn&apos;t load.{" "}
            <button className="link-arrow" onClick={load}>
              Try again
            </button>
          </span>
        </div>
      )}

      {tab === "overview" && <VioletOverview summary={s} showLedger={() => onLedger?.()} showRules={() => setTab("about")} showDonation={showDonation} />}
      {tab === "ledger" && (
        <>
          <label className="d-ledger-search">
            Search the public ledger
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <LedgerTable ledger={ledger} search={search} />
        </>
      )}
      {tab === "about" && <About />}

      <p className="proto-note">HackUMass prototype · fictional people · Nessie sandbox money · Solana devnet receipts</p>
      <dialog ref={donationDialog} className="v-donate-dialog" aria-label="Donate to OpenCare">
        <button type="button" className="v-donate-close v-quiet" aria-label="Close donation form" onClick={() => donationDialog.current?.close()}><Icon name="x" /></button>
        <DonatePanel available={s?.availableCents ?? null} onDonated={setS} />
      </dialog>
    </section>
  );
}

const DONOR_KIND_LABEL: Record<string, string> = {
  state_program: "State program",
  federal_program: "Federal program",
  hospital: "Hospital",
  foundation: "Foundation",
  corporate: "Company",
  community: "Community group",
  individual: "Individual",
};

function LedgerTable({ ledger, search }: { ledger: LedgerResponse | null; search: string }) {
  const term = search.trim().toLowerCase();
  const entries = (ledger?.entries ?? []).filter(
    (e) =>
      !term ||
      [EVENT[e.kind]?.label, e.reference, e.solanaSignature, e.hospital, e.summary, e.donorLabel, e.region]
        .some((value) => value?.toLowerCase().includes(term)),
  );
  return <LedgerResults key={term} ledger={ledger} entries={entries} />;
}

type LedgerFilter = "all" | "donation" | "payout" | "declined";

function LedgerResults({ ledger, entries }: { ledger: LedgerResponse | null; entries: LedgerEntry[] }) {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const rows = entries.filter((e) => filter === "all" || e.kind === filter || (filter === "payout" && e.kind === "pending"));
  const t = ledger?.totals;
  return (
    <section className="g-card" aria-label="Ledger">
      {t && (
        <dl className="lc-summary">
          <div><dt>Donated</dt><dd>{usd(t.donatedCents)}</dd></div>
          <div><dt>Paid to hospitals</dt><dd>{usd(t.paidCents)}</dd></div>
          <div><dt>Cost of care reviewed</dt><dd>{usd(t.careCostCents)}</dd></div>
          <div><dt>Cases decided</dt><dd>{t.cases.toLocaleString()} <small>({t.declined} declined)</small></dd></div>
        </dl>
      )}
      <div className="g-head lc-filter-row" style={{ marginBottom: 18, alignItems: "center" }}>
        <p className="g-sub" style={{ margin: 0 }}>
          {rows.length.toLocaleString()} events · select any row for the full record
        </p>
        <div className="tabs" role="tablist" aria-label="Filter">
          {(
            [
              ["all", "All"],
              ["donation", "Donations"],
              ["payout", "Payouts"],
              ["declined", "Declined"],
            ] as const
          ).map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap" style={{ background: "#fff" }}>
        <table className="table ledger-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Details</th>
              <th scope="col" className="right">Cost of care</th>
              <th scope="col">Date</th>
              <th scope="col">Solana receipt</th>
              <th scope="col" className="right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e, i) => {
              const m = EVENT[e.kind] ?? EVENT.release;
              const [w, c] = usdParts(e.amountCents);
              const isCase = e.kind !== "donation";
              return (
                <tr
                  key={`${e.reference}-${i}`}
                  className="lc-clickable"
                  onClick={() => setOpen(e.reference)}
                >
                  <td>
                    <span className="ev">
                      <span className="act-icon" style={{ "--bg-c": m.bg, "--fg-c": m.fg } as React.CSSProperties}>
                        <Icon name={m.icon} />
                      </span>
                      {m.label}
                    </span>
                  </td>
                  <td className="lc-detail">
                    {isCase ? (
                      <button type="button" className="lc-link" onClick={(ev) => { ev.stopPropagation(); setOpen(e.reference); }}>
                        <strong>{e.summary}</strong>
                        <small className="muted">
                          {e.hospital} · {e.category ? CATEGORY_LABEL[e.category] : ""}{e.needScore != null ? ` · need ${e.needScore}/100` : ""} · <span className="mono">{e.reference}</span>
                        </small>
                      </button>
                    ) : (
                      <button type="button" className="lc-link" onClick={(ev) => { ev.stopPropagation(); setOpen(e.reference); }}>
                        <strong>{e.donorLabel ?? "Anonymous donor"}</strong>
                        <small className="muted">
                          {e.donorKind ? `${DONOR_KIND_LABEL[e.donorKind]} · ` : ""}{e.purpose ? `${e.purpose} · ` : ""}<span className="mono">{e.reference}</span>
                        </small>
                      </button>
                    )}
                  </td>
                  <td className="right num muted">{e.chargesCents != null ? usd(e.chargesCents) : "—"}</td>
                  <td>
                    {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td>
                    {e.solanaSignature ? (
                      <a className="sig" href={explorerTx(e.solanaSignature)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                        <SolanaMark size={12} />
                        {shortSig(e.solanaSignature)}
                      </a>
                    ) : (
                      <span className="chip chip-warn chip-dot">Pending</span>
                    )}
                  </td>
                  <td className="right num">
                    {e.kind === "declined" ? (
                      <span className="muted">$0</span>
                    ) : (
                      <>
                        {m.sign}
                        {w}
                        <span className="cents">{c}</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {ledger && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button className="v-outline" onClick={() => setLimit((n) => n + 100)}>Show more</button>
        </div>
      )}
      {open && <LedgerCaseDrawer reference={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

const HOW = "/admin/how";

function About() {
  const steps = [
    ["journey-01-tap-carecard", "Tap the CareCard", "At a participating clinic kiosk. No app, password or smartphone; the patient's profile is on file."],
    ["journey-02-pick-a-bill", "Pick a bill", "OpenCare finds medical bills in the linked bank account and explains each one in plain words, with read-aloud."],
    ["journey-03-caseworker-decides", "A caseworker decides", "Requests are ranked by need. A caseworker reviews each one in private and approves or declines it."],
    ["journey-04-provider-is-paid", "The provider is paid", "At the counter, the patient taps again and staff confirm. The fund pays the provider and records a public receipt."],
  ];
  const rules = [
    ["rules-01-need-first", "Need first", "The queue follows a published 100-point need score. Gemini only writes the decision brief; it never sets the order."],
    ["rules-02-people-decide", "People decide", "A caseworker reviews every request and approves or declines it. One approval is enough to pay the hospital."],
    ["rules-03-providers-only", "Providers only", "Money goes to participating providers, never to the patient, so it can only pay for care."],
    ["rules-04-private", "Private", "Names, demographics and diagnoses are never used to rank anyone and never go on-chain."],
  ];
  const features = [
    ["features-01-fast-process", "Fast process", "From tap to payment, built for real clinic visits."],
    ["features-02-human-reviewed", "Human-reviewed", "A caseworker reviews every request for a fair, careful decision."],
    ["features-03-public-receipts", "Public receipts", "Every payment is recorded with a public receipt for trust."],
  ];
  return (
    <div className="hw">
      <header className="hw-hero" style={{ backgroundImage: `url(${HOW}/hero.png)` }}>
        <h1>How it works</h1>
        <p>Tap, pick a bill, a caseworker decides, the provider is paid.</p>
      </header>

      <div className="hw-cols">
        <section className="hw-card" aria-labelledby="hw-journey">
          <h2 id="hw-journey">
            <span className="hw-badge" aria-hidden="true">
              <Icon name="pulse" />
            </span>
            The journey
          </h2>
          <ol>
            {steps.map(([img, t, d], i) => (
              <li key={t} className="hw-item">
                <b className="hw-mark">{i + 1}</b>
                <img src={`${HOW}/${img}.png`} alt="" width={112} height={84} loading="lazy" />
                <span>
                  <strong>{t}</strong>
                  <p>{d}</p>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section className="hw-card" aria-labelledby="hw-rules">
          <h2 id="hw-rules">
            <span className="hw-badge" aria-hidden="true">
              <Icon name="shield" />
            </span>
            The fund&apos;s rules
          </h2>
          <ul>
            {rules.map(([img, t, d]) => (
              <li key={t} className="hw-item">
                <b className="hw-mark" aria-hidden="true">
                  <Icon name="check" size={16} />
                </b>
                <img src={`${HOW}/${img}.png`} alt="" width={112} height={84} loading="lazy" />
                <span>
                  <strong>{t}</strong>
                  <p>{d}</p>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ul className="hw-features">
        {features.map(([img, t, d]) => (
          <li key={t}>
            <img src={`${HOW}/${img}.png`} alt="" width={56} height={56} loading="lazy" />
            <span>
              <strong>{t}</strong>
              <p>{d}</p>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
