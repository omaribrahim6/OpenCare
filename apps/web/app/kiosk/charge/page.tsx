import type { Metadata, Viewport } from "next";
import { kioskFonts } from "../tap/fonts";
import { ChargeFlow } from "./ChargeFlow";
import "../tap/tap.css";
import "./charge.css";

export const metadata: Metadata = { title: "Charge patient" };
export const viewport: Viewport = { themeColor: "#edeefc" };

// Hospital staff build the itemized bill and run the discount search, then the patient taps a
// phone or card to pay. The receipt goes to /admin.
export default function ChargePage() {
  return (
    <div className={kioskFonts}>
      <ChargeFlow />
    </div>
  );
}
