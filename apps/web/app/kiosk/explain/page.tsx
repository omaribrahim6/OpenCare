import Link from "next/link";
import { KioskSession } from "@/components/KioskSession";
import { ReadAloud } from "@/components/ReadAloud";
import { chooseBill, formatCents } from "@/lib/mock";
import { RequestHelpForm } from "./RequestHelpForm";

// Screen 3: Explanation / request.
export default async function ExplainRequest({ searchParams }: { searchParams: Promise<{ bill?: string }> }) {
  const { bill } = await searchParams;
  const { document, explanation: ex, provider } = await chooseBill(bill);
  const amount = formatCents(document.amountCents);
  const spoken = [`This bill is ${amount}.`, ex.summary, ...ex.points].join(" ");

  return (
    <KioskSession step={2} totalSteps={3}>
      <h1>About this bill</h1>
      <div className="card">
        <p className="big">{amount}</p>
        <p>{ex.summary}</p>
        <ul>
          {ex.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {ex.questionsToAsk.length > 0 && (
          <>
            <h3>Questions you could ask</h3>
            <ul>
              {ex.questionsToAsk.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </>
        )}
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {ex.disclaimer}
        </p>
        <ReadAloud text={spoken} />
      </div>

      <h2>What the fund can do</h2>
      <div className="card">
        <p>
          If your request is approved, the fund pays <strong>{provider.name}</strong> directly. You won&apos;t
          handle any money.
        </p>
        <p className="muted">
          The fund has a limited budget, so a person reviews requests and helps those with the greatest need first.
          Approval isn&apos;t guaranteed.
        </p>
        <RequestHelpForm amountLabel={amount} />
      </div>
      <Link className="btn secondary block" href="/kiosk/bills">
        Pick a different bill
      </Link>
    </KioskSession>
  );
}
