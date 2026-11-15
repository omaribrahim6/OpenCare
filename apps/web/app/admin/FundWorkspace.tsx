"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, SolanaMark, type IconName } from "@/components/Icon";
import { FundOverview } from "./FundOverview";
import { PublicLedger, publicCaseId } from "../fund/PublicLedger";
import { DonatePanel } from "@/components/site/DonatePanel";
import { LedgerCaseDrawer } from "@/components/site/LedgerCaseDrawer";
import { getFundSummary, getLedger } from "@/lib/api";
import { explorerTx, shortDate, shortSig, usd, usdParts } from "@/lib/format";
import { FORMULA_WEIGHTS } from "@/lib/mock";
import type { LedgerEntry, LedgerResponse } from "@abdulcare/contracts";
import type { FundSummary, QueueItem } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";

type FundTab = "overview" | "ledger" | "about";

const EVENT: Record<string, { label: string; icon: IconName; bg: string; fg: string; sign: string }> = {
  donation: { label: "Donation", icon: "heart", bg: "var(--mint-soft)", fg: "#2a7a5f", sign: "+" },
  reservation: { label: "Reserved for a grant", icon: "lock", bg: "#edeefc", fg: "#2d37bf", sign: "" },
  release: { label: "Reservation released", icon: "refresh", bg: "#f0f1f0", fg: "#5d625f", sign: "" },
  payout: { label: "Paid to hospital", icon: "store", bg: "var(--rose-soft)", fg: "#a5513f", sign: "−" },
  pending: { label: "Approved, paying", icon: "clock", bg: "#edeefc", fg: "#2d37bf", sign: "−" },
  declined: { label: "Request declined", icon: "xCircle", bg: "#f0f1f0", fg: "#5d625f", sign: "" },
  receipt: { label: "Receipt", icon: "receipt", bg: "var(--sky-soft)", fg: "#545898", sign: "" },
};

const WEIGHT_COLORS = ["var(--mint)", "var(--sky)", "var(--lilac)", "var(--rose)", "var(--sand)", "#dadddb"];

export function FundWorkspace({
  initialTab,
  onLedger,
  queue,
  onViewQueue,
  onOpenRequest,
  audience = "admin",
}: {
  initialTab: FundTab;
  /** "public" (/fund) shows only what is safe to publish: case IDs, provider, amount, month, receipt. */
  audience?: "admin" | "public";
  onLedger?: () => void;
  queue?: QueueItem[];
  onViewQueue?: () => void;
  onOpenRequest?: (grantId: string) => void;
}) {
  const ledgerOnly = initialTab === "ledger";
  const donationDialog = useRef<HTMLDialogElement>(null);
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
    if (audience === "public") {
      // Public export: the same fields the public table shows, nothing about the patient or the care.
      const moved = ledger.entries.filter((e) => e.kind === "payout" || e.kind === "pending" || e.kind === "donation");
      const pub = moved.map((e) => [
        e.kind === "donation" ? "Donation" : "Provider payment",
        e.kind === "donation" ? "" : publicCaseId(e.reference),
        e.kind === "donation" ? (e.donorLabel ?? "Community contribution") : (e.hospital ?? ""),
        e.kind === "donation" || !e.category ? "" : CATEGORY_LABEL[e.category],
        e.chargesCents == null ? "" : e.chargesCents / 100,
        e.insurerPaidCents == null ? "" : e.insurerPaidCents / 100,
        e.hospitalAssistanceCents == null ? "" : e.hospitalAssistanceCents / 100,
        (e.kind === "donation" ? 1 : -1) * e.amountCents / 100,
        new Date(e.at).toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        e.solanaSignature,
      ].map(field).join(","));
      const url = URL.createObjectURL(new Blob([
        ["Event,Public case ID,Provider or donor,Care category,Billed (USD),Insurance paid (USD),Hospital assistance (USD),Fund amount (USD),Reporting period,Solana signature", ...pub].join("\r\n"),
      ], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "opencare-public-ledger.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
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

      {tab === "overview" && <FundOverview summary={s} queue={queue} onLedger={() => onLedger?.()} onViewQueue={onViewQueue} onOpenRequest={onOpenRequest} />}
      {tab === "ledger" && (
        audience === "public" ? <PublicLedger ledger={ledger} /> : <LedgerResults ledger={ledger} />
      )}
      {tab === "about" && <About />}

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

type LedgerFilter = "all" | "donation" | "payout" | "approval" | "declined";
type LedgerRange = "all" | "7" | "30" | "90";

const FILTERS: [LedgerFilter, string][] = [
  ["all", "All"],
  ["donation", "Donations"],
  ["payout", "Payouts"],
  ["approval", "Approvals"],
  ["declined", "Declined"],
];
const RANGES: [LedgerRange, string][] = [
  ["all", "All time"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
];
const longDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortRef = (ref: string) => (ref.length > 11 ? ref.slice(0, 11) : ref);

function matchesFilter(e: LedgerEntry, f: LedgerFilter) {
  if (f === "all") return true;
  if (f === "approval") return e.kind === "pending";
  return e.kind === f;
}

/** The ledger: totals, a toolbar (search, event type, date range), and every event; a row opens its full record. */
function LedgerResults({ ledger }: { ledger: LedgerResponse | null }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [range, setRange] = useState<LedgerRange>("all");
  const [desc, setDesc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const term = search.trim().toLowerCase();
  const since = range === "all" ? 0 : Date.now() - Number(range) * 86_400_000;
  const rows = useMemo(
    () =>
      (ledger?.entries ?? [])
        .filter((e) => matchesFilter(e, filter))
        .filter((e) => new Date(e.at).getTime() >= since)
        .filter(
          (e) =>
            !term ||
            [EVENT[e.kind]?.label, e.reference, e.solanaSignature, e.hospital, e.summary, e.donorLabel, e.region, e.category && CATEGORY_LABEL[e.category]]
              .some((v) => v?.toLowerCase().includes(term)),
        )
        .sort((a, b) => (new Date(b.at).getTime() - new Date(a.at).getTime()) * (desc ? 1 : -1)),
    [ledger, filter, since, term, desc],
  );
  const times = rows.map((e) => new Date(e.at).getTime());
  const span = times.length ? `${longDate(Math.min(...times))} – ${longDate(Math.max(...times))}` : "No events";
  const rangeLabel = range === "all" ? span : `${longDate(since)} – ${longDate(Date.now())}`;
  const t = ledger?.totals;
  const tiles: [IconName, string, React.ReactNode][] = t
    ? [
        ["heart", "Total donated", usd(t.donatedCents)],
        ["store", "Paid to hospitals / providers", usd(t.paidCents)],
        ["layers", "Cost of care reviewed", usd(t.careCostCents)],
        ["bill", "Cases decided", <>{t.cases.toLocaleString()} <small>({t.declined} declined)</small></>],
      ]
    : [];

  return (
    <section className={`lg${open ? " lg-docked" : ""}`} aria-label="Ledger">
      {t && (
        <dl className="lg-tiles">
          {tiles.map(([icon, label, value]) => (
            <div key={label}>
              <span className="lg-tile-icon">
                <Icon name={icon} />
              </span>
              <span>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </span>
            </div>
          ))}
        </dl>
      )}

      <div className="lg-toolbar">
        <label className="lg-search">
          <Icon name="search" />
          <span className="sr-only">Search the ledger</span>
          <input
            type="search"
            value={search}
            placeholder="Search by case ID, diagnosis, provider, or donor…"
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(60);
            }}
          />
        </label>
        <div className="lg-chips" role="group" aria-label="Event type">
          <span>Event type</span>
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        <label className="lg-range">
          <Icon name="calendar" />
          <span>
            <small>Date range</small>
            <b>{rangeLabel}</b>
          </span>
          <select value={range} onChange={(e) => setRange(e.target.value as LedgerRange)} aria-label="Date range">
            {RANGES.map(([r, label]) => (
              <option key={r} value={r}>
                {label}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" />
        </label>
      </div>

      <p className="lg-count">
        {rows.length.toLocaleString()} {rows.length === 1 ? "event" : "events"} · {span}
      </p>

      <div className="lg-table-wrap">
        <table className="lg-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Case ID</th>
              <th scope="col">Summary / Details</th>
              <th scope="col" className="right">Cost of care</th>
              <th scope="col" aria-sort={desc ? "descending" : "ascending"}>
                <button type="button" className="lg-sort" onClick={() => setDesc((d) => !d)}>
                  Date <span aria-hidden="true">{desc ? "↓" : "↑"}</span>
                </button>
              </th>
              <th scope="col">Receipt / Verification</th>
              <th scope="col" className="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e, i) => {
              const m = EVENT[e.kind] ?? EVENT.release;
              const [w, c] = usdParts(e.amountCents);
              const isCase = e.kind !== "donation";
              return (
                <tr key={`${e.reference}-${i}`} className={open === e.reference ? "on" : undefined} onClick={() => setOpen(e.reference)}>
                  <td>
                    <span className="lg-event">
                      <span className="lg-event-icon" style={{ "--bg-c": m.bg, "--fg-c": m.fg } as React.CSSProperties}>
                        <Icon name={m.icon} />
                      </span>
                      {m.label}
                    </span>
                  </td>
                  <td>{isCase ? <span className="lg-ref" title={e.reference}>{shortRef(e.reference)}</span> : <span className="lg-dash">—</span>}</td>
                  <td className="lg-detail">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setOpen(e.reference);
                      }}
                    >
                      <strong>{isCase ? e.summary : (e.donorLabel ?? "Anonymous donor")}</strong>
                      <small>
                        {isCase
                          ? `${e.hospital ?? ""}${e.category ? ` · ${CATEGORY_LABEL[e.category]}` : ""}`
                          : `${e.donorKind ? DONOR_KIND_LABEL[e.donorKind] : "Donor"} · ${e.reference}`}
                      </small>
                    </button>
                  </td>
                  <td className="right num">{e.chargesCents != null ? usd(e.chargesCents) : <span className="lg-dash">—</span>}</td>
                  <td className="lg-date">{longDate(new Date(e.at).getTime())}</td>
                  <td>
                    {e.solanaSignature ? (
                      <span className="lg-receipt">
                        <a href={explorerTx(e.solanaSignature)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                          <Icon name="receipt" />
                          {shortSig(e.solanaSignature)}
                        </a>
                        <span className="lg-verified">
                          <Icon name="check" /> Verified
                        </span>
                      </span>
                    ) : (
                      <span className="lg-pending">Pending</span>
                    )}
                  </td>
                  <td className="right num lg-amount">
                    {e.kind === "declined" ? (
                      "$0.00"
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
                <td colSpan={7} className="lg-empty">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="lg-more">
          <button className="v-outline" onClick={() => setLimit((n) => n + 100)}>
            Show more
          </button>
        </div>
      )}
      {open && <LedgerCaseDrawer key={open} reference={open} onClose={() => setOpen(null)} />}
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
