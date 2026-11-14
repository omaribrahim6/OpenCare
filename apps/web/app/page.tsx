import Link from "next/link";

// Screen 1: Welcome / check-in.
export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<{ ended?: string }>;
}) {
  const { ended } = await searchParams;
  return (
    <main className="page" style={{ textAlign: "center" }}>
      {ended && (
        <p className="card" role="status">
          {ended === "idle"
            ? "Your session ended because the kiosk was idle. Your information has been cleared."
            : "Your session has ended. Your information has been cleared."}
        </p>
      )}
      <h1 style={{ marginTop: 32 }}>Welcome to AbdulCare</h1>
      <p className="muted">Tap your card. Understand your bill. Get help paying for care.</p>

      <div className="tap-target" aria-hidden="true" />
      <p className="big" style={{ fontSize: "1.8rem" }}>
        Tap your CareCard on the back of this phone
      </p>
      <p className="muted">Hold it still for a second. A page will open on its own.</p>

      <details className="card" style={{ textAlign: "left", marginTop: 32 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Card not working?</summary>
        <p style={{ marginTop: 12 }}>
          Scan the QR code on the back of your card, or ask staff for help checking in.
        </p>
        <Link className="btn secondary" href="/t/demo">
          Staff: manual check-in (demo patient)
        </Link>
      </details>
    </main>
  );
}
