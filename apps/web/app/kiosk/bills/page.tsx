import Link from "next/link";
import { KioskSession } from "@/components/KioskSession";
import { formatCents, getBills } from "@/lib/mock";
import { CATEGORY_LABEL } from "@/lib/types";

// Screen 2: Bills found. Bills come only from the linked Nessie account (SPEC rev 4).
export default async function BillsFound() {
  const bills = await getBills();
  const medical = bills.filter((b) => b.likelyMedical);
  const other = bills.filter((b) => !b.likelyMedical);

  return (
    <KioskSession step={1} totalSteps={3}>
      <h1>Bills we found</h1>
      <p className="muted">
        From your linked bank account. We marked the ones that look medical. Pick the one you want help with.
      </p>

      {medical.length === 0 && (
        <p className="card">We didn&apos;t find any medical bills. Ask staff if you think one is missing.</p>
      )}

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
              {b.date ?? "No date"} ·{" "}
              <span className="badge info">{b.category ? CATEGORY_LABEL[b.category] : "Medical"}</span>
              <br />
              Why: {b.reason}
            </p>
            <Link className="btn block" href={`/kiosk/explain?bill=${encodeURIComponent(b.id)}`}>
              Get help with this bill
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
    </KioskSession>
  );
}
