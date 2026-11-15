import type { Metadata, Viewport } from "next";
import { CardCheck } from "./CardCheck";
import "../../check/check.css";
import "../charge.css";

export const metadata: Metadata = { title: "Your bill" };
export const viewport: Viewport = { themeColor: "#eaf2ff" };

// The page a card scan opens. The presenter's hold on the reader adds ?via=hold; the NFC scan
// opens it as is.
export default async function CardPage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  return <CardCheck method={via === "hold" ? "hold" : "nfc"} />;
}
