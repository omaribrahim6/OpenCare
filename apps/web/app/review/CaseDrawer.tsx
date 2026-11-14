"use client";

import { useEffect, useRef, useState } from "react";
import type { GrantDecisionRequest } from "@abdulcare/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { decideGrant } from "@/lib/api";
import { cleanName, shortDate, usd } from "@/lib/format";
import type { Grant, QueueItem } from "@/lib/types";
import { CATEGORY_LABEL, INSURANCE_LABEL, SECOND_APPROVAL_ABOVE_CENTS, SUSPICIOUS_FIELD_LABEL } from "@/lib/types";

/** One request in full: why it ranks where it does, the patient's profile, the bill, and the decision. */
export function CaseDrawer({
  item,
  source,
  onClose,
  onDecided,
}: {
  item: QueueItem;
  source: "gemini" | "formula";
  onClose: () => void;
  onDecided: (g: Grant) => void;
}) {
  const [grant, setGrant] = useState<Grant>(item.grant);
  // Nessie settles whole dollars only. A second approval must match the first amount.
  const firstApproval = grant.approvals[0]?.approvedCents;
  const [amount, setAmount] = useState(
    String(Math.floor((grant.awaitingSecondApproval && firstApproval ? firstApproval : grant.requestedCents) / 100)),
  );
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const a = item.assessment;
  const g = grant;
  const pending = g.status === "pending_review";
  const cents = Number(amount || 0) * 100;
  const amountValid = /^\d+$/.test(amount) && cents >= 100 && cents <= g.requestedCents;
  const needsSecond = amountValid && cents > SECOND_APPROVAL_ABOVE_CENTS && !g.awaitingSecondApproval;
  const name = cleanName(g.patient.displayName);
  const topKey = [...a.factors].filter((f) => f.maxPoints > 0).sort((x, y) => y.points - x.points)[0]?.key;

  async function decide(req: GrantDecisionRequest) {
    setBusy(true);
    setError(null);
    try {
      const next = (await decideGrant(g.id, req)).grant;
      setGrant(next);
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
    <>
      <div className="d-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="d-drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title">
        <header className="dr-head">
          <h2 id="dr-title">
            #{item.rank} · {name}
          </h2>
          {item.suspiciousContent && <span className="d-pill dot red">Flagged</span>}
          <button ref={closeRef} className="d-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

        <div className="dr-body">
          {item.suspiciousContent && (
            <div className="dr-alert" role="alert">
              <strong>
                <Icon name="alert" /> Suspicious text in the {SUSPICIOUS_FIELD_LABEL[item.suspiciousContent.field]}
              </strong>
              <p>
                It reads like instructions aimed at this system. It was ignored: the score, the rank and the payout are
                unchanged.
              </p>
              <blockquote>{item.suspiciousContent.excerpt}</blockquote>
            </div>
          )}

          <div className="dr-trio">
            <div>
              <small>Need score</small>
              <strong>
                {a.score} <span>/ 100</span>
              </strong>
            </div>
            <div>
              <small>{source === "gemini" ? "Gemini rank" : "Formula rank"}</small>
              <strong>
                #{item.rank} {source === "gemini" && <span>formula #{item.formulaRank}</span>}
              </strong>
            </div>
            <div>
              <small>Requested</small>
              <strong>{usd(g.requestedCents)}</strong>
            </div>
          </div>

          <section className="dr-sec">
            <h3>{source === "gemini" ? "Why Gemini ranked it here" : "Why it ranks here"}</h3>
            <p className="dr-why">{item.rationale}</p>
            {source === "gemini" && item.disagreesWithFormula && (
              <p className="dr-hint" style={{ marginTop: 8 }}>
                Gemini placed this {Math.abs(item.formulaRank - item.rank)} positions {item.formulaRank > item.rank ? "higher" : "lower"} than
                the formula would.
              </p>
            )}
          </section>

          <section className="dr-sec">
            <h3>Score breakdown · formula {a.formulaVersion}</h3>
            <div className="dr-factors">
              {a.factors.map((f) => {
                const neg = f.maxPoints < 0;
                const share = neg ? Math.abs(f.points / f.maxPoints) : f.maxPoints ? f.points / f.maxPoints : 0;
                return (
                  <div key={f.key} className={`dr-factor${f.key === topKey ? " top" : ""}${neg ? " neg" : ""}`}>
                    <span>
                      <strong>{f.label}</strong>
                      <small>
                        {f.unknown ? "Unknown, scored at the midpoint" : f.input}
                        {f.key === "income" && a.incomeSource === "deposits" ? " · estimated from deposits" : ""}
                      </small>
                    </span>
                    <em>
                      {f.points} <span>/ {f.maxPoints}</span>
                    </em>
                    <i>
                      <b style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
                    </i>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="dr-sec">
            <h3>Profile on file</h3>
            <dl className="dr-kv">
              <div>
                <dt>Household</dt>
                <dd>{item.profile.householdSize ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Monthly income</dt>
                <dd>
                  {item.profile.monthlyIncomeCents == null ? "Unknown" : usd(item.profile.monthlyIncomeCents)}
                  {a.incomeMismatch && (
                    <small>
                      Deposits suggest {usd(a.incomeMismatch.depositCents)} a month, over 25% different. The score uses
                      the profile.
                    </small>
                  )}
                </dd>
              </div>
              <div>
                <dt>Insurance</dt>
                <dd>{item.profile.insurance ? INSURANCE_LABEL[item.profile.insurance] : "Unknown"}</dd>
              </div>
            </dl>
          </section>

          <section className="dr-sec">
            <h3>Bill from the bank record</h3>
            <dl className="dr-kv">
              <div>
                <dt>Billed by</dt>
                <dd>{g.bill.merchant}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd className="dr-untrusted">{g.bill.description ?? "None"}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{g.bill.category ? CATEGORY_LABEL[g.bill.category] : "Unknown"}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{shortDate(g.bill.date)}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{usd(g.bill.amountCents)}</dd>
              </div>
            </dl>
          </section>

          {g.hardshipNote && (
            <section className="dr-sec">
              <h3>Note from the patient · never scored</h3>
              <blockquote className="dr-quote">{g.hardshipNote}</blockquote>
            </section>
          )}
        </div>

        <footer className="dr-foot">
          {pending ? (
            <>
              <div className="dr-pay">
                <div style={{ minWidth: 0 }}>
                  <small>Pay to</small>
                  <strong title={g.provider.name}>
                    <Icon name="store" />
                    {g.provider.name}
                  </strong>
                </div>
                <label>
                  <small>Amount, whole dollars</small>
                  <span className="dr-amount">
                    <span>$</span>
                    <input
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      aria-invalid={!amountValid}
                      disabled={busy || g.awaitingSecondApproval}
                    />
                  </span>
                </label>
              </div>
              {g.awaitingSecondApproval ? (
                <p className="dr-hint">
                  One caseworker approved {usd(firstApproval ?? 0)}. A second caseworker device must approve the same
                  amount.
                </p>
              ) : needsSecond ? (
                <p className="dr-hint">Over {usd(SECOND_APPROVAL_ABOVE_CENTS)}: a second caseworker must also approve before it can be paid.</p>
              ) : !amountValid ? (
                <p className="dr-hint" style={{ color: "#c2412f" }}>
                  Enter whole dollars from $1 up to the {usd(g.requestedCents)} requested.
                </p>
              ) : null}
              {error && (
                <p className="dr-hint" role="alert" style={{ color: "#c2412f" }}>
                  {error}
                </p>
              )}
              <div className="dr-actions">
                <button className="d-btn d-btn-lg d-btn-danger" onClick={() => setConfirm("reject")} disabled={busy}>
                  Decline
                </button>
                <button className="d-btn d-btn-lg d-btn-teal" onClick={() => setConfirm("approve")} disabled={busy || !amountValid}>
                  Approve {amountValid ? usd(cents) : ""}
                </button>
              </div>
            </>
          ) : g.status === "rejected" ? (
            <div className="dr-result no" role="status">
              <Icon name="xCircle" /> Declined
            </div>
          ) : (
            <div className="dr-result ok" role="status">
              <Icon name="checkCircle" /> Approved for {usd(g.approvedCents)}. The amount and recipient are now fixed.
            </div>
          )}
        </footer>
      </aside>

      <ConfirmDialog
        open={confirm === "approve"}
        title={`Approve ${usd(cents)}?`}
        confirmLabel={`Approve ${usd(cents)}`}
        confirmClass="d-btn d-btn-teal"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => decide({ decision: "approve", approvedCents: cents })}
      >
        <p style={{ color: "#5c5f5e" }}>
          {needsSecond
            ? `This records your approval for ${name}. Nothing is reserved until a second caseworker approves the same amount.`
            : `This reserves ${usd(cents)} from the fund for ${name}, payable only to ${g.provider.name}. The amount and recipient can't be changed afterward.`}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "reject"}
        title="Decline this request?"
        confirmLabel="Decline"
        confirmClass="d-btn d-btn-danger"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => decide({ decision: "reject" })}
      >
        <p style={{ color: "#5c5f5e" }}>{name} will see that the request wasn&apos;t approved. No money is reserved.</p>
      </ConfirmDialog>
    </>
  );
}
