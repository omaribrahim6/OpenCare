import type { Metadata } from "next";
import { KioskSession } from "@/components/KioskSession";
import { BillView } from "./BillView";
import "./patient.css";

export const metadata: Metadata = { title: "My visits" };

export default async function BillPage({ searchParams }: {
  searchParams: Promise<{ visit?: string; view?: string }>;
}) {
  const { visit, view } = await searchParams;
  return (
    <KioskSession step={0} totalSteps={0}>
      <BillView visitId={visit} showInsurance={view === "insurance"} />
    </KioskSession>
  );
}
