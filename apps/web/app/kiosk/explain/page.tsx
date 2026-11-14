import Link from "next/link";
import { KioskSession } from "@/components/KioskSession";
import { formatCents, getExplanation } from "@/lib/mock";

// Screen 4: Explanation / options.
export default async function ExplainOptions() {
  const ex = await getExplanation();
  const fits = ex.matches.filter((m) => m.possibleFit);
  const others = ex.matches.filter((m) => !m.possibleFit);

  return (
    <KioskSession step={3}>
      <h1>What this bill is</h1>
      <div className="card">
        <p className="big">{formatCents(ex.amountCents)}</p>
        <p style={{ marginBottom: 0 }}>{ex.summary}</p>
      </div>

      <h2>Help you might be able to get</h2>
      <p className="muted">These are possible matches, not a promise. A person reviews every request.</p>

      {fits.map((m) => (
        <div key={m.programId} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{m.name}</strong>
            <span className="badge ok">
              <span aria-hidden="true">✓</span> Possible fit
            </span>
          </div>
          <ul>
            {m.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {m.missingInfo.length > 0 && <p className="muted">Still needed: {m.missingInfo.join(", ")}</p>}
          <Link className="btn block" href="/kiosk/status?new=1">
            Ask for {formatCents(Math.min(ex.amountCents, m.maxCents))} from this fund
          </Link>
        </div>
      ))}

      {others.length > 0 && (
        <details className="card">
          <summary style={{ cursor: "pointer" }}>Programs that don&apos;t fit ({others.length})</summary>
          {others.map((m) => (
            <div key={m.programId} style={{ marginTop: 12 }}>
              <strong>{m.name}</strong>
              <ul>
                {m.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </KioskSession>
  );
}
