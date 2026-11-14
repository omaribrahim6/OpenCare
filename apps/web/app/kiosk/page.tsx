import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { DemoButton } from "./DemoButton";

export const metadata: Metadata = { title: "Patient portal" };

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ ended?: string }>;
}) {
  const { ended } = await searchParams;

  return (
    <main className="page station portal-screen">
      <header className="station-bar">
        <Logo href={null} />
        <Link href="/review" className="btn secondary">Staff admin</Link>
      </header>
      <div className="portal-intro">
        <h1>Patient portal</h1>
        <p>See your hospital visits, check what’s covered, and request help with a bill.</p>
      </div>
      <section className="portal-panel portal-card-entry">
        <span className="portal-entry-icon"><Icon name="tap" size={24} /></span>
        <div>
          <h2>Open your visits</h2>
          <p>Tap your CareCard on a clinic’s check-in device and open the link that appears.</p>
        </div>
      </section>
      <section className="portal-panel portal-demo-entry">
        <div>
          <h2>Explore the demo</h2>
          <p>Use sample visits to try the patient flow without a card.</p>
        </div>
        <DemoButton />
      </section>
      {ended && <p role="status">Your session has ended.</p>}
    </main>
  );
}
