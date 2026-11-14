import Link from "next/link";
import { resolveTap } from "@/lib/mock";

// Card tap landing. Screen 9 (unpaired phone) and the unknown-card state live here too.
export default async function TapLanding({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolveTap(token);

  if (result.kind === "unpaired_device") {
    return (
      <main className="page" style={{ textAlign: "center" }}>
        <div className="tap-target" aria-hidden="true" />
        <h1>Tap at a participating kiosk</h1>
        <p className="muted">
          This is an AbdulCare CareCard. To use it, tap it on the kiosk phone at a participating clinic or
          pharmacy. No information is shown on this device.
        </p>
      </main>
    );
  }

  if (result.kind === "unknown_card") {
    return (
      <main className="page">
        <h1>We don&apos;t recognize this card</h1>
        <p>This card isn&apos;t linked to anyone yet, or it has been turned off.</p>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>What to do</h2>
          <p>Ask a staff member to help you enroll or get a replacement card.</p>
          <Link className="btn secondary" href="/">
            Back to start
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <p className="muted">Checked in</p>
      <h1>Hi, {result.patient.displayName}</h1>
      <p>Let&apos;s find the bill you want help with.</p>
      <div className="stack">
        <Link className="btn block" href="/kiosk/bills">
          Find my medical bills
        </Link>
        <Link className="btn secondary block" href="/kiosk/status">
          Check a request I already made
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 24 }}>
        Not you? <Link href="/?ended=user">End session</Link>
      </p>
    </main>
  );
}
