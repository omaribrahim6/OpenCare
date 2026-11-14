import type { Metadata } from "next";
import { Desk } from "./Desk";

export const metadata: Metadata = { title: "Review queue" };

// Caseworker desk. ?order=formula previews the formula-order fallback in mock mode.
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return <Desk formulaPreview={order === "formula"} />;
}
