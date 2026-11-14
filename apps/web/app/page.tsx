"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, SolanaMark, type IconName } from "@/components/Icon";
import { VioletOverview } from "@/components/site/VioletOverview";
import { DonatePanel } from "@/components/site/DonatePanel";
import { PublicShell } from "@/components/site/PublicShell";
import { getFundSummary } from "@/lib/api";
import { explorerTx, shortDate, shortSig, usd, usdParts } from "@/lib/format";
import { FORMULA_WEIGHTS } from "@/lib/mock";
import type { FundSummary } from "@/lib/types";
import { SECOND_APPROVAL_ABOVE_CENTS } from "@/lib/types";

// Public home: the community fund. Aggregates only; nothing here identifies a patient.

type Tab = "overview" | "ledger" | "about";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "ledger", label: "Ledger" },
  { id: "about", label: "How it works" },
];

const EVENT: Record<string, { label: string; icon: IconName; bg: string; fg: string; sign: string }> = {
  donation: { label: "Donation", icon: "heart", bg: "var(--mint-soft)", fg: "#2a7a5f", sign: "+" },
  reservation: { label: "Reserved for a grant", icon: "lock", bg: "var(--lilac-soft)", fg: "#5a51a8", sign: "" },
  release: { label: "Reservation released", icon: "refresh", bg: "#f0f1f0", fg: "#5d625f", sign: "" },
  payout: { label: "Paid to provider", icon: "store", bg: "var(--rose-soft)", fg: "#a5513f", sign: "−" },
  receipt: { label: "Receipt", icon: "receipt", bg: "var(--sky-soft)", fg: "#3b6c9a", sign: "" },
};

const WEIGHT_COLORS = ["var(--mint)", "var(--sky)", "var(--lilac)", "var(--rose)", "var(--sand)", "#dadddb"];

export default function Home() {
  const donationDialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [s, setS] = useState<FundSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getFundSummary()
      .then(setS)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  function exportLedger() {
    if (!s?.recent.length) return;
    const field = (value: string | number | null) => {
      const text = String(value ?? "");
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const rows = s.recent.map((event) => [
      EVENT[event.type].label,
      event.at,
      event.amountCents / 100,
      event.solanaSignature,
    ].map(field).join(","));
    const url = URL.createObjectURL(new Blob([
      ["Event,Date,Amount (USD),Solana signature", ...rows].join("\r\n"),
    ], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "abdulcare-fund-activity.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showDonation() {
    const dialog = donationDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  return (
    <PublicShell tabs={TABS} tab={tab} onTab={setTab} onDonate={showDonation} search={search} onSearch={(query) => {
      setSearch(query);
      setTab("ledger");
    }}>
      <div className="v-page-header">
        <h1 className="pub-h1">
        {tab === "overview" ? "Community fund" : tab === "ledger" ? "Ledger" : "How it works"}
        <small>
          {tab === "overview"
            ? "Pays medical bills straight to the provider. A caseworker approves every grant."
            : tab === "ledger"
              ? "Every dollar in and out. References are opaque and never identify a patient."
              : "Tap, pick a bill, a caseworker decides, the provider is paid."}
        </small>
      </h1>
        {tab !== "about" && (
          <div className="v-page-actions">
            {s?.recent[0] && <span className="v-outline v-date"><Icon name="calendar" /> {shortDate(s.recent[0].at)}</span>}
            <button className="v-outline" onClick={exportLedger} disabled={!s?.recent.length}><Icon name="arrowUpRight" /> Export</button>
          </div>
        )}
      </div>

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

      {tab === "overview" && <VioletOverview summary={s} showLedger={() => { setSearch(""); setTab("ledger"); }} showRules={() => setTab("about")} showDonation={showDonation} />}
      {tab === "ledger" && <LedgerTable s={s} search={search} />}
      {tab === "about" && <About s={s} />}

      <p className="proto-note">HackUMass prototype · fictional people · Nessie sandbox money · Solana devnet receipts</p>
      <dialog ref={donationDialog} className="v-donate-dialog" aria-label="Donate to AbdulCare">
        <button type="button" className="v-donate-close v-quiet" aria-label="Close donation form" onClick={() => donationDialog.current?.close()}><Icon name="x" /></button>
        <DonatePanel available={s?.availableCents ?? null} onDonated={setS} />
      </dialog>
    </PublicShell>
  );
}

function LedgerTable({ s, search }: { s: FundSummary | null; search: string }) {
  const term = search.trim().toLowerCase();
  const filtered = s && term ? {
    ...s,
    recent: s.recent.filter((event) => [EVENT[event.type]?.label, event.reference, event.solanaSignature].some((value) => value?.toLowerCase().includes(term))),
  } : s;
  return <LedgerResults key={term} s={filtered} />;
}

function LedgerResults({ s }: { s: FundSummary | null }) {
  const [filter, setFilter] = useState<"all" | "donation" | "payout">("all");
  const rows = (s?.recent ?? []).filter((e) => filter === "all" || e.type === filter);
  return (
    <section className="g-card" aria-label="Ledger">
      <div className="g-head" style={{ marginBottom: 18, alignItems: "center" }}>
        <p className="g-sub" style={{ margin: 0 }}>
          Latest {s?.recent.length ?? 0} events
        </p>
        <div className="tabs" role="tablist" aria-label="Filter">
          {(
            [
              ["all", "All"],
              ["donation", "Donations"],
              ["payout", "Payouts"],
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
              <th scope="col">Reference</th>
              <th scope="col">Date</th>
              <th scope="col">Solana receipt</th>
              <th scope="col" className="right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const m = EVENT[e.type] ?? EVENT.release;
              const [w, c] = usdParts(e.amountCents);
              return (
                <tr key={`${e.reference}-${i}`}>
                  <td>
                    <span className="ev">
                      <span className="act-icon" style={{ "--bg-c": m.bg, "--fg-c": m.fg } as React.CSSProperties}>
                        <Icon name={m.icon} />
                      </span>
                      {m.label}
                    </span>
                  </td>
                  <td className="mono muted">{e.reference}</td>
                  <td>
                    {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td>
                    {e.solanaSignature ? (
                      <a className="sig" href={explorerTx(e.solanaSignature)} target="_blank" rel="noreferrer">
                        <SolanaMark size={12} />
                        {shortSig(e.solanaSignature)}
                      </a>
                    ) : (
                      <span className="chip chip-warn chip-dot">Pending</span>
                    )}
                  </td>
                  <td className="right num">
                    {m.sign}
                    {w}
                    <span className="cents">{c}</span>
                  </td>
                </tr>
              );
            })}
            {s && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function About({ s }: { s: FundSummary | null }) {
  const second = s?.rules?.secondApprovalAboveCents ?? SECOND_APPROVAL_ABOVE_CENTS;
  const steps = [
    ["Tap the CareCard", "At a participating clinic kiosk. No app, password or smartphone; the patient's profile is on file."],
    ["Pick a bill", "AbdulCare finds medical bills in the linked bank account and explains each one in plain words, with read-aloud."],
    ["A caseworker decides", "Requests are ranked by need. A caseworker reviews each one in private and approves or declines it."],
    ["The provider is paid", "At the counter, the patient taps again and staff confirm. The fund pays the provider and records a public receipt."],
  ];
  const rules = [
    ["Need first", "The queue follows a published 100-point need score. Gemini compares anonymized requests; the formula is the fallback."],
    ["People decide", `Every grant needs a caseworker's approval. Grants over ${usd(second)} need a second caseworker.`],
    ["Providers only", "Money goes to participating providers, never to the patient, so it can only pay for care."],
    ["Private", "Names, demographics and diagnoses are never used to rank anyone and never go on-chain."],
  ];
  return (
    <div className="info-grid">
      <section className="g-card" aria-labelledby="hw-title">
        <h2 id="hw-title" className="g-title">
          The journey
        </h2>
        <ol className="numbered">
          {steps.map(([t, d], i) => (
            <li key={t}>
              <b>{i + 1}</b>
              <span>
                <strong>{t}</strong>
                <p>{d}</p>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section className="g-card" aria-labelledby="rl-title">
        <h2 id="rl-title" className="g-title">
          The fund&apos;s rules
        </h2>
        <ol className="numbered">
          {rules.map(([t, d]) => (
            <li key={t}>
              <b>
                <Icon name="check" size={18} />
              </b>
              <span>
                <strong>{t}</strong>
                <p>{d}</p>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
