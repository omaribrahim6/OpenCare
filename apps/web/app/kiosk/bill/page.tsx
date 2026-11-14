import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { KioskSession } from "@/components/KioskSession";
import { BillView } from "./BillView";
import "./patient.css";

export const metadata: Metadata = { title: "My visits" };

export default async function BillPage({ searchParams }: {
  searchParams: Promise<{ visit?: string; view?: string; demo?: string }>;
}) {
  const { visit, view, demo } = await searchParams;
  const isDemo = demo === "1";
  const insurance = view === "insurance";
  const navigation = (
    <nav className="d-nav patient-desk-nav" aria-label="Patient">
      <Link href={isDemo ? "/kiosk/bill?demo=1" : "/kiosk/bill"} aria-current={!insurance ? "page" : undefined}>
        <Icon name="bill" /> My visits
      </Link>
      <Link href={isDemo ? "/kiosk/bill?view=insurance&demo=1" : "/kiosk/bill?view=insurance"} aria-current={insurance ? "page" : undefined}>
        <Icon name="shield" /> Insurance
      </Link>
    </nav>
  );
  return (
    <KioskSession demo={isDemo} step={0} totalSteps={0} navigation={navigation} title={insurance ? "Insurance" : "My visits"}>
      <BillView key={demo} demo={demo === "1"} visitId={visit} showInsurance={view === "insurance"} />
    </KioskSession>
  );
}
