"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Device } from "@abdulcare/contracts";
import { DeskShell, type DeskView } from "@/components/desk/DeskShell";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ApiRequestError, currentDevice, decideGrant, getBriefedQueue, LIVE } from "@/lib/api";
import { cleanName, initials, usd, usdCompact, usdParts } from "@/lib/format";
import type { Grant, QueueItem, ReviewQueue } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";
import { AdminGate } from "./AdminGate";
import { CaseDrawer } from "./CaseDrawer";
import { FundWorkspace } from "./FundWorkspace";
import { Decided } from "./Decided";

type Load =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; queue: ReviewQueue };

type SortKey = "rank" | "amount" | "need" | "waiting";
type Metric = "count" | "amount";


/** Admin (SPEC §4 screen 5): behind a staff PIN, the need-ranked queue, why each request ranks there, and the decision. */
export function Desk({ initialView }: { initialView: DeskView }) {
  const [view, setView] = useState<DeskView>(initialView);
  // undefined while checking; only a reviewer device gets past the PIN screen.
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const [metric, setMetric] = useState<Metric>("count");
  const [toast, setToast] = useState<string | null>(null);
  const [decidedTick, setDecidedTick] = useState(0);

  useEffect(() => {
    currentDevice()
      .then((r) => setDevice(r.device))
      .catch(() => setDevice(null));
  }, []);

  const fetchQueue = useCallback(
    (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoad((s) => (s.phase === "done" ? s : { phase: "loading" }));
      return getBriefedQueue()
        .then((queue) => setLoad({ phase: "done", queue }))
        .catch((e) =>
        {
          if (e instanceof ApiRequestError && (e.status === 401 || e.status === 403)) {
            // The device cookie was revoked or expired: back to the PIN screen.
            setDevice(null);
            setExpired(true);
            setLoad({ phase: "loading" });
          } else {
            setLoad({ phase: "error", message: e instanceof Error ? e.message : "The queue didn't load." });
          }
        })
        .finally(() => setRefreshing(false));
    },
    [],
  );
  const isReviewer = device?.role === "reviewer";
  useEffect(() => {
    if (isReviewer) fetchQueue();
  }, [isReviewer, fetchQueue]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const queue = load.phase === "done" ? load.queue : null;
  // The queue holds requests still waiting for a decision (mocks keep decided ones in the list).
  const items = useMemo(() => (queue?.items ?? []).filter((it) => it.grant.status === "pending_review"), [queue]);
  const selected = items.find((i) => i.grant.id === selectedId) ?? items[0] ?? null;
  const drawerItem = items.find((i) => i.grant.id === drawerId) ?? null;

  const available = queue?.availableCents ?? 0;
  const requested = items.reduce((a, it) => a + it.grant.requestedCents, 0);
  const flagged = items.filter((it) => it.suspiciousContent).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((it) =>
          [it.grant.patient.displayName, it.grant.bill.merchant, it.grant.bill.category ?? ""].some((s) => s.toLowerCase().includes(q)),
        )
      : items;
    const val = (it: QueueItem) =>
      sort.key === "rank" ? it.rank : sort.key === "amount" ? it.grant.requestedCents : sort.key === "need" ? it.assessment.score : it.daysWaiting;
    return [...filtered].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [items, search, sort]);

  // Budget reach: the first request that no longer fits if everything ranked above it were approved in full.
  const budgetEndsBefore = useMemo(() => {
    if (sort.key !== "rank" || sort.dir !== 1 || search.trim()) return null;
    let running = 0;
    return rows.find((it) => (running += it.grant.requestedCents) > available)?.grant.id ?? null;
  }, [rows, sort, search, available]);

  function onDecided(g: Grant) {
    setToast(
      g.status === "paid"
        ? `Approved and paid ${usd(g.approvedCents)} to ${g.provider.name}`
        : g.status === "payment_pending"
        ? `Approved ${usd(g.approvedCents)}. Payment is pending.`
        : g.status === "approved"
        ? `Approved ${usd(g.approvedCents)} for ${cleanName(g.patient.displayName)}`
        : g.status === "rejected"
          ? `Declined the request from ${cleanName(g.patient.displayName)}`
          : "First approval recorded. A second caseworker must approve it.",
    );
    setDecidedTick((t) => t + 1);
    if (g.status !== "pending_review") setDrawerId(null);
    fetchQueue(true);
  }

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "rank" ? 1 : -1 }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined);

  const actions = (
    <>
      <button
        className={`d-icon-btn${refreshing ? " spin" : ""}`}
        onClick={() => {
          fetchQueue(true);
          setDecidedTick((t) => t + 1);
        }}
        aria-label="Refresh"
        title="Refresh"
      >
        <Icon name="refresh" />
      </button>
    </>
  );

  const shell = (children: React.ReactNode) => (
    <DeskShell
      view={view}
      onView={setView}
      title={view === "queue" ? "Review queue" : view === "decided" ? "Decided" : "Community fund"}
      device={device ?? null}
      pending={queue ? items.length : null}
      actions={actions}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          <Icon name="checkCircle" />
          {toast}
        </div>
      )}
    </DeskShell>
  );

  if (device === undefined) {
    return (
      <main className="d-login" aria-busy="true">
        <span className="spinner" aria-label="Checking staff access" />
      </main>
    );
  }
  if (!isReviewer) {
    return (
      <AdminGate
        expired={expired}
        onSignedIn={(d) => {
          setDevice(d);
          setExpired(false);
        }}
      />
    );
  }

  if (view === "ledger") return shell(<FundWorkspace key="ledger" initialTab="ledger" />);

  if (load.phase === "error") {
    return shell(
      <div className="d-card d-gate" role="alert">
        <div>
          <h2>The queue didn&apos;t load</h2>
          <p>{load.message}</p>
          <button className="d-btn d-btn-teal" onClick={() => fetchQueue()}>
            <Icon name="refresh" /> Try again
          </button>
        </div>
      </div>,
    );
  }

  if (view === "fund" && load.phase === "done") return shell(
      <FundWorkspace
        key="fund"
        initialTab="overview"
        onLedger={() => setView("ledger")}
        queue={items}
        onViewQueue={() => setView("queue")}
        onOpenRequest={(id) => {
          setView("queue");
          setSelectedId(id);
          setDrawerId(id);
        }}
      />,
    );

  if (view === "decided" && load.phase === "done") return shell(<Decided tick={decidedTick} />);

  const loading = load.phase === "loading";
  const tiles = [
    { icon: "wallet" as const, label: "Available budget", value: money(available), cap: "Ready to grant" },
    { icon: "inbox" as const, label: "Waiting for review", value: String(items.length), cap: items.length === 1 ? "Request in the queue" : "Requests in the queue" },
    { icon: "dollar" as const, label: "Requested", value: money(requested), cap: "Across this queue" },
    { icon: "shield" as const, label: "Flagged", value: String(flagged), cap: flagged === 1 ? "Request with suspicious text" : "Requests with suspicious text" },
  ];

  return shell(
    <>
      <section className="d-card" aria-labelledby="ov-title">
        <div className="d-card-head">
          <h2 id="ov-title">Queue overview</h2>
          {queue && (
            <span className="d-pill teal">
              <Icon name="scale" size={15} /> Need-based order
            </span>
          )}
        </div>
        <div className="d-tiles">
          {tiles.map((t) => (
            <div key={t.label} className="d-tile">
              <div className="d-tile-head">
                <span className="d-tile-icon">
                  <Icon name={t.icon} strokeWidth={2} />
                </span>
                {t.label}
              </div>
              <div className="d-tile-num">
                {loading ? <span className="skeleton" style={{ display: "block", width: 110, height: 40 }} /> : t.value}
              </div>
              <div className="d-tile-cap">{t.cap}</div>
            </div>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="d-card" role="status" aria-live="polite" style={{ display: "flex", gap: 12, alignItems: "center", minHeight: 120 }}>
          <span className="spinner" style={{ color: "var(--d-teal)" }} />
          Loading review requests…
        </div>
      ) : items.length === 0 ? (
        <div className="d-card d-gate">
          <div>
            <span className="d-tile-icon" style={{ width: 48, height: 48, borderRadius: 12 }}>
              <Icon name="checkCircle" size={22} />
            </span>
            <h2>Nothing is waiting for review</h2>
            <p>New requests appear here as patients send them from the kiosk.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="d-split">
            <InflowChart
              items={items}
              available={available}
              metric={metric}
              setMetric={setMetric}
            />
            {selected && (
              <NextUp
                key={selected.grant.id}
                items={items}
                item={selected}
                onSelect={setSelectedId}
                onDetails={() => setDrawerId(selected.grant.id)}
                onDecided={onDecided}
              />
            )}
          </div>

          <section className="d-card" aria-labelledby="rq-title">
            <div className="d-card-head">
              <h2 id="rq-title">Requests</h2>
              <label className="d-search">
                <span className="sr-only">Search requests</span>
                <Icon name="search" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
              </label>
              <button className="d-btn d-btn-teal" onClick={() => selected && setDrawerId(selected.grant.id)}>
                <Icon name="bill" /> Review selected
              </button>
            </div>
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th scope="col" aria-sort={ariaSort("rank")}>
                      <button onClick={() => toggleSort("rank")}>
                        Rank <Icon name="sort" />
                      </button>
                    </th>
                    <th scope="col">Patient</th>
                    <th scope="col">Bill</th>
                    <th scope="col">Category</th>
                    <th scope="col" aria-sort={ariaSort("amount")}>
                      <button onClick={() => toggleSort("amount")}>
                        Amount <Icon name="sort" />
                      </button>
                    </th>
                    <th scope="col" aria-sort={ariaSort("need")}>
                      <button onClick={() => toggleSort("need")}>
                        Need <Icon name="sort" />
                      </button>
                    </th>
                    <th scope="col" aria-sort={ariaSort("waiting")}>
                      <button onClick={() => toggleSort("waiting")}>
                        Waiting <Icon name="sort" />
                      </button>
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => {
                    const g = it.grant;
                    const [w, c] = usdParts(g.requestedCents);
                    const isSel = selected?.grant.id === g.id;
                    return (
                      <Fragment key={g.id}>
                        {g.id === budgetEndsBefore && (
                          <tr className="budget">
                            <td colSpan={8}>The available budget runs out here if every request above is approved in full</td>
                          </tr>
                        )}
                        <tr
                          className="row"
                          aria-selected={isSel}
                          tabIndex={0}
                          onClick={() => {
                            setSelectedId(g.id);
                            setDrawerId(g.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(g.id);
                              setDrawerId(g.id);
                            }
                          }}
                        >
                          <td className="num">
                            #{it.rank}
                          </td>
                          <td>
                            <span className="d-who">
                              <span aria-hidden="true">{initials(g.patient.displayName)}</span>
                              {cleanName(g.patient.displayName)}
                            </span>
                          </td>
                          <td className="clip">
                            {g.bill.merchant}
                            {it.insight && (
                              <small className="d-insight" title={it.insight.summary}>
                                {it.insight.urgency} · {it.insight.labels.slice(0, 2).join(" · ")}
                              </small>
                            )}
                          </td>
                          <td>
                            <span className={`d-pill${g.bill.category ? " teal" : ""}`}>
                              {g.bill.category ? CATEGORY_LABEL[g.bill.category] : "Unknown"}
                            </span>
                          </td>
                          <td className="num">
                            {w}
                            <span className="cents">{c}</span>
                          </td>
                          <td>
                            <span className="d-score" aria-label={`Need score ${it.assessment.score} out of 100`}>
                              {it.assessment.score}
                              <i>
                                <b style={{ width: `${it.assessment.score}%` }} />
                              </i>
                            </span>
                          </td>
                          <td>
                            {it.daysWaiting} day{it.daysWaiting === 1 ? "" : "s"}
                          </td>
                          <td>
                            {it.suspiciousContent ? (
                              <span className="d-pill dot red">Flagged</span>
                            ) : g.awaitingSecondApproval ? (
                              <span className="d-pill dot blue">1 of 2 approvals</span>
                            ) : (
                              <span className="d-pill dot amber">Pending</span>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="d-empty">
                        No requests match &ldquo;{search}&rdquo;.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {drawerItem && queue && (
        <CaseDrawer key={drawerItem.grant.id} item={drawerItem} source={queue.source} onClose={() => setDrawerId(null)} onDecided={onDecided} />
      )}
      {!LIVE && <span className="sr-only">Mock data</span>}
    </>,
  );
}

/** Money for headline figures: exact under $1M, compact above ($1.77B), so a huge budget stays readable. */
function money(cents: number): string {
  return Math.abs(cents) >= 100_000_000 ? usdCompact(cents) : usd(cents);
}

const DAY_MS = 86_400_000;

/** Nice round step for a y-axis that tops out at or above max with 4 gridlines. */
function niceStep(max: number): number {
  const raw = Math.max(max, 1) / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

/**
 * Requests received per day (from how long each waiting request has waited), as vertical bars.
 * Shows whether the queue is filling up or calming down. Hover or focus a bar for the day's detail.
 */
function InflowChart({
  items,
  available,
  metric,
  setMetric,
}: {
  items: QueueItem[];
  available: number;
  metric: Metric;
  setMetric: (m: Metric) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.min(30, Math.max(7, ...items.map((it) => it.daysWaiting + 1)));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  // Oldest day first; index span-1 is today.
  const days = Array.from({ length: span }, (_, i) => ({
    date: new Date(today.getTime() - (span - 1 - i) * DAY_MS),
    count: 0,
    cents: 0,
  }));
  for (const it of items) {
    const d = days[span - 1 - Math.min(it.daysWaiting, span - 1)];
    d.count += 1;
    d.cents += it.grant.requestedCents;
  }
  const val = (d: (typeof days)[number]) => (metric === "count" ? d.count : d.cents);
  // Counts get whole-number gridlines (never "0.25 requests").
  const step = metric === "count" ? Math.max(1, Math.ceil(niceStep(Math.max(...days.map(val))))) : niceStep(Math.max(...days.map(val)));
  const top = step * 4;
  const fmt = (v: number) => (metric === "count" ? String(v) : usdCompact(v));
  const total = items.reduce((a, it) => a + it.grant.requestedCents, 0);
  const coversAll = total <= available;
  const labelEvery = span > 16 ? 3 : span > 8 ? 2 : 1;
  const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const h = hover == null ? null : days[hover];

  return (
    <section className="d-card d-inflow" aria-labelledby="inflow-title">
      <div className="d-rank-head">
        <div>
          <h2 id="inflow-title">Requests received</h2>
          <p className="d-note">
            <Icon name="wallet" />
            <span>
              Budget <b>{money(available)}</b> {coversAll ? `covers all ${items.length} waiting (${money(total)})` : `falls short of the ${money(total)} waiting`}
            </span>
          </p>
        </div>
        <div className="tabs" role="tablist" aria-label="Bars show">
          <button role="tab" aria-selected={metric === "count"} onClick={() => setMetric("count")}>
            Requests
          </button>
          <button role="tab" aria-selected={metric === "amount"} onClick={() => setMetric("amount")}>
            Amount
          </button>
        </div>
      </div>

      <div className="d-vbars">
        <div className="d-vbars-grid" aria-hidden="true">
          {[4, 3, 2, 1, 0].map((k) => (
            <div key={k}>
              <span>{fmt(step * k)}</span>
            </div>
          ))}
        </div>
        <div className="d-vbars-plot" role="list" aria-label={`Waiting requests by day received, last ${span} days`} onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => {
            const v = val(d);
            return (
              <div
                key={i}
                role="listitem"
                tabIndex={0}
                className={`d-vbar${hover === i ? " on" : ""}${i === span - 1 ? " today" : ""}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${day(d.date)}: ${d.count} ${d.count === 1 ? "request" : "requests"}, ${usd(d.cents)}`}
              >
                <i style={{ height: v ? `max(4px, ${(v / top) * 100}%)` : 0 }} />
                <span className="d-vbar-x">{i === span - 1 ? "Today" : (span - 1 - i) % labelEvery === 0 ? day(d.date) : ""}</span>
              </div>
            );
          })}
          {h && hover != null && (
            <div className="d-vtip" style={{ left: `${((hover + 0.5) / span) * 100}%`, bottom: `calc(${(Math.min(val(h), top) / top) * 100}% + 8px)` }}>
              <small>{hover === span - 1 ? "Today" : day(h.date)}</small>
              <div>
                <span>{h.count === 1 ? "1 request" : `${h.count} requests`}</span>
                <span>{usd(h.cents)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The next request to decide: who it is, what approving pays and why it ranks first, with
 * approve, decline and details one click away. Arrows step through the queue in need order.
 */
function NextUp({
  items,
  item,
  onSelect,
  onDetails,
  onDecided,
}: {
  items: QueueItem[];
  item: QueueItem;
  onSelect: (id: string) => void;
  onDetails: () => void;
  onDecided: (g: Grant) => void;
}) {
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranked = [...items].sort((a, b) => a.rank - b.rank);
  const pos = ranked.findIndex((it) => it.grant.id === item.grant.id);
  const g = item.grant;
  const name = cleanName(g.patient.displayName);
  // Same default as the case drawer: the brief's suggestion (the full remaining balance), in exact cents.
  const firstApproval = g.approvals[0]?.approvedCents;
  const cents =
    g.awaitingSecondApproval && firstApproval
      ? firstApproval
      : (item.brief?.suggestedCents ?? item.remainingCents ?? g.requestedCents);
  const why = item.brief?.reasons[0] ?? item.insight?.summary ?? item.rationale;
  const flags = [
    ...(item.suspiciousContent ? ["Suspicious text in the request"] : []),
    ...(item.brief?.flags.map((f) => f.detail) ?? []),
  ];
  const urgency = item.insight?.urgency;

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const next = (await decideGrant(g.id, decision === "approve" ? { decision, approvedCents: cents } : { decision })).grant;
      setConfirm(null);
      onDecided(next);
    } catch (e) {
      setConfirm(null);
      setError(e instanceof Error ? e.message : "The decision wasn't saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="d-card d-next" aria-labelledby="next-title">
      <div className="d-next-head">
        <span className="d-next-eyebrow">{pos === 0 ? "Next up" : "Selected"} · #{item.rank} by need</span>
        <div className="d-next-nav">
          <span>
            {pos + 1} of {ranked.length}
          </span>
          <button className="d-icon-btn" aria-label="Previous request" disabled={pos <= 0} onClick={() => onSelect(ranked[pos - 1].grant.id)}>
            <Icon name="chevronLeft" />
          </button>
          <button className="d-icon-btn" aria-label="Next request" disabled={pos >= ranked.length - 1} onClick={() => onSelect(ranked[pos + 1].grant.id)}>
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>

      <div className="d-next-who">
        <span className="d-avatar-lg" aria-hidden="true">
          {initials(g.patient.displayName)}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 id="next-title">{name}</h2>
          <p>
            {g.bill.merchant}
            {g.bill.category ? ` · ${CATEGORY_LABEL[g.bill.category]}` : ""}
          </p>
        </div>
        {flags.length ? (
          <span className="d-pill dot red">Flagged</span>
        ) : g.awaitingSecondApproval ? (
          <span className="d-pill dot blue">1 of 2 approvals</span>
        ) : urgency === "critical" || urgency === "high" ? (
          <span className="d-pill dot amber">{urgency === "critical" ? "Critical" : "High urgency"}</span>
        ) : null}
      </div>

      <dl className="d-next-facts">
        <div>
          <dt>Approve</dt>
          <dd className="big">{usd(cents)}</dd>
        </div>
        <div>
          <dt>Need score</dt>
          <dd>
            {item.assessment.score}
            <small> / 100</small>
          </dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>
            {item.daysWaiting} day{item.daysWaiting === 1 ? "" : "s"}
          </dd>
        </div>
      </dl>

      {why && <p className="d-next-why">{why}</p>}
      {flags.length > 0 && (
        <p className="d-next-flag">
          <Icon name="alert" /> {flags[0]}
          {flags.length > 1 ? ` (+${flags.length - 1} more)` : ""}. Open the details before deciding.
        </p>
      )}
      {error && (
        <p className="d-next-flag" role="alert">
          <Icon name="alert" /> {error}
        </p>
      )}

      <div className="d-next-actions">
        <button className="d-btn d-btn-teal" onClick={() => setConfirm("approve")} disabled={busy || cents < 100}>
          <Icon name="check" /> Approve {usd(cents)}
        </button>
        <button className="d-btn d-btn-danger" onClick={() => setConfirm("reject")} disabled={busy}>
          Decline
        </button>
        <button className="d-btn" onClick={onDetails}>
          Details <Icon name="arrowRight" />
        </button>
      </div>

      <ConfirmDialog
        open={confirm === "approve"}
        title={`Approve ${usd(cents)} for ${name}?`}
        confirmLabel={`Approve ${usd(cents)}`}
        confirmClass="d-btn d-btn-teal"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => decide("approve")}
      >
        <p style={{ color: "#535465" }}>
          {g.visit
              ? `This pays ${usd(cents)} from the community care fund to ${g.provider.name} now, toward ${name}'s bill. It can't be undone.`
              : `This reserves ${usd(cents)} for ${name}, payable only to ${g.provider.name}. The amount and recipient can't be changed afterward.`}{" "}
          To approve a different amount, use Details.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "reject"}
        title={`Decline ${name}'s request?`}
        confirmLabel="Decline"
        confirmClass="d-btn d-btn-danger"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => decide("reject")}
      >
        <p style={{ color: "#535465" }}>{name} will see that the request wasn&apos;t approved. No money is reserved.</p>
      </ConfirmDialog>
    </section>
  );
}
