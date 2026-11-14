import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { TapRings } from "@/components/TapRings";
import { LIVE } from "@/lib/api";

export const metadata: Metadata = { title: "Patient kiosk" };

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ ended?: string }>;
}) {
  const { ended } = await searchParams;

  return (
    <main className="page station station-welcome">
      <header className="station-bar">
        <Logo href={null} />
        <Link href="/review" className="btn secondary">Admin</Link>
      </header>
      <div className="station-intro">
        <h1>Tap your CareCard</h1>
        <p>Find a medical bill or check a request.</p>
      </div>
      <section className="station-tap" aria-label="Card instructions">
        <TapRings size={156} />
        <p>Hold your card near the top of this device and open the link that appears.</p>
        {ended && <p className="station-message" role="status">Your session has ended.</p>}
        {!LIVE && (
          <Link className="btn" href="/t/demo">
            Try a demo card <Icon name="arrowRight" />
          </Link>
        )}
      </section>
      <footer className="station-foot">
        <Icon name="lock" /> Your session is private and ends automatically.
      </footer>
    </main>
  );
}
