import type { Metadata } from "next";
import { UserPortal } from "./UserPortal";
import "./user.css";

export const metadata: Metadata = { title: "My account" };

/** /user: the patient's own account on their phone. ?card=<token> comes from a CareCard tap. */
export default async function UserPage({ searchParams }: { searchParams: Promise<{ card?: string | string[] }> }) {
  const { card } = await searchParams;
  return <UserPortal cardToken={typeof card === "string" && card ? card : null} />;
}
