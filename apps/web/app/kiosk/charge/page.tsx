import type { Metadata, Viewport } from "next";
import { ChargeFlow } from "./ChargeFlow";
import "./charge.css";

export const metadata: Metadata = { title: "Charge patient" };
export const viewport: Viewport = { themeColor: "#eaf2ff" };

// Hospital staff build the itemized bill and run the discount search, then the patient taps a
// phone or card to pay. The receipt goes to /admin.
export default function ChargePage() {
  return <ChargeFlow />;
}
