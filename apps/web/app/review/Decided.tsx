"use client";

import { useEffect, useState } from "react";
import { Icon, SolanaMark } from "@/components/Icon";
import { listGrants } from "@/lib/api";
import { cleanName, explorerTx, initials, shortSig, usd, usdParts } from "@/lib/format";
import type { Grant, GrantStatus } from "@/lib/types";

const STATUS: Partial<Record<GrantStatus, { label: string; tone: string }>> = {
  approved: { label: "Approved", tone: "green" },
  payment_pending: { label: "Paying", tone: "blue" },
  paid: { label: "Paid", tone: "teal" },
  rejected: { label: "Declined", tone: "" },
  canceled: { label: "Canceled", tone: "" },
};

/** Every request that already has a decision, newest first, with its payout receipt. */
export function Decided({ tick }: { tick: number }) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    listGrants()
      .then((r) =>
        setGrants(
          r.grants
            .filter((g) => g.status in STATUS)
            .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)),
        ),
      )
      .catch(() => setFailed(true));
  }, [tick]);

  const sum = (s: GrantStatus[]) => (grants ?? []).filter((g) => s.includes(g.status)).reduce((a, g) => a + (g.approvedCents ?? 0), 0);
  const count = (s: GrantStatus[]) => (grants ?? []).filter((g) => s.includes(g.status)).length;
  const tiles = [
    { icon: "checkCircle" as const, label: "Approved", value: String(count(["approved", "payment_pending"])), cap: "Awaiting hospital payment" },
    { icon: "lock" as const, label: "Reserved", value: usd(sum(["approved", "payment_pending"])), cap: "Held for approved grants" },
    { icon: "store" as const, label: "Paid to hospitals", value: usd(sum(["paid"])), cap: `${count(["paid"])} grants paid` },
    { icon: "xCircle" as const, label: "Declined", value: String(count(["rejected"])), cap: "Requests not approved" },
  ];

  return (
    <>
      <section className="d-card" aria-labelledby="dc-title">
        <div className="d-card-head">
          <h2 id="dc-title">Decisions overview</h2>
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
                {grants ? t.value : <span className="skeleton" style={{ display: "block", width: 110, height: 40 }} />}
              </div>
              <div className="d-tile-cap">{t.cap}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="d-card" aria-labelledby="dl-title">
        <div className="d-card-head">
          <h2 id="dl-title">Decided requests</h2>
        </div>
        <div className="d-table-wrap">
          <table className="d-table">
            <thead>
              <tr>
                <th scope="col">Decided</th>
                <th scope="col">Patient</th>
                <th scope="col">Bill</th>
                <th scope="col">Paid to</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {failed && (
                <tr>
                  <td colSpan={7} className="d-empty" role="alert">
                    The decided requests didn&apos;t load.
                  </td>
                </tr>
              )}
              {!failed && !grants && (
                <tr>
                  <td colSpan={7}>
                    <span className="skeleton" style={{ display: "block", height: 18 }} />
                  </td>
                </tr>
              )}
              {grants?.length === 0 && (
                <tr>
                  <td colSpan={7} className="d-empty">
                    No decisions yet.
                  </td>
                </tr>
              )}
              {grants?.map((g) => {
                const st = STATUS[g.status]!;
                const [w, c] = usdParts(g.approvedCents ?? g.requestedCents);
                const sig = g.receipt?.solanaSignature;
                return (
                  <tr key={g.id}>
                    <td>
                      {new Date(g.decidedAt ?? g.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      <span className="d-who">
                        <span aria-hidden="true">{initials(g.patient.displayName)}</span>
                        {cleanName(g.patient.displayName)}
                      </span>
                    </td>
                    <td>{g.bill.merchant}</td>
                    <td>{cleanName(g.provider.name)}</td>
                    <td className="num">
                      {w}
                      <span className="cents">{c}</span>
                    </td>
                    <td>
                      <span className={`d-pill dot ${st.tone}`}>{st.label}</span>
                    </td>
                    <td>
                      {sig ? (
                        <a className="sig" href={g.receipt?.explorerUrl ?? explorerTx(sig)} target="_blank" rel="noreferrer">
                          <SolanaMark size={12} />
                          {shortSig(sig)}
                        </a>
                      ) : (
                        <span className="muted">{g.status === "paid" || g.status === "payment_pending" ? "Confirming" : "None"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
