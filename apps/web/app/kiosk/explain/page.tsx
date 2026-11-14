import Link from "next/link";
import { KioskSession } from "@/components/KioskSession";
import { ReadAloud } from "@/components/ReadAloud";
import { formatCents, getExplanation } from "@/lib/mock";

// Screen 4: Explanation / request.
export default async function ExplainRequest({ searchParams }: { searchParams: Promise<{ bill?: string }> }) {
  const { bill } = await searchParams;
  const ex = await getExplanation(bill);
  const amount = formatCents(ex.amountCents);

  return (
    <KioskSession step={2} totalSteps={3}>
      <h1>About this bill</h1>
      <div className="card">
        <p className="big">{amount}</p>
        <p>{ex.summary}</p>
        <ReadAloud text={`This bill is ${amount}. ${ex.summary}`} />
      </div>

      <h2>What the fund can do</h2>
      <div className="card">
        <p>
          If your request is approved, the fund pays <strong>{ex.provider.name}</strong> directly. You won&apos;t
          handle any money.
        </p>
        <p className="muted">
          The fund has a limited budget, so a person reviews requests and helps those with the greatest need first.
          Approval isn&apos;t guaranteed.
        </p>
        <Link className="btn block" href="/kiosk/status?new=1">
          Request help with {amount}
        </Link>
      </div>
      <Link className="btn secondary block" href="/kiosk/bills">
        Pick a different bill
      </Link>
    </KioskSession>
  );
}
