"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Grant } from "@abdulcare/contracts";
import { Icon, type IconName } from "@/components/Icon";
import { GoldCareCard } from "@/components/desk/GoldCareCard";
import { listGrants } from "@/lib/api";
import { cleanName, usd, usdCompact } from "@/lib/format";
import type { FundSummary, QueueItem } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";

const DAY = 86_400_000;
const RANGE_DAYS = { Week: 7, Month: 30, Quarter: 90 } as const;
type Range = keyof typeof RANGE_DAYS;
type Metric = "paidCents" | "approvedCents";
type Bucket = { date: string; approvedCents: number; paidCents: number };

/** Exact under $1M, compact above ($1.8B), so huge totals stay readable. */
const money = (cents: number) => (Math.abs(cents) >= 100_000_000 ? usdCompact(cents) : usd(cents));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctLabel = (v: number) => `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;

/** Sums the summary's daily rows into `count` equal buckets over the last `days` days. */
function buckets(summary: FundSummary | null, days: number, count: number): Bucket[] {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows = new Map(summary?.daily.map((r) => [r.day.slice(0, 10), r]));
  return Array.from({ length: count }, (_, i) => {
    const first = Math.floor((i * days) / count);
    const last = Math.floor(((i + 1) * days) / count);
    const b: Bucket = { date: new Date(end - (days - last) * DAY).toISOString().slice(0, 10), approvedCents: 0, paidCents: 0 };
    for (let o = first; o < last; o++) {
      const row = rows.get(new Date(end - (days - 1 - o) * DAY).toISOString().slice(0, 10));
      b.approvedCents += row?.approvedCents ?? 0;
      b.paidCents += row?.paidCents ?? 0;
    }
    return b;
  });
}

/** Sum of one metric over the `days` days ending `endOffset` days ago. */
function windowSum(summary: FundSummary | null, metric: Metric, days: number, endOffset: number) {
  const now = Date.now();
  return (summary?.daily ?? []).reduce((a, r) => {
    const age = (now - new Date(r.day).getTime()) / DAY;
    return age >= endOffset && age < endOffset + days ? a + r[metric] : a;
  }, 0);
}

function niceStep(max: number) {
  const raw = Math.max(max, 1) / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };

function shortName(display: string) {
  const parts = cleanName(display).split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export function FundOverview({
  summary,
  queue,
  onLedger,
  onViewQueue,
  onOpenRequest,
}: {
  summary: FundSummary | null;
  queue?: QueueItem[];
  onLedger?: () => void;
  onViewQueue?: () => void;
  onOpenRequest?: (grantId: string) => void;
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  useEffect(() => {
    listGrants()
      .then((r) => setGrants(r.grants))
      .catch(() => setGrants([]));
  }, []);

  return (
    <div className="fo">
      <div className="fo-row fo-row-top">
        <BalanceCard summary={summary} />
        <AllocationCard summary={summary} />
        <section className="fo-card fo-card-cardholder" aria-label="Available to grant">
          <GoldCareCard />
          <button type="button" className="fo-grant-row" onClick={onLedger}>
            <span className="fo-grant-icon">
              <Icon name="layers" />
            </span>
            <span>
              <small>Available to grant</small>
              <strong title={summary ? usd(summary.availableCents) : undefined}>{summary ? money(summary.availableCents) : "—"}</strong>
            </span>
            <Icon name="chevronRight" />
          </button>
        </section>
      </div>
      <div className="fo-row fo-row-bottom">
        <ActivityCard summary={summary} />
        <InsightsCard grants={grants} queue={queue ?? null} onViewQueue={onViewQueue} onOpenRequest={onOpenRequest} />
      </div>
    </div>
  );
}

function BalanceCard({ summary }: { summary: FundSummary | null }) {
  const [range, setRange] = useState<Range>("Month");
  const points = useMemo(() => buckets(summary, RANGE_DAYS[range], range === "Week" ? 7 : 6), [summary, range]);
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId();
  const peak = Math.max(1, ...points.map((p) => p.paidCents));
  const xy = points.map((p, i) => ({ x: 6 + (388 * i) / (points.length - 1), y: 150 - (p.paidCents / peak) * 112 }));
  const path = xy.slice(1).reduce((d, p, i) => {
    const prev = xy[i];
    const mid = (prev.x + p.x) / 2;
    return `${d} C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y}`;
  }, `M ${xy[0].x} ${xy[0].y}`);
  const active = hover ?? points.length - 1;

  return (
    <section className="fo-card" aria-labelledby="fo-balance">
      <div className="fo-head">
        <h2 id="fo-balance">Available balance</h2>
        <label className="fo-select">
          <span className="sr-only">Range</span>
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <Icon name="chevronDown" />
        </label>
      </div>
      <p className="fo-big" title={summary ? usd(summary.availableCents) : undefined}>
        {summary ? money(summary.availableCents) : "—"}
      </p>
      <p className="fo-sub">Provider payouts over time</p>
      <div className="fo-line" onPointerLeave={() => setHover(null)}>
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--d-teal)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--d-teal)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path} L 394 160 L 6 160 Z`} fill={`url(#${gradient})`} />
          <path d={path} fill="none" stroke="var(--d-teal)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="fo-dot" style={{ left: `${(xy[active].x / 400) * 100}%`, top: `${(xy[active].y / 160) * 100}%` }} />
        <div className="fo-tip" style={{ left: `${(xy[active].x / 400) * 100}%`, top: `${(xy[active].y / 160) * 100}%` }}>
          <small>{dayLabel(points[active].date)}</small>
          <strong>{money(points[active].paidCents)}</strong>
        </div>
        <div className="fo-hit">
          {points.map((p, i) => (
            <span key={p.date} onPointerEnter={() => setHover(i)} />
          ))}
        </div>
      </div>
      <div className="fo-x">
        {points.map((p, i) => (
          <span key={p.date} className={i === points.length - 1 ? "on" : undefined}>
            {dayLabel(p.date)}
          </span>
        ))}
      </div>
    </section>
  );
}

function AllocationCard({ summary }: { summary: FundSummary | null }) {
  const total = summary?.totalCents ?? 0;
  const parts = [
    { label: "Available", cents: summary?.availableCents ?? 0, cls: "a" },
    { label: "Reserved", cents: summary?.reservedCents ?? 0, cls: "r" },
    { label: "Paid out", cents: summary?.paidCents ?? 0, cls: "p" },
  ];
  // Shares come from the three parts themselves, so they always add up to the whole arc and 100%.
  const whole = parts.reduce((a, p) => a + p.cents, 0);
  // Semicircle from left (180°) to right (0°); each part takes its share of the arc.
  const R = 92;
  const len = Math.PI * R;
  let offset = 0;
  return (
    <section className="fo-card" aria-labelledby="fo-alloc">
      <div className="fo-head">
        <h2 id="fo-alloc">Fund allocation</h2>
        <span className="fo-total">
          Total: <b>{summary ? money(total) : "—"}</b>
        </span>
      </div>
      <div className="fo-gauge">
        <svg viewBox="0 0 240 132" aria-hidden="true">
          <path className="fo-gauge-track" d={`M ${120 - R} 120 A ${R} ${R} 0 0 1 ${120 + R} 120`} pathLength={len} />
          {parts.map((p) => {
            const seg = whole > 0 ? (p.cents / whole) * len : 0;
            const el = seg > 0 && (
              <path
                key={p.label}
                className={`fo-gauge-seg ${p.cls}`}
                d={`M ${120 - R} 120 A ${R} ${R} 0 0 1 ${120 + R} 120`}
                pathLength={len}
                strokeDasharray={`${Math.max(seg - (offset > 0 ? 1.5 : 0), 0.01)} ${len}`}
                strokeDashoffset={-(offset + (offset > 0 ? 1.5 : 0))}
              />
            );
            offset += seg;
            return el;
          })}
        </svg>
        <div className="fo-gauge-value">
          <strong title={summary ? usd(total) : undefined}>{summary ? money(total) : "—"}</strong>
          <span>Total contributed</span>
        </div>
      </div>
      <dl className="fo-legend">
        {parts.map((p) => (
          <div key={p.label}>
            <dt>
              <i className={p.cls} /> {p.label}
            </dt>
            <dd title={usd(p.cents)}>
              {summary ? money(p.cents) : "—"} <small>({pctLabel(pct(p.cents, whole))})</small>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ActivityCard({ summary }: { summary: FundSummary | null }) {
  const [metric, setMetric] = useState<Metric>("paidCents");
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => buckets(summary, 30, 6), [summary]);
  const total = points.reduce((a, p) => a + p[metric], 0);
  const last7 = windowSum(summary, metric, 7, 0);
  const prev7 = windowSum(summary, metric, 7, 7);
  const delta = prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : null;
  const step = niceStep(Math.max(...points.map((p) => p[metric])));
  const top = step * 4;

  return (
    <section className="fo-card" aria-labelledby="fo-activity">
      <div className="fo-head">
        <h2 id="fo-activity">Grant activity</h2>
        <div className="fo-toggle" role="tablist" aria-label="Grant activity shows">
          <button role="tab" aria-selected={metric === "paidCents"} onClick={() => setMetric("paidCents")}>
            Paid
          </button>
          <button role="tab" aria-selected={metric === "approvedCents"} onClick={() => setMetric("approvedCents")}>
            Approved
          </button>
        </div>
      </div>
      <div className="fo-big-row">
        <p className="fo-big" title={usd(total)}>
          {summary ? money(total) : "—"}
        </p>
        {delta != null && (
          <span className={`fo-delta ${delta >= 0 ? "up" : "down"}`}>
            <b>
              {delta >= 0 ? "↑" : "↓"} {delta >= 0 ? "+" : ""}
              {Math.round(delta)}%
            </b>
            <small>vs. previous 7 days</small>
          </span>
        )}
      </div>
      <div className="fo-bars" onPointerLeave={() => setHover(null)}>
        <div className="fo-bars-grid" aria-hidden="true">
          {[4, 3, 2, 1, 0].map((k) => (
            <div key={k}>
              <span>{usdCompact(step * k)}</span>
            </div>
          ))}
        </div>
        <div className="fo-bars-plot" role="list" aria-label={`${metric === "paidCents" ? "Paid" : "Approved"} over the last 30 days`}>
          {points.map((p, i) => (
            <div
              key={p.date}
              role="listitem"
              tabIndex={0}
              className={`fo-bar${i === points.length - 1 ? " last" : ""}${hover === i ? " on" : ""}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${dayLabel(p.date)}: ${usd(p[metric])}`}
            >
              <i style={{ height: p[metric] ? `max(3px, ${(p[metric] / top) * 100}%)` : 0 }} />
              {hover === i && <span className="fo-bar-tip">{money(p[metric])}</span>}
              <span className="fo-bar-x">{dayLabel(p.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InsightsCard({
  grants,
  queue,
  onViewQueue,
  onOpenRequest,
}: {
  grants: Grant[] | null;
  queue: QueueItem[] | null;
  onViewQueue?: () => void;
  onOpenRequest?: (grantId: string) => void;
}) {
  const since = Date.now() - 30 * DAY;
  const decided = (grants ?? []).filter((g) => g.decidedAt && new Date(g.decidedAt).getTime() >= since);
  const approved = decided.filter((g) => g.status === "approved" || g.status === "payment_pending" || g.status === "paid");
  const declined = decided.filter((g) => g.status === "rejected");
  const pending = queue?.length ?? (grants ?? []).filter((g) => g.status === "pending_review").length;
  const reviewMs = decided.length
    ? decided.reduce((a, g) => a + (new Date(g.decidedAt!).getTime() - new Date(g.createdAt).getTime()), 0) / decided.length
    : null;
  const reviewLabel =
    reviewMs == null ? "—" : reviewMs < DAY ? `${Math.max(1, Math.round(reviewMs / 3_600_000))} hrs` : `${(reviewMs / DAY).toFixed(1)} days`;
  const rate = approved.length + declined.length ? Math.round(pct(approved.length, approved.length + declined.length)) : null;
  const statusTotal = approved.length + declined.length + pending;
  const statuses = [
    { label: "Approved", n: approved.length, cls: "a" },
    { label: "Waiting for review", n: pending, cls: "w" },
    { label: "Declined", n: declined.length, cls: "d" },
  ];

  const urgent = [...(queue ?? [])]
    .sort(
      (a, b) =>
        (URGENCY_RANK[a.insight?.urgency ?? ""] ?? 4) - (URGENCY_RANK[b.insight?.urgency ?? ""] ?? 4) ||
        b.daysWaiting - a.daysWaiting ||
        a.rank - b.rank,
    )
    .slice(0, 3);
  const urgentCount = (queue ?? []).filter((q) => q.insight?.urgency === "critical" || q.insight?.urgency === "high").length;

  const stats: { icon: IconName; value: string; label: string; lead?: boolean }[] = [
    { icon: "bill", value: String(pending), label: "Pending review", lead: true },
    { icon: "checkCircle", value: grants ? String(approved.length) : "—", label: "Approved (30d)" },
    { icon: "clock", value: grants ? reviewLabel : "—", label: "Avg. review time" },
    { icon: "checkCircle", value: rate == null ? "—" : `${rate}%`, label: "Approval rate (30d)" },
  ];

  return (
    <section className="fo-card fo-insights" aria-labelledby="fo-insights">
      <div className="fo-head">
        <h2 id="fo-insights">Review insights</h2>
        <button type="button" className="fo-link" onClick={onViewQueue}>
          View queue <Icon name="arrowRight" />
        </button>
      </div>
      <div className="fo-stats">
        {stats.map((s) => (
          <div key={s.label} className={s.lead ? "lead" : undefined}>
            <Icon name={s.icon} />
            <span>
              <strong>{s.value}</strong>
              <small>{s.label}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="fo-split">
        <div>
          <h3>
            Requests by status <small>(30d)</small>
          </h3>
          <div className="fo-stack" aria-hidden="true">
            {statuses.map((s) => (
              <i key={s.label} className={s.cls} style={{ width: `${pct(s.n, statusTotal)}%` }} />
            ))}
          </div>
          <ul className="fo-status">
            {statuses.map((s) => (
              <li key={s.label}>
                <i className={s.cls} />
                <span>{s.label}</span>
                <b>{s.n}</b>
                <small>{statusTotal ? `${Math.round(pct(s.n, statusTotal))}%` : "—"}</small>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>
            Urgent requests {urgentCount > 0 && <span className="fo-count">{urgentCount}</span>}
          </h3>
          {!urgent.length && <p className="fo-sub">{queue ? "Nothing is waiting." : "Loading…"}</p>}
          <ul className="fo-urgent">
            {urgent.map((q) => {
              const u = q.insight?.urgency;
              const tone = u === "critical" ? "red" : u === "high" ? "amber" : "gray";
              const cat = q.grant.bill.category ? CATEGORY_LABEL[q.grant.bill.category] : "Care";
              return (
                <li key={q.grant.id}>
                  <button type="button" onClick={() => onOpenRequest?.(q.grant.id)}>
                    <span className="fo-person">
                      <Icon name="user" />
                    </span>
                    <span className="fo-who">
                      <strong>{shortName(q.grant.patient.displayName)}</strong>
                      <small>
                        {cat} · {cleanName(q.grant.bill.merchant)}
                      </small>
                    </span>
                    <b>{money(q.remainingCents ?? q.grant.requestedCents)}</b>
                    <span className={`fo-chip ${tone}`}>
                      {u === "critical" ? "Critical · " : u === "high" ? "High · " : ""}
                      {q.daysWaiting === 0 ? "today" : `${q.daysWaiting} ${q.daysWaiting === 1 ? "day" : "days"}`}
                    </span>
                    <Icon name="chevronRight" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
