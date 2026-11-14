import type { Metadata } from "next";
import { IntakeTerminal } from "./IntakeTerminal";

export const metadata: Metadata = { title: "Hospital intake" };

// Admin side, simulated hospital staff: log a visit for the patient whose CareCard was tapped here.
export default function IntakePage() {
  return <IntakeTerminal />;
}
