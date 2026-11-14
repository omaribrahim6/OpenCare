import { formatCents, getFundRules, getFundSummary } from "@/lib/mock";
import { DonateButton } from "./DonateButton";

// Screen 7: Fund dashboard. Aggregates only; no patient-level information.
export default async function FundDashboard() {
  const [s, rules] = await Promise.all([getFundSummary(), getFundRules()]);
  const tiles = [
    { label: "Donated", value: formatCents(s.totalCents) },
    { label: "Available", value: formatCents(s.availableCents) },
    { label: "Reserved for approved grants", value: formatCents(s.reservedCents) },
    { label: `Paid out (${s.paidCount} grants)`, value: formatCents(s.paidCents) },
  ];

  return (
    <main className="page wide">
      <h1>Community care fund</h1>
      <p className="muted">
        Every donation and payout has a public test receipt on Solana devnet. Receipts carry only an opaque
        reference, never patient information.
      </p>
      <div style={{ marginBottom: 16 }}>
        <DonateButton />
      </div>
      <div className="grid2">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="muted">{t.label}</div>
            <div className="big">{t.value}</div>
          </div>
        ))}
      </div>

      <h2>How the fund decides</h2>
      <div className="card">
        <p>
          A caseworker reviews every request in private and decides each grant. The rules below are public, so anyone can
          see how requests are prioritized.
        </p>
        <ul>
          <li>Largest single grant: {formatCents(rules.perGrantCapCents)}</li>
          <li>Grants over {formatCents(rules.secondApprovalOverCents)} need a second caseworker&apos;s approval</li>
          <li>The queue is ordered by need; the formula (version {rules.formulaVersion}) weighs:</li>
        </ul>
        <table>
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">What it measures</th>
              <th scope="col" style={{ textAlign: "right" }}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {rules.weights.map((w) => (
              <tr key={w.label}>
                <td>{w.label}</td>
                <td>{w.measures}</td>
                <td style={{ textAlign: "right" }}>{w.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Names, age, sex, race, ethnicity, religion, nationality, immigration status, disability and diagnosis are never
          used.
        </p>
      </div>

      <h2>Public ledger</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Reference</th>
              <th scope="col">Amount</th>
              <th scope="col">Signature</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {s.recent.map((e) => (
              <tr key={e.reference}>
                <td>{e.type[0].toUpperCase() + e.type.slice(1)}</td>
                <td><code>{e.reference}</code></td>
                <td>{formatCents(e.amountCents)}</td>
                <td><code>{e.solanaSignature ?? "—"}</code></td>
                <td>{new Date(e.at).toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
