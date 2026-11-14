import Link from "next/link";
import { KioskSession } from "@/components/KioskSession";
import { formatCents, getBills } from "@/lib/mock";

// Screen 2: Bills found (P1).
export default async function BillsFound() {
  const bills = await getBills();
  const medical = bills.filter((b) => b.likelyMedical);
  const other = bills.filter((b) => !b.likelyMedical);

  return (
    <KioskSession step={1}>
      <h1>Bills we found</h1>
      <p className="muted">
        From your linked bank account. We marked the ones that look medical. Pick the one you want help with.
      </p>

      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {medical.map((b) => (
          <li key={b.id} className="card" style={{ marginBottom: 0 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{b.merchant}</strong>
              <span className="big" style={{ fontSize: "1.4rem" }}>
                {formatCents(b.amountCents)}
              </span>
            </div>
            <p className="muted" style={{ margin: "4px 0 12px" }}>
              {b.date} · <span className="badge info">Looks medical</span>
              <br />
              Why: {b.reason}
            </p>
            <Link className="btn block" href={`/kiosk/scan?bill=${b.id}`}>
              Use this bill
            </Link>
          </li>
        ))}
      </ul>

      {other.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer" }}>Other purchases ({other.length})</summary>
          <ul>
            {other.map((b) => (
              <li key={b.id}>
                {b.merchant}, {formatCents(b.amountCents)}: {b.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Link className="btn secondary block" href="/kiosk/scan">
        Scan a paper bill instead
      </Link>
    </KioskSession>
  );
}
