import Link from "next/link";

// Index of every screen for the team and the pitch. Not part of the patient flow.
const SCREENS = [
  ["/", "1. Welcome / check-in"],
  ["/t/demo", "Card tap: known patient (paired kiosk)"],
  ["/t/unknown", "Card tap: unknown card"],
  ["/t/unpaired", "9. Card tap on an unpaired phone"],
  ["/kiosk/bills", "2. Bills found"],
  ["/kiosk/scan", "3. Capture / review"],
  ["/kiosk/explain", "4. Explanation / options"],
  ["/kiosk/status", "5. Request status"],
  ["/review", "6. Reviewer console"],
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
