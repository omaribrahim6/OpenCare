import { KioskSession } from "@/components/KioskSession";
import { ExplainBill } from "./ExplainBill";

// Screen 3: Explanation / request.
export default async function ExplainRequest({
  searchParams,
}: {
  searchParams: Promise<{ bill?: string; source?: string }>;
}) {
  const { bill, source } = await searchParams;
  return (
    <KioskSession step={2} totalSteps={3}>
      <ExplainBill billId={bill ?? ""} source={source === "nessie_purchase" ? "nessie_purchase" : "nessie_bill"} />
    </KioskSession>
  );
}
