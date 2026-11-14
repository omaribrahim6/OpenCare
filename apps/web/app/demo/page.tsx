import Link from "next/link";

// Index of every screen for the team and the pitch. Not part of the patient flow.
const SCREENS = [
  ["/", "1. Welcome / check-in"],
  ["/t/demo", "Card tap: known patient (paired kiosk)"],
  ["/t/unknown", "Card tap: unknown card"],
  ["/t/unpaired", "9. Card tap on an unpaired phone"],
  ["/kiosk/bills", "2. Bills found"],
  ["/kiosk/explain", "3–4. Explanation / request"],
  ["/kiosk/status", "5. Request status"],
  ["/review", "6. Reviewer queue (ranked by need)"],
  ["/provider", "7. Provider terminal"],
  ["/fund", "8. Fund dashboard"],
] as const;

export default function DemoIndex() {
  return (
    <main className="page">
      <h1>All screens</h1>
      <p className="muted">Shells with mock data.</p>
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {SCREENS.map(([href, label]) => (
          <li key={href}>
            <Link className="btn secondary block" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
