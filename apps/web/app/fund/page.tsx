import { formatCents, getFundSummary } from "@/lib/mock";

// Screen 8: Fund dashboard. Aggregates only; no patient-level information.
export default async function FundDashboard() {
  const s = await getFundSummary();
  const tiles = [
    { label: "Donated", value: formatCents(s.contributionsCents) },
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
      <div className="grid2">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="muted">{t.label}</div>
            <div className="big">{t.value}</div>
          </div>
        ))}
      </div>

      <h2>Public ledger</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Reference</th>
              <th scope="col">Signature</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {s.ledger.map((e) => (
              <tr key={e.reference}>
                <td>{e.kind === "payout" ? "Payout" : "Donation"}</td>
                <td><code>{e.reference}</code></td>
                <td><code>{e.signature}</code></td>
                <td>{new Date(e.at).toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
