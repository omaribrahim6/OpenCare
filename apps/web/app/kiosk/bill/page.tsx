import type { Metadata } from "next";
import { KioskSession } from "@/components/KioskSession";
import { BillView } from "./BillView";
import "./patient.css";

export const metadata: Metadata = { title: "My visits" };

export default async function BillPage({ searchParams }: {
  searchParams: Promise<{ visit?: string; view?: string; demo?: string }>;
}) {
  const { visit, view, demo } = await searchParams;
  return (
    <KioskSession demo={demo === "1"} step={0} totalSteps={0}>
      <BillView key={demo} demo={demo === "1"} visitId={visit} showInsurance={view === "insurance"} />
    </KioskSession>
  );
}
