import type { Metadata } from "next";
import { KioskSession } from "@/components/KioskSession";
import { BillView } from "./BillView";

export const metadata: Metadata = { title: "Your bill" };

// Patient app: the hospital bill after insurance and hospital assistance, the fund request, and the result.
export default async function BillPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <KioskSession step={0} totalSteps={0}>
      <BillView justSent={Boolean(sent)} />
    </KioskSession>
  );
}
