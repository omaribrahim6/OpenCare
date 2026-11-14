import { redirect } from "next/navigation";

export default function FundPage() {
  redirect("/admin?view=ledger");
}
