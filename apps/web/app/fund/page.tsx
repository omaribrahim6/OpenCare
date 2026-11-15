import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteNav";
import { FundWorkspace } from "../admin/FundWorkspace";

export const metadata: Metadata = { title: "Public ledger" };

/** Public audit ledger (SPEC §2): anyone can open it, no sign-in. Only "Reveal identity" needs a reviewer device, enforced by the API. */
export default function PublicLedgerPage() {
  return (
    <main className="d-public">
      <SiteHeader current="ledger" />
      <FundWorkspace initialTab="ledger" audience="public" />
    </main>
  );
}
