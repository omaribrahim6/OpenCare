import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteNav";
import { ProofView } from "./ProofView";
import "./proof.css";

export const metadata: Metadata = {
  title: "Verify the fund",
  description: "Check every dollar of the OpenCare Community Fund yourself: Nessie holds the money, Solana holds the rules and the proof.",
};

/** Public: anyone can check the fund without trusting us. No patient data. */
export default function ProofPage() {
  return (
    <main className="pf">
      <SiteHeader current="proof" />
      <ProofView />
    </main>
  );
}
