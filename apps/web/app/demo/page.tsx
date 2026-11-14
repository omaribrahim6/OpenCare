import Link from "next/link";

// Index of every screen for the team and the pitch. Not part of the patient flow.
const SCREENS = [
  ["/pair", "Staff: set up this device (pairing)"],
  ["/kiosk", "1. Welcome / check-in"],
  ["/t/demo", "Card tap: known patient (paired kiosk)"],
  ["/t/unknown", "Card tap: unknown card"],
  ["/t/unpaired", "8. Card tap on an unpaired phone"],
  ["/t/provider", "Card tap on a provider terminal (mock)"],
  ["/kiosk/bills", "2. Bills found"],
  ["/kiosk/explain", "3. Explanation / request"],
  ["/kiosk/status", "4. Request status"],
  ["/review", "5. Caseworker queue (Gemini order)"],
  ["/review?order=formula", "5b. Caseworker queue (formula fallback)"],
  ["/provider", "6. Provider terminal"],
  ["/fund", "7. Fund dashboard (donate)"],
] as const;

export default function DemoIndex() {
  return (
    <main className="page station station-demo">
      <h1>All screens</h1>
      <p className="muted">Live mode uses the real API and needs a paired device; mock tokens (demo, provider, unpaired) only work in mock mode.</p>
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
