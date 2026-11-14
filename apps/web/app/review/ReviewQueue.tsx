"use client";

import { Fragment, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCents } from "@/lib/mock";
import type { GrantDecisionRequest } from "@abdulcare/contracts";
import { decideGrant } from "@/lib/api";
import type { Grant, NeedFactor, QueueItem } from "@/lib/types";
import { CATEGORY_LABEL, INSURANCE_LABEL, SECOND_APPROVAL_ABOVE_CENTS, SUSPICIOUS_FIELD_LABEL } from "@/lib/types";


function topFactors(factors: NeedFactor[]): NeedFactor[] {
  return [...factors]
    .filter((f) => f.maxPoints > 0)
    .sort((a, b) => b.points / b.maxPoints - a.points / a.maxPoints || b.points - a.points)
    .slice(0, 2);
}

/** Text for the disagreement marker; the server sets disagreesWithFormula (2+ positions, SPEC §7). */
function disagreement(it: QueueItem): string | null {
  if (!it.disagreesWithFormula) return null;
  const diff = it.formulaRank - it.rank;
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
  const [openId, setOpenId] = useState<string | null>(items[0]?.grant.id ?? null);
  // Grants as returned by the decision route, so the list reflects what the server recorded.
  const [decided, setDecided] = useState<Record<string, Grant>>({});
  const grantOf = (it: QueueItem) => decided[it.grant.id] ?? it.grant;
  const open = items.find((i) => i.grant.id === openId) ?? null;

  // Budget reach (P1): the first request that no longer fits if everything above it were approved in full.
  let running = 0;
  const budgetEndsBefore = items.find((it) => (running += it.grant.requestedCents) > availableCents)?.grant.id ?? null;

  return (
    <div className="queue">
      <ol className="stack queue-list" aria-label="Pending requests in recommended order">
        {items.map((it) => {
          const g = grantOf(it);
          const status = g.status;
          const selected = it.grant.id === openId;
          const differs = order === "gemini" ? disagreement(it) : null;
          return (
            <Fragment key={it.grant.id}>
              {it.grant.id === budgetEndsBefore && (
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
                    setOpenId(it.grant.id);
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
                      <strong>{formatCents(it.grant.requestedCents)}</strong>
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
                      {it.suspiciousContent && <span className="badge bad">Suspicious content</span>}
                      {g.awaitingSecondApproval && status === "pending_review" && (
                        <span className="badge info">1 of 2 approvals</span>
                      )}
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
          key={open.grant.id}
          item={open}
          order={order}
          grant={grantOf(open)}
          onDecided={(g) => setDecided((d) => ({ ...d, [g.id]: g }))}
        />
      )}
    </div>
  );
}

function Detail({
  item,
  order,
  grant,
  onDecided,
}: {
  item: QueueItem;
  order: "gemini" | "formula";
  grant: Grant;
  onDecided: (g: Grant) => void;
}) {
  // Nessie settles whole dollars only, so approvals are whole dollars (rounded down from the request).
  // A request waiting for a second approval must be approved for the same amount as the first.
  const firstApproval = grant.approvals[0]?.approvedCents;
  const [amount, setAmount] = useState(
    String(Math.floor((grant.awaitingSecondApproval && firstApproval ? firstApproval : grant.requestedCents) / 100)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = grant.status;
  const a = item.assessment;
  const decided = status !== "pending_review";
  const dollars = Number(amount);
  const amountValid = /^\d+$/.test(amount.trim()) && dollars >= 1;
  const amountCents = dollars * 100;
  const needsSecond = amountValid && amountCents > SECOND_APPROVAL_ABOVE_CENTS;
  const differs = order === "gemini" ? disagreement(item) : null;

  async function decide(req: GrantDecisionRequest) {
    setBusy(true);
    setError(null);
    try {
      onDecided((await decideGrant(grant.id, req)).grant);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision wasn't saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card queue-detail" aria-labelledby="detail-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="detail-title" style={{ margin: 0 }}>
          #{item.rank} · {item.grant.patient.displayName}
        </h2>
        <StatusBadge status={status} />
      </div>

      {item.suspiciousContent && (
        <div className="injection-warning" role="alert">
          <strong>Suspicious content in the {SUSPICIOUS_FIELD_LABEL[item.suspiciousContent.field]}</strong>
          <p style={{ margin: "6px 0" }}>
            It looks like instructions aimed at this system. It was ignored: the score, rank and payout are unchanged.
            Treat this request with extra care.
          </p>
          <blockquote>{item.suspiciousContent.excerpt}</blockquote>
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
      <p>{item.rationale}</p>

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
                {f.key === "income" && a.incomeSource === "deposits" && (
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
          <tr><th scope="row">Household</th><td>{item.profile.householdSize ?? "Unknown"}</td></tr>
          <tr>
            <th scope="row">Monthly income</th>
            <td>
              {formatCents(item.profile.monthlyIncomeCents)}
              {a.incomeMismatch && (
                <>
                  <br />
                  <small className="muted">
                    Deposits suggest {formatCents(a.incomeMismatch.depositCents)}/month (over 25% different). The score
                    uses the profile.
                  </small>
                </>
              )}
            </td>
          </tr>
          <tr><th scope="row">Insurance</th><td>{item.profile.insurance ? INSURANCE_LABEL[item.profile.insurance] : "Unknown"}</td></tr>
        </tbody>
      </table>

      <h3>Bill (from Nessie)</h3>
      <table>
        <tbody>
          <tr><th scope="row">Merchant</th><td>{item.grant.bill.merchant}</td></tr>
          <tr><th scope="row">Description</th><td className="untrusted">{item.grant.bill.description ?? "None"}</td></tr>
          <tr><th scope="row">Category</th><td>{item.grant.bill.category ? CATEGORY_LABEL[item.grant.bill.category] : "Unknown"}</td></tr>
          <tr><th scope="row">Date</th><td>{item.grant.bill.date ?? "Unknown"}</td></tr>
          <tr><th scope="row">Amount</th><td>{formatCents(item.grant.requestedCents)}</td></tr>
        </tbody>
      </table>

      {item.grant.hardshipNote && (
        <>
          <h3>Hardship note</h3>
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            Written by the patient. Untrusted text; never scored or ranked.
          </p>
          <blockquote className="untrusted">{item.grant.hardshipNote}</blockquote>
        </>
      )}

      <h3>Decision</h3>
      <p>
        Recipient: <strong>{item.grant.provider.name}</strong> <small className="muted">(allowlisted provider)</small>
      </p>
      <label htmlFor="amt">Approved amount (whole US dollars)</label>
      <input
        id="amt"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={decided}
        aria-invalid={!amountValid}
        aria-describedby="amt-help"
      />
      <small id="amt-help" className="muted">
        Whole dollars only; the bank settles in dollars.
        {item.grant.requestedCents % 100 !== 0 &&
          ` The request was ${formatCents(item.grant.requestedCents)}, rounded down here.`}
      </small>
      {needsSecond && !decided && (
        <p className="muted" style={{ marginTop: 8 }}>
          Over {formatCents(SECOND_APPROVAL_ABOVE_CENTS)}: a second caseworker must also approve before it can be paid.
        </p>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btn"
          disabled={decided || busy || !amountValid}
          onClick={() => decide({ decision: "approve", approvedCents: amountCents })}
        >
          {busy ? "Saving…" : amountValid ? `Approve ${formatCents(amountCents)}` : "Approve"}
        </button>
        <button className="btn danger" disabled={decided || busy} onClick={() => decide({ decision: "reject" })}>
          Reject
        </button>
      </div>
      {error && (
        <p role="alert" className="badge bad" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      {grant.awaitingSecondApproval && !decided && (
        <p role="status" style={{ marginTop: 12 }}>
          One approval recorded{firstApproval ? ` for ${formatCents(firstApproval)}` : ""}. A second caseworker device
          must approve the same amount before it can be paid.
        </p>
      )}
      {decided && (
        <p role="status" style={{ marginTop: 12 }}>
          {status === "approved"
            ? `Approved for ${formatCents(grant.approvedCents)}. The amount and recipient are now fixed.`
            : status === "rejected"
              ? "Rejected."
              : "Decision recorded."}
        </p>
      )}
    </section>
  );
}
