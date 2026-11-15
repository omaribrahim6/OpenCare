"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LedgerEntry, LedgerResponse } from "@abdulcare/contracts";
import { Icon, SolanaMark, type IconName } from "@/components/Icon";
import { explorerTx, shortSig, usd, usdParts } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/types";

// The public ledger (/fund): every dollar in and out, with only what's safe to publish. Cases are
// shown by a short public case ID, the paying hospital, the amount and the month; no diagnosis,
// cost of care, patient details or exact dates. The full record stays in the admin ledger.

/** Short public case ID from the opaque reference: ac_9ced1170… → OC-9CED. */
export function publicCaseId(reference: string) {
  const body = reference.includes("_") ? reference.slice(reference.indexOf("_") + 1) : reference;
  return `OC-${body.slice(0, 4).toUpperCase()}`;
}

const period = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const longPeriod = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });

type Kind = "all" | "payment" | "donation";
type Range = "all" | "7" | "30" | "90";
const PAGE = 10;

const KIND_META: Record<"payment" | "donation", { label: string; icon: IconName; bg: string; fg: string }> = {
  payment: { label: "Provider payment", icon: "store", bg: "var(--rose-soft)", fg: "#a5513f" },
  donation: { label: "Donation", icon: "heart", bg: "var(--mint-soft)", fg: "#2a7a5f" },
};

/** Only money that moved is public: payouts (sent or sending) and donations. */
const isPayment = (e: LedgerEntry) => e.kind === "payout" || e.kind === "pending";

function donorName(e: LedgerEntry) {
  if (!e.donorLabel) return { name: "Community contribution", note: null };
  return { name: e.donorLabel, note: e.donorKind === "individual" ? "public donor" : null };
}

export function PublicLedger({ ledger }: { ledger: LedgerResponse | null }) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [range, setRange] = useState<Range>("all");
  const [provider, setProvider] = useState("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<LedgerEntry | null>(null);

  const visible = useMemo(() => (ledger?.entries ?? []).filter((e) => isPayment(e) || e.kind === "donation"), [ledger]);
  const providers = useMemo(
    () => [...new Set(visible.filter(isPayment).map((e) => e.hospital).filter((h): h is string => !!h))].sort(),
    [visible],
  );
  const since = range === "all" ? 0 : Date.now() - Number(range) * 86_400_000;
  const term = search.trim().toLowerCase().replace(/^oc-?/, "");
  const rows = useMemo(
    () =>
      visible
        .filter((e) => kind === "all" || (kind === "payment" ? isPayment(e) : e.kind === "donation"))
        .filter((e) => new Date(e.at).getTime() >= since)
        .filter((e) => provider === "all" || e.hospital === provider)
        .filter(
          (e) =>
            !term ||
            [publicCaseId(e.reference).toLowerCase().replace(/^oc-/, ""), e.hospital, e.solanaSignature, e.reference, e.donorLabel]
              .some((v) => v?.toLowerCase().includes(term)),
        ),
    [visible, kind, since, provider, term],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const t = ledger?.totals;
  const reset = () => setPage(1);

  return (
    <section className="g-card" aria-label="Ledger">
      {t && (
        <dl className="lc-summary pl-summary">
          <div><dt>Donated</dt><dd>{usd(t.donatedCents)}</dd></div>
          <div><dt>Paid to hospitals</dt><dd>{usd(t.paidCents)}</dd></div>
          <div><dt>Cost of care reviewed</dt><dd>{usd(t.careCostCents)}</dd></div>
          <div><dt>Cases decided</dt><dd>{t.cases.toLocaleString()} <small>({t.declined} declined)</small></dd></div>
        </dl>
      )}

      <div className="pl-toolbar">
        <label className="d-ledger-search pl-search">
          <span className="sr-only">Search the public ledger</span>
          <Icon name="search" />
          <input
            type="search"
            value={search}
            placeholder="Search by case ID, provider, or transaction ID…"
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
          />
        </label>
        <div className="tabs" role="tablist" aria-label="Event type">
          {(
            [
              ["all", "All events"],
              ["payment", "Provider payments"],
              ["donation", "Donations"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                reset();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="pl-select">
          <Icon name="calendar" />
          <select
            value={range}
            aria-label="Date range"
            onChange={(e) => {
              setRange(e.target.value as Range);
              reset();
            }}
          >
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <label className="pl-select">
          <Icon name="hospital" />
          <select
            value={provider}
            aria-label="Provider"
            onChange={(e) => {
              setProvider(e.target.value);
              reset();
            }}
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-wrap" style={{ background: "#fff" }}>
        <table className="table ledger-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Public case ID</th>
              <th scope="col">Provider (hospital)</th>
              <th scope="col" className="right">Payment amount</th>
              <th scope="col">Reporting period</th>
              <th scope="col">Verification</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => {
              const pay = isPayment(e);
              const m = KIND_META[pay ? "payment" : "donation"];
              const [w, c] = usdParts(e.amountCents);
              const donor = donorName(e);
              return (
                <tr key={`${e.reference}-${i}`} className="lc-clickable" onClick={() => setOpen(e)}>
                  <td>
                    <span className="ev">
                      <span className="act-icon" style={{ "--bg-c": m.bg, "--fg-c": m.fg } as React.CSSProperties}>
                        <Icon name={m.icon} />
                      </span>
                      {m.label}
                    </span>
                  </td>
                  <td>{pay ? <CaseIdChip id={publicCaseId(e.reference)} /> : <span className="muted">—</span>}</td>
                  <td>
                    {pay ? (
                      e.hospital
                    ) : (
                      <span className="muted">
                        {donor.name}
                        {donor.note && <i> ({donor.note})</i>}
                      </span>
                    )}
                  </td>
                  <td className={`right num pl-amount${pay ? "" : " in"}`}>
                    {pay ? "−" : "+"}
                    {w}
                    <span className="cents">{c}</span>
                  </td>
                  <td>{period(e.at)}</td>
                  <td>
                    <span className="pl-verify">
                      {e.solanaSignature && e.kind !== "pending" ? (
                        <span className="chip chip-ok">
                          <Icon name="checkCircle" /> Verified
                        </span>
                      ) : (
                        <span className="chip chip-warn chip-dot">Pending</span>
                      )}
                      {e.solanaSignature && (
                        <a
                          className="pl-ext"
                          href={explorerTx(e.solanaSignature)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open the receipt on Solana Explorer"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <Icon name="external" />
                        </a>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {ledger && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pl-pager">
        <span className="muted">
          {rows.length ? `Showing ${(current - 1) * PAGE + 1}–${(current - 1) * PAGE + shown.length} of ${rows.length.toLocaleString()} events` : "No events"}
        </span>
        {pages > 1 && (
          <nav aria-label="Pages">
            <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}>
              <Icon name="chevronLeft" />
            </button>
            {pageList(current, pages).map((p, i) =>
              p === null ? (
                <span key={`gap-${i}`} className="muted">
                  …
                </span>
              ) : (
                <button key={p} type="button" aria-current={p === current ? "page" : undefined} onClick={() => setPage(p)}>
                  {p}
                </button>
              ),
            )}
            <button type="button" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}>
              <Icon name="chevronRight" />
            </button>
          </nav>
        )}
      </div>

      {t && <DeclinedSummary totals={t} />}

      {open && <PublicRecord entry={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** 1 2 3 … 63 style page list around the current page. */
function pageList(current: number, pages: number): (number | null)[] {
  const set = new Set([1, 2, 3, current - 1, current, current + 1, pages].filter((p) => p >= 1 && p <= pages));
  const list = [...set].sort((a, b) => a - b);
  return list.flatMap((p, i) => (i > 0 && p - list[i - 1] > 1 ? [null, p] : [p]));
}

function CaseIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="pl-case">
      {id}
      <button
        type="button"
        aria-label={`Copy case ID ${id}`}
        title={copied ? "Copied" : "Copy"}
        onClick={(ev) => {
          ev.stopPropagation();
          navigator.clipboard?.writeText(id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        <Icon name={copied ? "check" : "copy"} />
      </button>
    </span>
  );
}

/** The public record for one row: what moved, to whom, when, and how it's verified. */
function PublicRecord({ entry: e, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  const pay = isPayment(e);
  const donor = donorName(e);
  const sig = e.solanaSignature;
  const confirmed = !!sig && e.kind !== "pending";

  return (
    <dialog ref={dialog} className="lc-drawer pl-record" aria-label="Public record" onClose={onClose} onCancel={onClose}>
      <header className="pl-record-head">
        <span className="pl-record-icon">
          <Icon name={pay ? "store" : "heart"} />
        </span>
        <div>
          <h2>{pay ? `Case ${publicCaseId(e.reference)}` : "Donation"}</h2>
          <p>{pay ? "Provider payment (public record)" : "Donation (public record)"}</p>
        </div>
        <button type="button" className="v-quiet v-icon-button" aria-label="Close" onClick={() => dialog.current?.close()}>
          <Icon name="x" />
        </button>
      </header>

      <div className="pl-record-amount">
        <small>{pay ? "Community fund paid" : "Donated to the community fund"}</small>
        <strong>{usd(e.amountCents)}</strong>
      </div>

      {pay && <MoneySteps entry={e} />}

      <ul className="pl-record-rows">
        <li>
          <span className="pl-row-icon">
            <Icon name={pay ? "hospital" : "users"} />
          </span>
          <div>
            <small>{pay ? "Recipient" : "Donor"}</small>
            <strong>
              {pay ? (e.hospital ?? "Verified healthcare provider") : donor.name}
              {!pay && donor.note && <i className="muted"> ({donor.note})</i>}
            </strong>
          </div>
          {pay && (
            <span className="chip chip-ok">
              <Icon name="check" /> Verified
            </span>
          )}
        </li>
        <li>
          <span className="pl-row-icon">
            <Icon name="calendar" />
          </span>
          <div>
            <small>Reporting period</small>
            <strong>{longPeriod(e.at)}</strong>
          </div>
        </li>
        <li>
          <span className="pl-row-icon">
            <Icon name="shield" />
          </span>
          <div>
            <small>Receipt status</small>
            {confirmed ? (
              <span className="chip chip-ok">
                <Icon name="check" /> Confirmed
              </span>
            ) : (
              <span className="chip chip-warn chip-dot">Pending</span>
            )}
          </div>
        </li>
        <li>
          <span className="pl-row-icon">
            <Icon name="layers" />
          </span>
          <div>
            <small>Verification method</small>
            <strong>{pay ? "Solana receipt + provider attestation" : "Solana receipt + bank deposit"}</strong>
          </div>
        </li>
        {sig && (
          <li>
            <span className="pl-row-icon">
              <SolanaMark size={16} />
            </span>
            <div>
              <small>Solana receipt</small>
              <span className="pl-sig">
                {shortSig(sig)}
                <button
                  type="button"
                  aria-label="Copy the receipt signature"
                  onClick={() =>
                    navigator.clipboard?.writeText(sig).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    })
                  }
                >
                  <Icon name={copied ? "check" : "copy"} />
                </button>
              </span>
            </div>
            <a className="pl-ext" href={explorerTx(sig)} target="_blank" rel="noreferrer" aria-label="Open on Solana Explorer">
              <Icon name="external" />
            </a>
          </li>
        )}
      </ul>

      <p className="pl-record-note">
        <Icon name="info" />
        <span>
          {pay
            ? "Public record of a verified payment from the OpenCare community fund to a healthcare provider. Patient and medical details are private."
            : "Public record of a donation to the OpenCare community fund. Donors who asked not to be named stay anonymous."}
        </span>
      </p>
    </dialog>
  );
}

/** Billed → insurance → hospital assistance → fund, as amounts only, with a coarse care category. */
function MoneySteps({ entry: e }: { entry: LedgerEntry }) {
  const billed = e.chargesCents;
  if (billed == null) return null;
  const steps: [string, number | null | undefined, boolean][] = [
    ["Billed", billed, false],
    ["Insurance paid", e.insurerPaidCents, true],
    ["Hospital assistance", e.hospitalAssistanceCents, true],
    ["Community fund paid", e.amountCents, true],
  ];
  const left = billed - (e.insurerPaidCents ?? 0) - (e.hospitalAssistanceCents ?? 0) - e.amountCents;
  return (
    <section className="pl-steps" aria-label="How the bill was paid">
      <div className="pl-steps-head">
        <small>How the bill was paid</small>
        {e.category && <span className="chip chip-line">{CATEGORY_LABEL[e.category]}</span>}
      </div>
      <ol>
        {steps.map(([label, cents, minus]) => (
          <li key={label}>
            <span>{label}</span>
            <b>{cents == null ? "—" : `${minus && cents > 0 ? "−" : ""}${usd(cents)}`}</b>
          </li>
        ))}
        <li className="pl-steps-left">
          <span>Left for the patient</span>
          <b>{usd(Math.max(0, left))}</b>
        </li>
      </ol>
    </section>
  );
}

type Totals = LedgerResponse["totals"] & { declinedByReason?: { reason: string; count: number }[] };

/** Declines are public as totals: how many requests the fund said no to, and why, never which ones. */
function DeclinedSummary({ totals }: { totals: Totals }) {
  const reasons = (totals.declinedByReason ?? []).filter((r) => r.count > 0);
  return (
    <section className="pl-declined" aria-label="Declined requests">
      <div>
        <strong>{totals.declined.toLocaleString()}</strong>
        <span>{totals.declined === 1 ? "request declined" : "requests declined"}</span>
      </div>
      {reasons.length > 0 ? (
        <ul>
          {reasons.map((r) => (
            <li key={r.reason}>
              {r.reason} <b>{r.count.toLocaleString()}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Declined requests are counted here, not listed, so no one can be identified.</p>
      )}
    </section>
  );
}
