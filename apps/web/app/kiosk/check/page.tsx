import type { Metadata } from "next";
import { KioskSession } from "@/components/KioskSession";
import { BillWalk } from "./BillWalk";
import "./check.css";

export const metadata: Metadata = { title: "Your bill" };

// Where a kiosk card tap lands (SPEC §4, screen 2): the bill shrinking step by step.
export default async function CheckPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const isDemo = demo === "1";
  return (
    <KioskSession demo={isDemo} step={0} totalSteps={0}>
      <BillWalk demo={isDemo} />
    </KioskSession>
  );
}
