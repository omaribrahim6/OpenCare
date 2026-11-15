import type { Metadata, Viewport } from "next";
import { kioskFonts } from "../tap/fonts";
import { ChargeFlow } from "./ChargeFlow";
import "../tap/tap.css";
import "./charge.css";

export const metadata: Metadata = { title: "Charge patient" };
// Full-bleed on iPhone (and in the kiosk app): the pages pad for the notch and Dynamic Island
// themselves, and the colour behind them matches the page.
export const viewport: Viewport = { themeColor: "#f4f5fb", viewportFit: "cover" };

// Hospital staff build the itemized bill and run the discount search, then the patient taps a
// phone or card to pay. The receipt goes to /admin.
export default function ChargePage() {
  return (
    <div className={kioskFonts}>
      <ChargeFlow />
    </div>
  );
}
