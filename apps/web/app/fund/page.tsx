import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FundWorkspace } from "../admin/FundWorkspace";

export const metadata: Metadata = { title: "Public ledger" };

/** Public audit ledger (SPEC §2): anyone can open it, no sign-in. Only "Reveal identity" needs a reviewer device, enforced by the API. */
export default function PublicLedgerPage() {
  return (
    <main className="d-public">
      <header className="d-public-bar">
        <Logo />
        <nav className="oc-nav" aria-label="Main">
          <Link href="/">Home</Link>
          <Link href="/kiosk">Patient portal</Link>
          <Link href="/admin" className="oc-nav-staff">
            Staff
          </Link>
        </nav>
      </header>
      <FundWorkspace initialTab="ledger" />
    </main>
  );
}
