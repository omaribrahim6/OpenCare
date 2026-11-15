"use client";

import { useId, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { shortDate, usd, usdCompact, usdParts } from "@/lib/format";
import type { FundSummary } from "@/lib/types";

const DAY = 86_400_000;
const RANGE_DAYS = { Week: 7, Month: 30, Quarter: 90 };
type Range = keyof typeof RANGE_DAYS;
type ActivityKey = "approvedCents" | "paidCents";
type Point = { date: string; approvedCents: number; paidCents: number };

function pointsFor(summary: FundSummary | null, range: Range): Point[] {
  const end = new Date();
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const days = RANGE_DAYS[range];
  const count = range === "Month" ? 6 : range === "Quarter" ? 9 : 7;
  const dates = new Map(summary?.daily.map((row) => [row.day.slice(0, 10), row]));
  return Array.from({ length: count }, (_, i) => {
    const first = Math.floor(i * days / count);
    const last = Math.floor((i + 1) * days / count);
    const point = {
      date: new Date(endDay - (days - last) * DAY).toISOString().slice(0, 10),
      approvedCents: 0,
      paidCents: 0,
    };
    for (let offset = first; offset < last; offset++) {
      const date = new Date(endDay - (days - 1 - offset) * DAY).toISOString().slice(0, 10);
      const row = dates.get(date);
      point.approvedCents += row?.approvedCents ?? 0;
      point.paidCents += row?.paidCents ?? 0;
    }
    return point;
  });
}

function label(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date));
}

function overviewUsd(cents: number) {
  return Math.abs(cents) >= 100_000_000 ? usdCompact(cents) : usd(cents);
}

function Amount({ cents }: { cents: number | undefined }) {
  if (cents == null) return <span className="v-amount">—</span>;
  if (Math.abs(cents) >= 100_000_000) {
    return <span className="v-amount" title={usd(cents)}>{overviewUsd(cents)}</span>;
  }
  const [dollars, fraction] = usdParts(cents);
  return <span className="v-amount">{dollars}<span>{fraction}</span></span>;
}

function Chart({ points, metric, line = false }: { points: Point[]; metric: ActivityKey; line?: boolean }) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const recent = points.findLastIndex((point) => point[metric] > 0);
  const active = Math.min(hovered ?? (recent < 0 ? points.length - 1 : recent), points.length - 1);
  const peak = Math.max(1, ...points.map((point) => point[metric]));
  const coords = points.map((point, i) => ({
    x: 3 + 394 * i / (points.length - 1),
    y: 166 - (point[metric] / peak) * 118,
  }));
  const path = coords.slice(1).reduce((result, point, i) => {
    const previous = coords[i];
    const middle = (previous.x + point.x) / 2;
    return result + ` C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${coords[0].x} ${coords[0].y}`);

  return (
    <div className={`v-chart${line ? " v-chart-line" : ""}`} onPointerLeave={() => setHovered(null)}>
      <div className="v-chart-plot">
        {line && (
          <svg viewBox="0 0 400 174" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9181f8" stopOpacity=".30" />
                <stop offset="100%" stopColor="#9181f8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${path} L 397 174 L 3 174 Z`} fill={`url(#${gradientId})`} />
            <line x1={coords[active].x} x2={coords[active].x} y1={coords[active].y} y2="174" stroke="#d8d1f5" strokeDasharray="3 3" />
            <path d={path} fill="none" stroke="#7e6be6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <circle cx={coords[active].x} cy={coords[active].y} r="3.5" fill="white" stroke="#7e6be6" />
          </svg>
        )}
        <div className="v-chart-targets">
          {points.map((point, i) => (
            <button
              type="button"
              key={point.date}
              className={i === active ? "is-active" : ""}
              aria-label={`Through ${label(point.date)}: ${usd(point[metric])}`}
              onPointerEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              onClick={() => setHovered(i)}
            >
              {!line && <span style={{ height: `${Math.max(3, point[metric] / peak * 82)}%` }} />}
            </button>
          ))}
        </div>
        {(line || hovered !== null) && (
          <div className="v-chart-tip" style={{ left: `${Math.min(89, Math.max(11, 100 * active / (points.length - 1)))}%` }} aria-hidden="true">
            <small>{label(points[active].date)}</small>
            <strong title={usd(points[active][metric])}>{overviewUsd(points[active][metric])}</strong>
          </div>
        )}
      </div>
      <div className="v-chart-labels" aria-hidden="true">
        {points.map((point, i) => <span className={active === i ? "is-active" : ""} key={point.date}>{label(point.date)}</span>)}
      </div>
    </div>
  );
}

function Allocation({ summary }: { summary: FundSummary | null }) {
  const sections = [
    { label: "Available", cents: summary?.availableCents ?? 0, color: "#8270e5" },
    { label: "Reserved", cents: summary?.reservedCents ?? 0, color: "#bcb0ef" },
    { label: "Paid out", cents: summary?.paidCents ?? 0, color: "#dcd6ed" },
  ];
  const total = sections.reduce((sum, part) => sum + part.cents, 0);
  const thresholds = [sections[0].cents, sections[0].cents + sections[1].cents];
  return (
    <section className="g-card v-allocation">
      <h2 className="g-title">Fund allocation</h2>
      <div className="v-gauge">
        <svg viewBox="0 0 400 196" aria-hidden="true">
          {Array.from({ length: 94 }, (_, i) => {
            const share = (i + .5) / 94;
            const angle = Math.PI * (1.055 - share * 1.11);
            const value = share * total;
            const color = !total ? "#e6e3ed" : sections[value < thresholds[0] ? 0 : value < thresholds[1] ? 1 : 2].color;
            const x = (r: number) => (200 + Math.cos(angle) * r).toFixed(2);
            const y = (r: number) => (175 - Math.sin(angle) * r).toFixed(2);
            return <line key={i} x1={x(149)} y1={y(149)} x2={x(167)} y2={y(167)} stroke={color} strokeWidth="3.4" />;
          })}
        </svg>
        <div className="v-gauge-value"><Amount cents={summary?.totalCents} /><span>Total contributed</span></div>
      </div>
      <dl className="v-allocation-key">
        {sections.map((part) => (
          <div key={part.label} style={{ borderColor: part.color }}>
            <dt>{part.label}</dt><dd title={summary ? usd(part.cents) : undefined}>{summary ? overviewUsd(part.cents) : "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const EVENTS: Record<string, { label: string; icon: IconName }> = {
  donation: { label: "Donation", icon: "heart" },
  payout: { label: "Provider paid", icon: "store" },
  reservation: { label: "Grant reserved", icon: "lock" },
  release: { label: "Funds released", icon: "wallet" },
  receipt: { label: "Devnet receipt", icon: "receipt" },
};

export function VioletOverview({
  summary,
  showLedger,
  showRules,
  showDonation,
}: {
  summary: FundSummary | null;
  showLedger: () => void;
  showRules: () => void;
  showDonation: () => void;
}) {
  const [range, setRange] = useState<Range>("Month");
  const [metric, setMetric] = useState<ActivityKey>("paidCents");
  const points = pointsFor(summary, range);
  const periodTotal = points.reduce((sum, point) => sum + point[metric], 0);

  return (
    <div className="v-grid">
      <div className="v-primary">
        <section className="g-card v-balance">
          <div className="g-head">
            <h2 className="g-title">Available balance</h2>
            <select aria-label="Chart period" className="v-select" value={range} onChange={(e) => setRange(e.target.value as Range)}>
              {Object.keys(RANGE_DAYS).map((period) => <option key={period}>{period}</option>)}
            </select>
          </div>
          <Amount cents={summary?.availableCents} />
          <p className="v-caption">Provider payouts over time</p>
          <Chart points={points} metric="paidCents" line />
        </section>
        <Allocation summary={summary} />
      </div>

      <aside className="g-card v-fund-card" aria-label="Community fund activity">
        <div className="g-head">
          <h2 className="g-title">Community fund</h2>
          <button className="v-quiet" onClick={showDonation}><Icon name="plus" /> Donate</button>
        </div>
        <div className="v-care-card" aria-label="Available to grant">
          <span className="v-card-chip"><Icon name="tap" /></span>
          <div><strong>OpenCare</strong><span>Community care fund</span></div>
          <Icon className="v-card-heart" name="heart" />
        </div>
        <div className="v-fund-stat">
          <span className="v-stat-icon"><Icon name="wallet" /></span>
          <div><small>Available to grant</small><strong title={summary ? usd(summary.availableCents) : undefined}>{summary ? overviewUsd(summary.availableCents) : "—"}</strong></div>
          <button className="v-quiet v-icon-button" aria-label="Open ledger" onClick={showLedger}><Icon name="chevronRight" /></button>
        </div>
        <div className="v-activity">
          <div className="g-head"><h2 className="g-title">Recent activity</h2><button className="v-link" onClick={showLedger}>See all</button></div>
          {!summary?.recent.length && <p className="v-caption">{summary ? "No fund activity yet." : "Loading activity…"}</p>}
          <ul>
            {summary?.recent.slice(0, 4).map((event, index) => {
              const detail = EVENTS[event.type];
              return (
                <li key={`${event.reference}-${event.type}-${event.at}-${index}`}>
                  <span className={`v-event-icon v-event-${event.type}`}><Icon name={detail.icon} /></span>
                  <div><strong>{detail.label}</strong><small>{shortDate(event.at)}</small></div>
                  <span className="v-event-amount">{event.amountCents ? usd(event.amountCents) : "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <div className="v-secondary">
        <section className="g-card v-flow">
          <div className="g-head">
            <h2 className="g-title">Grant activity</h2>
            <div className="v-switch" aria-label="Grant activity metric">
              <button aria-pressed={metric === "paidCents"} onClick={() => setMetric("paidCents")}>Paid</button>
              <button aria-pressed={metric === "approvedCents"} onClick={() => setMetric("approvedCents")}>Approved</button>
            </div>
          </div>
          <Amount cents={summary ? periodTotal : undefined} />
          <Chart points={points} metric={metric} />
        </section>
        <section className="g-card v-insights">
          <div className="g-head"><h2 className="g-title">Review insights</h2><button className="v-quiet" onClick={showRules}>Fund rules</button></div>
          <div className="v-insight-number">{summary?.paidCount ?? "—"} <span>grants paid</span></div>
          <p className="v-caption">Caseworkers decide which requests to fund after reviewing the bill and need score.</p>
          <div aria-hidden="true" className="v-orbits"><span /><span /><span /><i /><i /><i /></div>
        </section>
      </div>
    </div>
  );
}
