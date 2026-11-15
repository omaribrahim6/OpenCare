import type { Metadata, Viewport } from "next";
import { PaidReceipt } from "./PaidReceipt";
import "../charge.css";

export const metadata: Metadata = { title: "Payment received" };
export const viewport: Viewport = { themeColor: "#eaf2ff" };

// The page a card scan opens. Both the presenter's hold on the reader
// (?via=hold) and the NFC scan land here, so the scan can simply open this URL.
export default async function PaidPage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  return <PaidReceipt method={via === "hold" ? "hold" : "nfc"} />;
}
