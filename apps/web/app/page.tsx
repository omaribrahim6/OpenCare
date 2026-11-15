// Public landing page: what OpenCare is, who funds it, what's in the fund, and the way into the
// public ledger. Server-rendered from core; numbers are cached for a minute. No patient data.

import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Lexend, Newsreader } from "next/font/google";
import type { FundSummary, LedgerEntry, TopDonorsResponse } from "@abdulcare/contracts";
import { getDb, getFundSummary, listLedger, listTopDonors } from "@abdulcare/core";
import { BillStage } from "@/components/landing/BillStage";
import { DONOR_KIND_LABEL, DonorMark, logoIdForName } from "@/components/landing/DonorMark";
import { LogoMark } from "@/components/Logo";
import { cleanName, usd, usdCompact } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/types";
import "./landing.css";

// Lexend was designed from reading-fluency research, which suits a page patients read. Newsreader's
// italic is used only where a person is quoted.
const sans = Lexend({ subsets: ["latin"], variable: "--font-landing", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], style: ["italic"], axes: ["opsz"], variable: "--font-quote", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "OpenCare · Every dollar of care, in public" },
  description:
    "OpenCare runs a hospital bill through insurance, the hospital's own assistance and a community fund. A person approves every grant, and every claim and donation is published without the patient's identity.",
};

interface LandingData {
  fund: FundSummary | null;
  donors: TopDonorsResponse | null;
  claims: LedgerEntry[];
  cases: number;
  declined: number;
}

const loadLanding = unstable_cache(
  async (): Promise<LandingData> => {
    const db = getDb();
    const [fund, donors, ledger] = await Promise.all([
      getFundSummary(db).catch(() => null),
      listTopDonors(db, 6).catch(() => null),
      listLedger(db).catch(() => null),
    ]);
    return {
      fund,
      donors,
      claims: (ledger?.entries ?? []).filter((e) => e.kind === "payout").slice(0, 5),
      cases: ledger?.totals.cases ?? 0,
      declined: ledger?.totals.declined ?? 0,
    };
  },
  ["landing-v2"],
  { revalidate: 60 },
);

async function data(): Promise<LandingData> {
  try {
    return await loadLanding();
  } catch {
    return { fund: null, donors: null, claims: [], cases: 0, declined: 0 };
  }
}

/** $1.8B for big numbers (exact value in the title), exact dollars below $1M. */
function money(cents: number) {
  return Math.abs(cents) >= 100_000_000 ? usdCompact(cents) : usd(Math.round(cents / 100) * 100);
}

export default async function Landing() {
  const { fund, donors, claims, cases, declined } = await data();
  const available = fund?.availableCents ?? null;
  const paid = fund?.paidCents ?? 0;
  const total = fund?.totalCents ?? 0;

  return (
    <div className={`landing ${sans.variable} ${serif.variable}`}>
      <header className="ln-top">
        <Link href="/" className="ln-brand" aria-label="OpenCare home">
          <LogoMark className="ln-brand-mark" />
          OpenCare
        </Link>
        <nav className="ln-nav" aria-label="Main">
          <Link href="/fund">Public ledger</Link>
          <Link href="/kiosk">Patient portal</Link>
          <Link href="/admin" className="ln-nav-staff">
            Staff
          </Link>
        </nav>
      </header>

      <main>
        <section className="ln-hero" aria-labelledby="ln-title">
          <h1 id="ln-title">One hospital bill. Every source of help. A public receipt for every dollar.</h1>
          <p className="ln-lede">
            OpenCare runs a hospital bill through the patient&rsquo;s insurance, then every assistance policy the
            hospital offers, then a community fund paid for by hospitals, public programs and donors. A person approves
            every grant, and every claim and donation is published with the patient&rsquo;s identity removed.
          </p>
          <div className="ln-actions">
            <Link href="/fund" className="ln-pill ln-pill-ink">
              View the public ledger
            </Link>
            <Link href="/kiosk" className="ln-pill ln-pill-glass">
              Patient portal
            </Link>
          </div>
        </section>

        <BillStage />

        <section className="ln-fund" aria-labelledby="ln-fund-title">
          <div className="ln-fund-main">
            <h2 id="ln-fund-title">Available in the fund now</h2>
            <p className="ln-big" title={available == null ? undefined : usd(available)}>
              {available == null ? "Unavailable" : money(available)}
            </p>
            {available != null && <p className="ln-exact">{usd(available)} exactly, ready to pay hospitals</p>}
            <Link href="/fund" className="ln-pill ln-pill-ink">
              View ledger
            </Link>
          </div>
          <dl className="ln-stats">
            <div>
              <dt>Donated in total</dt>
              <dd title={usd(total)}>{money(total)}</dd>
            </div>
            <div>
              <dt>Paid to hospitals</dt>
              <dd title={usd(paid)}>{money(paid)}</dd>
            </div>
            <div>
              <dt>Claims decided</dt>
              <dd>{cases.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt>Declined</dt>
              <dd>{declined.toLocaleString("en-US")}</dd>
            </div>
          </dl>
        </section>

        <div className="ln-lists">
          <section className="ln-card" aria-labelledby="ln-donors-title">
            <div className="ln-head">
              <h2 id="ln-donors-title">Top donors</h2>
              <span className="ln-tag">Fictional</span>
            </div>
            {donors && donors.donors.length > 0 ? (
              <ol className="ln-donor-list">
                {donors.donors.map((d) => (
                  <li key={d.id}>
                    <DonorMark id={d.id} name={d.name} kind={d.kind} />
                    <span className="ln-row-name">
                      <strong>{d.name}</strong>
                      <small>
                        {DONOR_KIND_LABEL[d.kind]}, {d.giftCount} {d.giftCount === 1 ? "gift" : "gifts"}
                      </small>
                    </span>
                    <span className="ln-row-amount" title={usd(d.totalGivenCents)}>
                      {money(d.totalGivenCents)}
                    </span>
                  </li>
                ))}
                {donors.anonymous.giftCount > 0 && (
                  <li>
                    <span className="ln-mark ln-mark-anon" aria-hidden="true" />
                    <span className="ln-row-name">
                      <strong>Anonymous donors</strong>
                      <small>{donors.anonymous.giftCount} gifts</small>
                    </span>
                    <span className="ln-row-amount" title={usd(donors.anonymous.totalCents)}>
                      {money(donors.anonymous.totalCents)}
                    </span>
                  </li>
                )}
              </ol>
            ) : (
              <p className="ln-empty">Donor totals are unavailable right now.</p>
            )}
            <p className="ln-fine">
              Funders and amounts are demo data. Logos were generated for these fictional organizations and aren&rsquo;t
              real brands.
            </p>
          </section>

          <section className="ln-card" aria-labelledby="ln-claims-title">
            <div className="ln-head">
              <h2 id="ln-claims-title">Latest claims paid</h2>
              <Link href="/fund" className="ln-link">
                See every claim
              </Link>
            </div>
            {claims.length > 0 ? (
              <ul className="ln-claim-list">
                {claims.map((c) => (
                  <li key={c.reference}>
                    <Link href="/fund" className="ln-claim-row">
                      <DonorMark id={logoIdForName(c.hospital)} name={cleanName(c.hospital ?? "Hospital")} kind="hospital" />
                      <span className="ln-row-name">
                        <strong>{cleanName(c.hospital ?? "Hospital")}</strong>
                        <small>
                          {c.category ? CATEGORY_LABEL[c.category] : "Visit"}
                          {c.region ? `, ${c.region}` : ""},{" "}
                          {new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </small>
                      </span>
                      <span className="ln-claim-num">
                        <small>Charged</small>
                        {money(c.chargesCents ?? 0)}
                      </span>
                      <span className="ln-claim-num ln-claim-paid">
                        <small>Fund paid</small>
                        {money(c.amountCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ln-empty">No paid claims yet.</p>
            )}
            <p className="ln-fine">
              The ledger shows each claim&rsquo;s itemized bill, what insurance and the hospital covered, the decision
              and its devnet receipt. Names, birth dates and SSNs are never shown.
            </p>
          </section>
        </div>
      </main>

      <footer className="ln-foot">
        <p>
          Independent hackathon prototype. Not affiliated with or endorsed by any political figure, hospital, insurer
          or government program. The 3D figures depict public figures; their quotes are real and link to their sources.
        </p>
        <p>Fictional data, Capital One Nessie mock banking and Solana devnet.</p>
      </footer>
    </div>
  );
}
