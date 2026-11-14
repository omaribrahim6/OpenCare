import type { Metadata } from "next";
import { Desk } from "./Desk";

export const metadata: Metadata = { title: "Fund admin" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const initialView = view === "ledger" ? "ledger" : view === "fund" ? "fund" : "queue";
  return <Desk key={initialView} initialView={initialView} />;
}
