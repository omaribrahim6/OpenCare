// Public landing page: what AbdulCare is, who funds it, what's in the fund, and the way into the
// public ledger. Server-rendered from core; numbers are cached for a minute. No patient data.

import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import type { FundSummary, LedgerEntry, TopDonorsResponse } from "@abdulcare/contracts";
import { getDb, getFundSummary, listLedger, listTopDonors } from "@abdulcare/core";
import { Icon } from "@/components/Icon";
import { DONOR_KIND_LABEL, DonorMark, logoIdForName } from "@/components/landing/DonorMark";
import { cleanName, usd, usdCompact } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/types";
import { LogoMark } from "@/components/Logo";
import { MedicareQuotes } from "@/components/landing/MedicareQuotes";
import "./landing.css";
import "./quotes.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "AbdulCare · Every dollar of care, in public" },
  description:
    "AbdulCare runs a hospital bill through insurance, the hospital's own assistance and a community fund. A person approves every grant, and every claim and donation is published without the patient's identity.",
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
      listTopDonors(db, 8).catch(() => null),
      listLedger(db).catch(() => null),
    ]);
    return {
      fund,
      donors,
      claims: (ledger?.entries ?? []).filter((e) => e.kind === "payout").slice(0, 4),
      cases: ledger?.totals.cases ?? 0,
      declined: ledger?.totals.declined ?? 0,
    };
  },
  ["landing-v1"],
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

const PATH = [
  { label: "Charged", cents: 480_000, note: "Hospital-attested visit" },
  { label: "After insurance", cents: 216_000, note: "Deductible and 20% coinsurance" },
  { label: "After hospital assistance", cents: 43_200, note: "Charity care takes 80% off" },
  { label: "After the community fund", cents: 0, note: "A reviewer approved $432" },
];

export default async function Landing() {
  const { fund, donors, claims, cases, declined } = await data();
  const available = fund?.availableCents ?? null;
  const paid = fund?.paidCents ?? 0;
  const total = fund?.totalCents ?? 0;

  return (
    <div className="landing">
      <header className="ln-top">
        <Link href="/" className="ln-brand" aria-label="AbdulCare home">
          <LogoMark />
          AbdulCare
        </Link>
        <nav className="ln-nav" aria-label="Main">
          <Link href="/fund">Public ledger</Link>
          <Link href="/kiosk">Patient portal</Link>
          <Link href="/admin" className="ln-nav-quiet">Staff</Link>
        </nav>
      </header>

      <main className="ln-grid">
        <section className="ln-card ln-hero" aria-labelledby="ln-title">
          <p className="ln-eyebrow">Community care fund · Prototype with fictional data</p>
          <h1 id="ln-title">One hospital bill. Every source of help. A public receipt for every dollar.</h1>
          <p className="ln-lede">
            AbdulCare runs a hospital bill through the patient&rsquo;s insurance, then every assistance policy the hospital
            offers, then a community fund paid for by hospitals, public programs and donors. A person approves every
            grant, and every claim and donation is published, with the patient&rsquo;s identity removed.
          </p>
          <div className="ln-actions">
            <Link href="/fund" className="ln-btn ln-btn-primary">
              View the public ledger <Icon name="arrowRight" />
            </Link>
            <Link href="/kiosk" className="ln-btn">
              Patient portal
            </Link>
          </div>

          <ol className="ln-path" aria-label="Example: how one bill shrinks">
            {PATH.map((step, i) => (
              <li key={step.label} className={i === PATH.length - 1 ? "is-zero" : undefined}>
                <span className="ln-path-bar" style={{ ["--w" as string]: `${Math.max(3, (step.cents / PATH[0].cents) * 100)}%` }} />
                <span className="ln-path-label">{step.label}</span>
                <strong>{usd(step.cents)}</strong>
                <small>{step.note}</small>
              </li>
            ))}
          </ol>
          <MedicareQuotes />
        </section>

        <aside className="ln-card ln-donors" aria-labelledby="ln-donors-title">
          <div className="ln-head">
            <h2 id="ln-donors-title">Top donors</h2>
            <span className="ln-tag">Fictional</span>
          </div>
          {donors && donors.donors.length > 0 ? (
            <ol className="ln-donor-list">
              {donors.donors.map((d, i) => (
                <li key={d.id}>
                  <span className="ln-rank">{i + 1}</span>
                  <DonorMark id={d.id} name={d.name} kind={d.kind} />
                  <span className="ln-donor-name">
                    <strong>{d.name}</strong>
                    <small>
                      {DONOR_KIND_LABEL[d.kind]} · {d.giftCount} {d.giftCount === 1 ? "gift" : "gifts"}
                    </small>
                  </span>
                  <span className="ln-donor-amount" title={usd(d.totalGivenCents)}>
                    {money(d.totalGivenCents)}
                  </span>
                </li>
              ))}
              {donors.anonymous.giftCount > 0 && (
                <li className="ln-donor-anon">
                  <span className="ln-rank" aria-hidden="true" />
                  <span className="ln-mark ln-mark-anon" aria-hidden="true">
                    <Icon name="users" />
                  </span>
                  <span className="ln-donor-name">
                    <strong>Anonymous donors</strong>
                    <small>{donors.anonymous.giftCount} gifts</small>
                  </span>
                  <span className="ln-donor-amount" title={usd(donors.anonymous.totalCents)}>
                    {money(donors.anonymous.totalCents)}
                  </span>
                </li>
              )}
            </ol>
          ) : (
            <p className="ln-empty">Donor totals are unavailable right now.</p>
          )}
          <p className="ln-fine">Funders and amounts are demo data. Logos were generated for these fictional organizations and aren&rsquo;t real brands.</p>
        </aside>

        <section className="ln-card ln-fund" aria-labelledby="ln-fund-title">
          <div className="ln-fund-main">
            <h2 id="ln-fund-title">Available in the fund now</h2>
            <p className="ln-big" title={available == null ? undefined : usd(available)}>
              {available == null ? "—" : money(available)}
            </p>
            {available != null && <p className="ln-exact">{usd(available)} exactly, ready to pay hospitals</p>}
          </div>
          <Link href="/fund" className="ln-btn ln-btn-primary ln-fund-cta">
            View ledger <Icon name="arrowRight" />
          </Link>
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

        <section className="ln-card ln-claims" aria-labelledby="ln-claims-title">
          <div className="ln-head">
            <h2 id="ln-claims-title">Latest claims paid</h2>
            <Link href="/fund" className="ln-link">
              See every claim <Icon name="arrowUpRight" />
            </Link>
          </div>
          {claims.length > 0 ? (
            <ul className="ln-claim-list">
              {claims.map((c) => (
                <li key={c.reference}>
                  <Link href="/fund" className="ln-claim-row">
                  <DonorMark id={logoIdForName(c.hospital)} name={cleanName(c.hospital ?? "Hospital")} kind="hospital" />
                  <span className="ln-claim-what">
                    <strong>{cleanName(c.hospital ?? "Hospital")}</strong>
                    <small>
                      {c.category ? CATEGORY_LABEL[c.category] : "Visit"}
                      {c.region ? ` · ${c.region}` : ""} · {new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
          <p className="ln-fine">The ledger shows each claim&rsquo;s itemized bill, what insurance and the hospital covered, the decision and its devnet receipt. Names, birth dates and SSNs are never shown.</p>
        </section>
      </main>

      <footer className="ln-foot">
        Independent hackathon prototype. Not affiliated with or endorsed by any political figure, hospital, insurer or
        government program. Fictional data, Capital One Nessie mock banking and Solana devnet.
      </footer>
    </div>
  );
}
