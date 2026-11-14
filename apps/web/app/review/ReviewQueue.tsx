"use client";

import { Fragment, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/mock";
import type { GrantStatus, NeedFactor, QueueItem } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/types";

/** Grants above this need a second caseworker's approval (SPEC rev 5, P1). */
const SECOND_APPROVAL_CENTS = 50000;
/** Gemini placing a request this many positions from the formula order is flagged (SPEC §7). */
const DISAGREEMENT_POSITIONS = 2;

function topFactors(factors: NeedFactor[]): NeedFactor[] {
  return [...factors]
    .filter((f) => f.maxPoints > 0)
    .sort((a, b) => b.points / b.maxPoints - a.points / a.maxPoints || b.points - a.points)
    .slice(0, 2);
}

function disagreement(it: QueueItem): string | null {
  const diff = it.formulaRank - it.rank;
  if (Math.abs(diff) < DISAGREEMENT_POSITIONS) return null;
  return diff > 0 ? `Gemini ranked ${diff} higher than formula` : `Gemini ranked ${-diff} lower than formula`;
}

export function ReviewQueue({
  items,
  order,
  availableCents,
}: {
  items: QueueItem[];
  order: "gemini" | "formula";
  availableCents: number;
}) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.grantId ?? null);
  const [decisions, setDecisions] = useState<Record<string, GrantStatus>>({});
  const open = items.find((i) => i.grantId === openId) ?? null;

  // Budget reach (P1): the first request that no longer fits if everything above it were approved in full.
  let running = 0;
  const budgetEndsBefore = items.find((it) => (running += it.requestedCents) > availableCents)?.grantId ?? null;

  return (
    <div className="queue">
      <ol className="stack queue-list" aria-label="Pending requests in recommended order">
        {items.map((it) => {
          const status = decisions[it.grantId] ?? "pending_review";
          const selected = it.grantId === openId;
          const differs = order === "gemini" ? disagreement(it) : null;
          return (
            <Fragment key={it.grantId}>
              {it.grantId === budgetEndsBefore && (
                <li className="budget-line" role="separator">
                  Available budget runs out here if every request above is approved in full
                </li>
              )}
              <li>
                <button
                  type="button"
                  className={`queue-row${selected ? " selected" : ""}`}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => {
                    setOpenId(it.grantId);
                    // Stacked layout on phones: bring the detail panel into view.
                    if (window.matchMedia("(max-width: 899px)").matches) {
                      requestAnimationFrame(() =>
                        document.getElementById("detail-title")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                      );
                    }
                  }}
                >
                  <span className="queue-rank" aria-label={`Rank ${it.rank}`}>
                    #{it.rank}
                  </span>
                  <span className="queue-main">
                    <span className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                      <strong>{formatCents(it.requestedCents)}</strong>
                      <span className="score" aria-label={`Formula need score ${it.assessment.score} out of 100`}>
                        {it.assessment.score}
                        <small>/100</small>
                      </span>
                    </span>
                    <span className="muted">
                      {it.assessment.incomePctOfPoverty != null
                        ? `${it.assessment.incomePctOfPoverty}% of poverty line`
                        : "Income unknown"}{" "}
                      · {it.daysWaiting} day{it.daysWaiting === 1 ? "" : "s"} waiting
                    </span>
                    <span className="muted">Top: {topFactors(it.assessment.factors).map((f) => f.label).join(", ")}</span>
                    {order === "gemini" && <span className="muted">Formula rank #{it.formulaRank}</span>}
                    <span className="row" style={{ gap: 6 }}>
                      {differs && <span className="badge warn">{differs}</span>}
                      {it.assessment.suspiciousContent && <span className="badge bad">Suspicious content</span>}
                      {status !== "pending_review" && <StatusBadge status={status} />}
                    </span>
                  </span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>

      {open && (
        <Detail
          key={open.grantId}
          item={open}
          order={order}
          status={decisions[open.grantId] ?? "pending_review"}
          onDecide={(s) => setDecisions((d) => ({ ...d, [open.grantId]: s }))}
        />
      )}
    </div>
  );
}

function Detail({
  item,
  order,
  status,
  onDecide,
}: {
  item: QueueItem;
  order: "gemini" | "formula";
  status: GrantStatus;
  onDecide: (s: GrantStatus) => void;
}) {
  const [amount, setAmount] = useState((item.requestedCents / 100).toFixed(2));
  const a = item.assessment;
  const decided = status !== "pending_review";
  const amountCents = Math.round(Number(amount) * 100);
  const needsSecond = Number.isFinite(amountCents) && amountCents > SECOND_APPROVAL_CENTS;
  const differs = order === "gemini" ? disagreement(item) : null;

  return (
    <section className="card queue-detail" aria-labelledby="detail-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="detail-title" style={{ margin: 0 }}>
          #{item.rank} · {item.patient.displayName}
        </h2>
        <StatusBadge status={status} />
      </div>

      {a.suspiciousContent && (
        <div className="injection-warning" role="alert">
          <strong>Suspicious content in the {a.suspiciousContent.field}</strong>
          <p style={{ margin: "6px 0" }}>
            It looks like instructions aimed at this system. It was ignored: the score, rank and payout are unchanged.
            Treat this request with extra care.
          </p>
          <blockquote>{a.suspiciousContent.excerpt}</blockquote>
        </div>
      )}

      <div className="row" style={{ gap: 32, margin: "16px 0 4px" }}>
        <div>
          <div className="muted">Formula need score</div>
          <p className="big" style={{ margin: 0 }}>
            {a.score}
            <small className="muted" style={{ fontSize: "1rem", fontWeight: 400 }}>
              {" "}
              / 100
            </small>
          </p>
        </div>
        <div>
          <div className="muted">{order === "gemini" ? "Gemini rank / formula rank" : "Formula rank"}</div>
          <p className="big" style={{ margin: 0 }}>
            #{item.rank}
            {order === "gemini" && (
              <small className="muted" style={{ fontSize: "1rem", fontWeight: 400 }}>
                {" "}
                / #{item.formulaRank}
              </small>
            )}
          </p>
        </div>
      </div>
      {differs && <p className="badge warn">{differs}</p>}
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Formula {a.formulaVersion}. A triage aid, not an eligibility decision or a probability.
      </p>

      <h3>{order === "gemini" ? "Why Gemini ranked it here" : "Why it ranks here"}</h3>
      <p>{a.rationale}</p>

      <h3>Factor breakdown</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Factor</th>
            <th scope="col">Input</th>
            <th scope="col" style={{ textAlign: "right" }}>
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {a.factors.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td>
                {f.input}
                {f.unknown && <span className="badge info" style={{ marginLeft: 6 }}>Unknown</span>}
                {f.key === "income" && a.incomeEstimatedFromDeposits && (
                  <>
                    <br />
                    <small className="muted">Estimated from deposits</small>
                  </>
                )}
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {f.points}
                <small className="muted"> / {f.maxPoints < 0 ? `up to ${f.maxPoints}` : f.maxPoints}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Profile (set at enrollment)</h3>
      <table>
        <tbody>
          <tr><th scope="row">Household</th><td>{item.profile.householdSize}</td></tr>
          <tr><th scope="row">Monthly income</th><td>{formatCents(item.profile.monthlyIncomeCents)}</td></tr>
          <tr><th scope="row">Insurance</th><td style={{ textTransform: "capitalize" }}>{item.profile.insurance}</td></tr>
        </tbody>
      </table>

      <h3>Bill (from Nessie)</h3>
      <table>
        <tbody>
          <tr><th scope="row">Merchant</th><td>{item.bill.merchant}</td></tr>
          <tr><th scope="row">Description</th><td className="untrusted">{item.bill.description}</td></tr>
          <tr><th scope="row">Category</th><td>{CATEGORY_LABEL[item.bill.category]}</td></tr>
          <tr><th scope="row">Date</th><td>{item.bill.date ?? "Unknown"}</td></tr>
          <tr><th scope="row">Amount</th><td>{formatCents(item.requestedCents)}</td></tr>
        </tbody>
      </table>

      {item.hardshipNote && (
        <>
          <h3>Hardship note</h3>
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            Written by the patient. Untrusted text; never scored or ranked.
          </p>
          <blockquote className="untrusted">{item.hardshipNote}</blockquote>
        </>
      )}

      <h3>Decision</h3>
      <p>
        Recipient: <strong>{item.provider.name}</strong> <small className="muted">(allowlisted provider)</small>
      </p>
      <label htmlFor="amt">Approved amount (USD)</label>
      <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={decided} />
      {needsSecond && !decided && (
        <p className="muted" style={{ marginTop: 8 }}>
          Over {formatCents(SECOND_APPROVAL_CENTS)}: a second caseworker must also approve before it can be paid.
        </p>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={decided} onClick={() => onDecide("approved")}>
          Approve ${amount}
        </button>
        <button className="btn danger" disabled={decided} onClick={() => onDecide("rejected")}>
          Reject
        </button>
      </div>
      {decided && (
        <p role="status" style={{ marginTop: 12 }}>
          {status === "approved" && needsSecond
            ? "Approval recorded (mock). Waiting for a second caseworker before payment."
            : "Decision recorded (mock). The amount and recipient are now fixed."}
        </p>
      )}
    </section>
  );
}
