import type { Metadata } from "next";
import { IntakeTerminal } from "./IntakeTerminal";

export const metadata: Metadata = { title: "Hospital intake" };

export default function IntakePage() {
  return <IntakeTerminal />;
}
