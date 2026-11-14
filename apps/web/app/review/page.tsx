import type { Metadata } from "next";
import { Desk } from "./Desk";

export const metadata: Metadata = { title: "Review queue" };

export default function ReviewPage() {
  return <Desk />;
}
