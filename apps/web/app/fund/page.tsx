import { redirect } from "next/navigation";

export default function FundPage() {
  redirect("/review?view=ledger");
}
