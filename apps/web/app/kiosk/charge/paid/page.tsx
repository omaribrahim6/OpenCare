import { redirect } from "next/navigation";

// The card scan used to open /kiosk/charge/paid. It now opens /kiosk/charge/card, which checks the
// bill before anything is paid; keep old links and NFC tags working.
export default async function PaidPage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  redirect(via === "hold" ? "/kiosk/charge/card?via=hold" : "/kiosk/charge/card");
}
