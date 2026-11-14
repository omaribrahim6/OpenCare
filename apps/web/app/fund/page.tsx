import { redirect } from "next/navigation";

// The public fund dashboard now lives at the site root.
export default function FundPage() {
  redirect("/");
}
