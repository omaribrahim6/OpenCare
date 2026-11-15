"use client";

import { useEffect, useRef, useState } from "react";
import type { GrantDecisionRequest } from "@abdulcare/contracts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Icon } from "@/components/Icon";
import { InsightSection } from "@/components/site/LedgerCaseDrawer";
import { decideGrant } from "@/lib/api";
import { cleanName, shortDate, stepLabel, usd } from "@/lib/format";
import type { Grant, QueueItem } from "@/lib/types";
import { CATEGORY_LABEL, INSURANCE_LABEL, SUSPICIOUS_FIELD_LABEL } from "@/lib/types";
import { BankCheck, RefundToFund } from "./LinkedRailsPanel";

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
  // Approvals take exact cents (the payout moves the whole-dollar part; records keep the cents).
  // A grant left half-approved under the old two-approval rule keeps its first amount.
  const firstApproval = grant.approvals[0]?.approvedCents;
  const startCents =
    grant.awaitingSecondApproval && firstApproval
      ? firstApproval
      : (item.brief?.suggestedCents ?? item.remainingCents ?? grant.requestedCents);
  const [amount, setAmount] = useState(startCents % 100 === 0 ? String(startCents / 100) : (startCents / 100).toFixed(2));
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
  const cents = Math.round(Number(amount || 0) * 100);
  // Revision 6: approval pays at most the visit's remaining balance (the request amount for older grants).
  const maxCents = item.remainingCents ?? g.requestedCents;
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount) && cents >= 100 && cents <= maxCents;
  const brief = item.brief;
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

          {item.insight && <InsightSection insight={item.insight} />}

          {brief && (
            <section className="dr-sec dr-brief" aria-labelledby="brief-title">
              <h3 id="brief-title">
                Decision brief ·{" "}
                {brief.source === "gemini" ? "written by Gemini, numbers checked" : "standard template"}
              </h3>
              <ol className="dr-path">
                {brief.path.map((s, i) => (
                  <li key={`${s.label}-${i}`}>
                    <span>
                      {stepLabel(s.label)}
                      
                    </span>
                    <strong>{usd(s.balanceCents)}</strong>
                  </li>
                ))}
              </ol>
              {brief.reasons.map((r) => (
                <p key={r} className="dr-why">
                  {r}
                </p>
              ))}
              {brief.flags.length > 0 && (
                <ul className="dr-flags">
                  {brief.flags.map((f) => (
                    <li key={f.detail}>
                      <Icon name="alert" /> {f.detail}
                    </li>
                  ))}
                </ul>
              )}
              <p className="dr-suggest">
                <Icon name="sparkles" />
                <span>
                  Suggested: approve the full remaining balance of <strong>{usd(brief.suggestedCents)}</strong>.
                </span>
              </p>
              <p className="dr-hint">The brief is advice. It can&apos;t change the score, the order or the amount; you decide.</p>
            </section>
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
              <small>Remaining</small>
              <strong>{usd(maxCents)}</strong>
            </div>
          </div>

          <section className="dr-sec">
            <h3>{source === "gemini" ? "Why Gemini ranked it here" : "Why it ranks here"}</h3>
            <p className="dr-why">
              {brief ? `#${item.rank} of the waiting requests by the published need formula (score ${a.score}).` : item.rationale}
            </p>
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

          {grant.visit && <BankCheck grantId={grant.id} />}

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
            <h3>{g.visit ? "Hospital visit" : "Bill from the bank record"}</h3>
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
                  <small>Amount</small>
                  <span className="dr-amount">
                    <span>$</span>
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => {
                        // Digits and one decimal point with up to two places.
                        const v = e.target.value.replace(/[^\d.]/g, "");
                        const [whole, frac] = v.split(".");
                        setAmount((frac === undefined ? whole : `${whole}.${frac.slice(0, 2)}`).slice(0, 10));
                      }}
                      aria-invalid={!amountValid}
                      disabled={busy || g.awaitingSecondApproval}
                    />
                  </span>
                </label>
              </div>
              {g.awaitingSecondApproval ? (
                <p className="dr-hint">
                  A caseworker already approved {usd(firstApproval ?? 0)} under the old two-approval rule. Approve to
                  complete it.
                </p>
              ) : !amountValid ? (
                <p className="dr-hint" style={{ color: "#c2412f" }}>
                  Enter an amount from $1.00 up to the {usd(maxCents)} remaining.
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
                  {g.visit ? "Approve and pay" : "Approve"} {amountValid ? usd(cents) : ""}
                </button>
              </div>
            </>
          ) : g.status === "rejected" ? (
            <div className="dr-result no" role="status">
              <Icon name="xCircle" /> Declined
            </div>
          ) : (
            <div className="dr-result ok" role="status">
              <Icon name="checkCircle" />{" "}
              {g.status === "paid"
                ? `Paid ${usd(g.approvedCents)} to ${g.provider.name}. The patient's bill is updated.`
                : g.status === "payment_pending"
                  ? `Approved ${usd(g.approvedCents)}. Paying ${g.provider.name} now…`
                  : `Approved for ${usd(g.approvedCents)}. The amount and recipient are now fixed.`}
              {g.receipt?.nessiePaymentId && <small> Nessie payment {g.receipt.nessiePaymentId}</small>}
            </div>
          )}
          {g.status === "paid" && (
            <RefundToFund grant={g} />
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
        <p style={{ color: "#535465" }}>
          {g.visit
              ? `This pays ${usd(cents)} from the community care fund to ${g.provider.name} now, toward ${name}'s bill. It can't be undone.`
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
        <p style={{ color: "#535465" }}>{name} will see that the request wasn&apos;t approved. No money is reserved.</p>
      </ConfirmDialog>
    </>
  );
}
