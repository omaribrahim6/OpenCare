"use client";

// The public verification page: Nessie holds the money, Solana holds the rules and the proof, and
// every record on one side points at the other. Everything here comes from /api/proof* and is safe to
// show anyone: amounts, opaque hashes, hospital wallets, fund-side Nessie IDs. No patient data.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { usd } from "@/lib/format";

interface ProgramGrant {
  address: string;
  caseHash: string;
  amountCents: number;
  status: string;
  rulesVersion: number;
  decidedAt: number;
  nessiePaymentHash: string | null;
  explorerUrl: string;
}

interface ProofData {
  treasury: { address: string; explorerUrl: string } | null;
  program: {
    id: string;
    explorerUrl: string;
    error?: string;
    config?: { maxGrantCents: number; rulesVersion: number; grantsApproved: number; grantsDeclined: number; centsApproved: number; centsPaid: number; rulesHash: string } | null;
    rules?: { text: string[]; hash: string; matchesChain: boolean | null };
    hospitals?: { address: string; wallet: string; merchantHash: string; active: boolean; explorerUrl: string }[];
    grants?: ProgramGrant[];
    grantCount?: number;
  } | null;
  anchors: {
    day: string;
    digest: string;
    status: string;
    explorerUrl: string | null;
    formula: { version: string; sha256: string };
    queue: { root: string; count: number };
    ledger: { root: string; count: number };
    nessie: { fund: Statement | null; reserved: Statement | null };
  }[];
  rails: { counts: Record<string, number>; recent: { kind: string; amountCents: number | null; nessieId: string | null; signature: string | null; explorerUrl: string | null; at: string }[] };
}

interface Statement {
  accountTail: string;
  depositsCents: number;
  purchasesCents: number;
  transfersInCents: number;
  transfersOutCents: number;
  netCents: number;
  transactions: number;
}

interface Check {
  name: string;
  ok: boolean;
  checked: number;
  mismatches: number;
}

const short = (s: string, n = 6) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

const KIND_LABEL: Record<string, string> = {
  reserve: "Approval moved to the reserved account",
  contribution: "Hospital contribution into the fund",
  donor_transfer: "Donor transfer into the fund",
  refund: "Hospital refund back to the fund",
  program_approve: "Approval recorded in the fund program",
  program_decline: "Decline recorded in the fund program",
  program_paid: "Payout fingerprint recorded on chain",
  attest: "Hospital wallet attested",
  patient_payment: "Patients paid from their checking",
  bill_sync: "Hospital bills on patients' bank accounts",
  plan: "Monthly payment plans",
  hospital_account: "Hospital and donor bank accounts",
};

export function ProofView() {
  const [data, setData] = useState<ProofData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch("/api/proof", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error?.message ?? "The proof couldn't be loaded"))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const runChecks = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/proof/reconcile", { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message ?? "Reconciliation failed");
      setChecks(body.report.checks);
    } catch (e) {
      setChecks([{ name: (e as Error).message, ok: false, checked: 0, mismatches: 0 }]);
    } finally {
      setChecking(false);
    }
  }, []);

  const program = data?.program;
  const config = program?.config;
  const latest = data?.anchors[0];
  const privateCounts = data
    ? (["patient_payment", "bill_sync", "plan"] as const).map((k) => ({ kind: k, n: data.rails.counts[k] ?? 0 }))
    : [];

  return (
    <div className="pf-wrap">
      <section className="pf-hero" aria-labelledby="pf-title">
        <h1 id="pf-title">Check every dollar yourself.</h1>
        <p className="pf-lede">
          The money lives in a bank. The rules and the proof live on a public chain. Every record on one side points at the other, so neither
          can quietly change.
        </p>
        <div className="pf-rails">
          <div className="pf-rail pf-rail-bank">
            <p className="pf-rail-name">Capital One Nessie</p>
            <p className="pf-rail-job">Where the dollars are</p>
            <ul>
              <li>Donations and hospital contributions arrive by deposit or transfer</li>
              <li>An approval moves to the fund&rsquo;s reserved account</li>
              <li>The hospital is paid from it, never the patient</li>
              <li>The patient&rsquo;s bill, payment and plan live on their own account</li>
            </ul>
          </div>
          <div className="pf-link" aria-hidden="true">
            <span>payment fingerprint</span>
          </div>
          <div className="pf-rail pf-rail-chain">
            <p className="pf-rail-name">Solana devnet</p>
            <p className="pf-rail-job">What&rsquo;s allowed, and proof it happened</p>
            <ul>
              <li>The fund program enforces the published rules</li>
              <li>Each case can be approved once, only for an attested hospital</li>
              <li>Each payout records the fingerprint of its Nessie payment</li>
              <li>A daily anchor seals the queue, the ledger and the bank books</li>
            </ul>
          </div>
        </div>
      </section>

      {error && <p className="pf-error" role="alert">{error}</p>}
      {!data && !error && <p className="pf-loading">Reading the chain and the bank…</p>}

      {data && (
        <>
          <section className="pf-section" aria-labelledby="pf-program">
            <div className="pf-section-head">
              <h2 id="pf-program">The fund program</h2>
              {program && (
                <a className="pf-ext" href={program.explorerUrl} target="_blank" rel="noreferrer">
                  {short(program.id, 5)} on Explorer
                </a>
              )}
            </div>
            {!program && <p className="pf-muted">The on-chain program isn&rsquo;t configured on this deployment.</p>}
            {program?.error && <p className="pf-muted">{program.error}</p>}
            {config && (
              <>
                <dl className="pf-stats">
                  <div><dt>Approved on chain</dt><dd>{config.grantsApproved}</dd></div>
                  <div><dt>Declined on chain</dt><dd>{config.grantsDeclined}</dd></div>
                  <div><dt>Approved</dt><dd>{usd(config.centsApproved)}</dd></div>
                  <div><dt>Paid, with a Nessie fingerprint</dt><dd>{usd(config.centsPaid)}</dd></div>
                  <div><dt>Largest grant</dt><dd>{usd(config.maxGrantCents)}</dd></div>
                </dl>
                <div className="pf-two">
                  <div className="pf-card">
                    <h3>Rules, version {config.rulesVersion}</h3>
                    <ol className="pf-rules">{program.rules?.text.map((t) => <li key={t}>{t}</li>)}</ol>
                    <p className={`pf-badge ${program.rules?.matchesChain ? "ok" : "warn"}`}>
                      {program.rules?.matchesChain ? "These rules match the hash on chain" : "These rules don't match the chain"}
                    </p>
                  </div>
                  <div className="pf-card">
                    <h3>Attested hospitals</h3>
                    <ul className="pf-list">
                      {program.hospitals?.map((h) => (
                        <li key={h.address}>
                          <a href={h.explorerUrl} target="_blank" rel="noreferrer">{short(h.wallet, 5)}</a>
                          <span className={`pf-badge ${h.active ? "ok" : "warn"}`}>{h.active ? "Active" : "Withdrawn"}</span>
                          <span className="pf-mono">merchant #{h.merchantHash.slice(0, 10)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="pf-muted">Grants can only name a wallet attested here, linked to the hash of its Nessie merchant ID.</p>
                  </div>
                </div>
                {program.grants && program.grants.length > 0 && (
                  <div className="pf-table-wrap">
                    <table className="pf-table">
                      <caption>Latest grants on chain ({program.grantCount})</caption>
                      <thead>
                        <tr><th scope="col">Case</th><th scope="col">Status</th><th scope="col" className="r">Amount</th><th scope="col">Nessie payment</th><th scope="col">Account</th></tr>
                      </thead>
                      <tbody>
                        {program.grants.slice(0, 12).map((g) => (
                          <tr key={g.address}>
                            <td className="pf-mono">#{g.caseHash.slice(0, 10)}</td>
                            <td><span className={`pf-badge ${g.status === "paid" ? "ok" : g.status === "declined" ? "muted" : "warn"}`}>{g.status}</span></td>
                            <td className="r">{g.amountCents ? usd(g.amountCents) : "—"}</td>
                            <td className="pf-mono">{g.nessiePaymentHash ? `#${g.nessiePaymentHash.slice(0, 10)}` : "—"}</td>
                            <td><a href={g.explorerUrl} target="_blank" rel="noreferrer">Explorer</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="pf-section" aria-labelledby="pf-anchor">
            <div className="pf-section-head">
              <h2 id="pf-anchor">Daily anchor</h2>
              {latest?.explorerUrl && <a className="pf-ext" href={latest.explorerUrl} target="_blank" rel="noreferrer">{latest.day} memo on Explorer</a>}
            </div>
            {!latest && <p className="pf-muted">No anchor yet today. A caseworker or the daily job publishes one.</p>}
            {latest && (
              <div className="pf-two">
                <div className="pf-card">
                  <h3>What {latest.day}&rsquo;s memo seals</h3>
                  <dl className="pf-kv">
                    <div><dt>Need formula</dt><dd>{latest.formula.version} <span className="pf-mono">#{latest.formula.sha256.slice(0, 12)}</span></dd></div>
                    <div><dt>Queue</dt><dd>{latest.queue.count} requests <span className="pf-mono">root #{latest.queue.root.slice(0, 12)}</span></dd></div>
                    <div><dt>Public ledger</dt><dd>{latest.ledger.count} records <span className="pf-mono">root #{latest.ledger.root.slice(0, 12)}</span></dd></div>
                    <div><dt>Digest</dt><dd className="pf-mono">#{latest.digest.slice(0, 32)}</dd></div>
                  </dl>
                  <p className="pf-muted">
                    Patients can prove their own place in the queue from this root, from their account, without anyone else&rsquo;s data.{" "}
                    <a href={`/api/proof/anchors/${latest.day}`}>Recompute it yourself</a>.
                  </p>
                </div>
                <div className="pf-card">
                  <h3>The fund&rsquo;s bank books that day</h3>
                  {[["Available", latest.nessie.fund], ["Reserved", latest.nessie.reserved]].map(([label, s]) => {
                    const st = s as Statement | null;
                    return (
                      <div key={label as string} className="pf-book">
                        <p className="pf-book-name">{label as string} {st && <span className="pf-mono">…{st.accountTail}</span>}</p>
                        {st ? (
                          <dl className="pf-kv">
                            <div><dt>Deposits in</dt><dd>{usd(st.depositsCents)}</dd></div>
                            <div><dt>Transfers in</dt><dd>{usd(st.transfersInCents)}</dd></div>
                            <div><dt>Paid to hospitals</dt><dd>{usd(st.purchasesCents)}</dd></div>
                            <div><dt>Transfers out</dt><dd>{usd(st.transfersOutCents)}</dd></div>
                          </dl>
                        ) : (
                          <p className="pf-muted">Not set up.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="pf-section" aria-labelledby="pf-recon">
            <div className="pf-section-head">
              <h2 id="pf-recon">Do the two rails agree?</h2>
              <button type="button" className="pf-btn" onClick={runChecks} disabled={checking}>
                {checking ? "Checking Nessie and Solana…" : checks ? "Check again" : "Run the checks"}
              </button>
            </div>
            {checks ? (
              <ul className="pf-checks">
                {checks.map((c) => (
                  <li key={c.name} data-ok={c.ok}>
                    <span className="pf-check-mark" aria-hidden="true">{c.ok ? "✓" : "!"}</span>
                    <span>{c.name}</span>
                    <span className="pf-muted">{c.ok ? `${c.checked} checked` : `${c.mismatches} of ${c.checked} don't match`}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pf-muted">Reads the fund&rsquo;s Nessie accounts and the chain right now and matches every payout, receipt, donation and transfer one to one.</p>
            )}
          </section>

          <CryptoDonate treasury={data.treasury?.address ?? null} />

          <section className="pf-section" aria-labelledby="pf-moves">
            <div className="pf-section-head">
              <h2 id="pf-moves">Linked records</h2>
            </div>
            <div className="pf-two">
              <div className="pf-card">
                <h3>Latest fund-side movements</h3>
                {data.rails.recent.length === 0 && <p className="pf-muted">None yet.</p>}
                <ul className="pf-list">
                  {data.rails.recent.slice(0, 10).map((r, i) => (
                    <li key={`${r.kind}-${i}`}>
                      <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                      {r.amountCents ? <span>{usd(r.amountCents)}</span> : null}
                      {r.nessieId && <span className="pf-mono">Nessie …{r.nessieId.slice(-6)}</span>}
                      {r.explorerUrl && <a href={r.explorerUrl} target="_blank" rel="noreferrer">Solana</a>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pf-card">
                <h3>Patient-side, counted only</h3>
                <ul className="pf-list">
                  {privateCounts.map((p) => (
                    <li key={p.kind}><span>{KIND_LABEL[p.kind]}</span><span>{p.n}</span></li>
                  ))}
                </ul>
                <p className="pf-muted">These live on patients&rsquo; own Nessie accounts. The chain and this page never see them, only how many there are.</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Donate devnet SOL or USDC with any Solana Pay wallet, or share the Blink. */
function CryptoDonate({ treasury }: { treasury: string | null }) {
  const [rail, setRail] = useState<"sol" | "usdc">("sol");
  const [amount, setAmount] = useState("0.1");
  const [req, setReq] = useState<{ reference: string; url: string; usdCents: number; priceSource: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const poll = useRef<number | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => () => { if (poll.current) window.clearInterval(poll.current); }, []);

  const start = async () => {
    setErr(null);
    setStatus(null);
    if (poll.current) window.clearInterval(poll.current);
    try {
      const r = await fetch("/api/solana-pay/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rail, amount: Number(amount) }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message ?? "The request couldn't be created");
      setReq(body.request);
      setQr(await QRCode.toDataURL(body.request.url, { margin: 1, width: 240, color: { dark: "#171a2b", light: "#ffffff" } }));
      setStatus("Waiting for your wallet…");
      poll.current = window.setInterval(async () => {
        const s = await fetch(`/api/solana-pay/status?reference=${body.request.reference}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
        if (s?.status === "confirmed") {
          setStatus(`Received ${usd(s.usdCents ?? 0)}. Thank you. It's on the public ledger now.`);
          if (poll.current) window.clearInterval(poll.current);
        }
      }, 3000);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const blink = origin ? `https://dial.to/?action=${encodeURIComponent(`solana-action:${origin}/api/actions/donate`)}&cluster=devnet` : "";

  return (
    <section className="pf-section" aria-labelledby="pf-give">
      <div className="pf-section-head">
        <h2 id="pf-give">Give with a Solana wallet</h2>
      </div>
      <div className="pf-two">
        <div className="pf-card">
          <h3>Scan to give</h3>
          <div className="pf-give-row">
            <div className="tabs" role="tablist" aria-label="Currency">
              <button type="button" role="tab" aria-selected={rail === "sol"} onClick={() => { setRail("sol"); setAmount("0.1"); }}>Devnet SOL</button>
              <button type="button" role="tab" aria-selected={rail === "usdc"} onClick={() => { setRail("usdc"); setAmount("10"); }}>Devnet USDC</button>
            </div>
            <label className="pf-amount">
              <span className="sr-only">Amount</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span>{rail === "sol" ? "SOL" : "USDC"}</span>
            </label>
            <button type="button" className="pf-btn" onClick={start} disabled={!treasury}>Make a QR code</button>
          </div>
          {err && <p className="pf-error" role="alert">{err}</p>}
          {req && qr && (
            <div className="pf-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Solana Pay QR code for this donation" width={240} height={240} />
              <div>
                <p>
                  About {usd(req.usdCents)}
                  {rail === "sol" ? (req.priceSource === "pyth" ? ", priced by Pyth's SOL/USD feed on chain" : ", at the fund's fixed demo rate") : ""}.
                </p>
                <p className="pf-muted" aria-live="polite">{status}</p>
                <a href={req.url}>Open in a wallet on this device</a>
              </div>
            </div>
          )}
        </div>
        <div className="pf-card">
          <h3>Share the Blink</h3>
          <p>Anywhere Blinks work, this link becomes a Donate button that opens the donor&rsquo;s own wallet.</p>
          {blink && (
            <p>
              <a href={blink} target="_blank" rel="noreferrer">Open the Donate Blink</a>
            </p>
          )}
          <p className="pf-muted">
            Crypto only flows in. Hospitals are always paid in dollars through Nessie, so there is one pool of money and one set of books.
            {treasury && <> Treasury <span className="pf-mono">{short(treasury, 5)}</span>.</>}
          </p>
        </div>
      </div>
    </section>
  );
}
