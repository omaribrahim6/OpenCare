"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Device } from "@abdulcare/contracts";
import { DeskShell, type DeskView } from "@/components/desk/DeskShell";
import { Icon } from "@/components/Icon";
import { ApiRequestError, currentDevice, getBriefedQueue, LIVE } from "@/lib/api";
import { cleanName, initials, usd, usdCompact, usdParts } from "@/lib/format";
import type { Grant, NeedFactor, QueueItem, ReviewQueue } from "@/lib/types";
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
type Metric = "amount" | "need";

const topFactors = (factors: NeedFactor[], n = 3) =>
  [...factors].filter((f) => f.maxPoints > 0).sort((a, b) => b.points - a.points).slice(0, n);

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
  const [metric, setMetric] = useState<Metric>("amount");
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

  if (view === "fund" && load.phase === "done") return shell(<FundWorkspace key="fund" initialTab="overview" onLedger={() => setView("ledger")} />);

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
            <BudgetChart
              items={items}
              available={available}
              metric={metric}
              setMetric={setMetric}
              selectedId={selected?.grant.id ?? null}
              onSelect={setSelectedId}
            />
            {selected && <Selected item={selected} onReview={() => setDrawerId(selected.grant.id)} />}
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

const CHART_ROWS = 8;

/**
 * Queue at a glance: the top requests in need order as horizontal bars, scaled to the requests
 * themselves (not the budget), with a line where the budget runs out if everything above were paid.
 */
function BudgetChart({
  items,
  available,
  metric,
  setMetric,
  selectedId,
  onSelect,
}: {
  items: QueueItem[];
  available: number;
  metric: Metric;
  setMetric: (m: Metric) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ranked = [...items].sort((a, b) => a.rank - b.rank);
  // How many requests, taken in need order, the budget pays in full.
  let running = 0;
  let covered = 0;
  for (const it of ranked) {
    running += it.grant.requestedCents;
    if (running > available) break;
    covered++;
  }
  const total = ranked.reduce((a, it) => a + it.grant.requestedCents, 0);
  const all = covered === ranked.length;
  const shown = ranked.slice(0, CHART_ROWS);
  const value = (it: QueueItem) => (metric === "amount" ? it.grant.requestedCents : it.assessment.score);
  const max = metric === "amount" ? Math.max(...shown.map(value), 1) : 100;
  const label = (it: QueueItem) => (metric === "amount" ? usd(value(it)) : `${value(it)}`);

  return (
    <section className="d-card d-rank-card" aria-labelledby="bc-title">
      <div className="d-rank-head">
        <div>
          <h2 id="bc-title">Queue by need</h2>
          <p className="d-note">
            <Icon name="wallet" />
            <span>
              {all ? (
                <>
                  Budget <b>{money(available)}</b> covers all {ranked.length} {ranked.length === 1 ? "request" : "requests"} ({money(total)})
                </>
              ) : (
                <>
                  Budget <b>{money(available)}</b> covers the top <b>{covered} of {ranked.length}</b> in need order
                </>
              )}
            </span>
          </p>
        </div>
        <div className="tabs" role="tablist" aria-label="Bars show">
          <button role="tab" aria-selected={metric === "amount"} onClick={() => setMetric("amount")}>
            Amount
          </button>
          <button role="tab" aria-selected={metric === "need"} onClick={() => setMetric("need")}>
            Need score
          </button>
        </div>
      </div>

      <ol className="d-rank" aria-label={metric === "amount" ? "Requested amount, highest need first" : "Need score out of 100, highest need first"}>
        {shown.map((it, i) => {
          const on = it.grant.id === selectedId;
          const beyond = i >= covered;
          const name = cleanName(it.grant.patient.displayName);
          return (
            <Fragment key={it.grant.id}>
              {i === covered && !all && (
                <li className="d-rank-cut" aria-label="The budget runs out here">
                  <span>Budget runs out here</span>
                </li>
              )}
              <li>
                <button
                  className={`d-rank-row${on ? " on" : ""}${beyond ? " beyond" : ""}`}
                  onClick={() => onSelect(it.grant.id)}
                  aria-pressed={on}
                  aria-label={`Rank ${it.rank}, ${name}, ${metric === "amount" ? `requested ${usd(value(it))}` : `need score ${value(it)} of 100`}${beyond ? ", beyond the budget" : ""}`}
                >
                  <span className="d-rank-n">#{it.rank}</span>
                  <span className="d-rank-name">{name}</span>
                  <span className="d-rank-track" aria-hidden="true">
                    <i style={{ width: `${Math.max(2, (value(it) / max) * 100)}%` }} />
                  </span>
                  <span className="d-rank-val">{label(it)}</span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {ranked.length > CHART_ROWS && (
        <p className="d-rank-more">
          Top {CHART_ROWS} of {ranked.length}. The full queue is in the table below.
        </p>
      )}
    </section>
  );
}

function Selected({ item, onReview }: { item: QueueItem; onReview: () => void }) {
  const g = item.grant;
  const top = topFactors(item.assessment.factors);
  const colors = ["var(--d-teal)", "var(--d-sand)", "var(--d-mist)"];
  return (
    <section className="d-card d-sel" aria-labelledby="sel-title">
      <div className="d-sel-top">
        <div className="d-card-head">
          <h2 id="sel-title">{cleanName(g.patient.displayName)}</h2>
          {item.suspiciousContent ? (
            <span className="d-pill dot red">Flagged</span>
          ) : g.awaitingSecondApproval ? (
            <span className="d-pill dot blue">1 of 2 approvals</span>
          ) : (
            <span className="d-pill dot amber">Pending</span>
          )}
        </div>
        <div className="d-trio">
          <div>
            <small>Need score</small>
            <strong>{item.assessment.score} / 100</strong>
          </div>
          <div>
            <small>Queue rank</small>
            <strong>#{item.rank}</strong>
          </div>
          <div>
            <small>Waiting</small>
            <strong>
              {item.daysWaiting} day{item.daysWaiting === 1 ? "" : "s"}
            </strong>
          </div>
        </div>
      </div>
      <div className="d-sel-body">
        <div className="d-sel-row">
          <div style={{ minWidth: 0 }}>
            <p className="d-figure" style={{ marginTop: 0 }}>
              {usd(g.requestedCents)}
            </p>
            <p className="d-sel-cap">
              {g.bill.merchant}
              {g.bill.category ? ` · ${CATEGORY_LABEL[g.bill.category]}` : ""}
            </p>
          </div>
          <button className="d-btn" onClick={onReview}>
            <Icon name="bill" /> Review
          </button>
        </div>
        <div className="d-cols" style={{ gridTemplateColumns: top.map((f) => `minmax(108px, ${Math.max(f.points, 1)}fr)`).join(" ") }}>
          {top.map((f, i) => (
            <div key={f.key}>
              <strong>
                {f.points} of {f.maxPoints} pts
              </strong>
              <small title={f.input}>{f.label}</small>
              <i style={{ "--c": colors[i] } as React.CSSProperties} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
