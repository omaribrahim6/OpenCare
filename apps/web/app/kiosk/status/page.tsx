import { redirect } from "next/navigation";

// Revision 6: the status lives on the bill page.
export default function StatusPage() {
  redirect("/kiosk/bill");
}
