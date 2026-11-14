import { KioskSession } from "@/components/KioskSession";
import { RequestStatus } from "./RequestStatus";

// Screen 4: Request status.
export default async function RequestStatusPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: isNew } = await searchParams;
  return (
    <KioskSession step={3} totalSteps={3}>
      <RequestStatus justSent={Boolean(isNew)} />
    </KioskSession>
  );
}
