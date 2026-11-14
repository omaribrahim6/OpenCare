import Link from "next/link";

// Index of every screen for the team and the pitch. Not part of the patient flow.
const SCREENS = [
  ["/pair", "Staff: set up this device (pairing)"],
  ["/intake", "Hospital staff: log a visit"],
  ["/t/hospital", "Card tap on a hospital device (mock)"],
  ["/kiosk", "Patient: welcome / tap your CareCard"],
  ["/t/demo", "Card tap on the patient kiosk"],
  ["/review", "Fund admin: review queue"],
  ["/t/unknown", "Card tap: unknown card"],
  ["/t/unpaired", "Card tap on an unpaired phone"],
  ["/", "Public: community fund"],
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
