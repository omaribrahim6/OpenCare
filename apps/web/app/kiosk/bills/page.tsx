import { KioskSession } from "@/components/KioskSession";
import { BillsList } from "./BillsList";

// Screen 2: Bills found. Bills come only from the linked Nessie account.
export default function BillsFound() {
  return (
    <KioskSession step={1} totalSteps={3}>
      <h1>Bills we found</h1>
      <p className="muted">
        From your linked bank account. We marked the ones that look medical. Pick the one you want help with.
      </p>
      <BillsList />
    </KioskSession>
  );
}
