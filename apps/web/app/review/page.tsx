import { formatCents, getReviewQueue } from "@/lib/mock";
import { ReviewQueue } from "./ReviewQueue";

// Screen 5: Caseworker queue in Gemini's rank order (SPEC rev 5 §4, §7 job 3).
export default async function CaseworkerQueue({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  const queue = await getReviewQueue(order === "formula");
  const totalRequested = queue.items.reduce((sum, it) => sum + it.requestedCents, 0);

  return (
    <main className="page wide">
      <p className="muted">Caseworker · signed in (mock)</p>
      <h1>Requests ranked by need</h1>

      <div className="budget-bar card" role="group" aria-label="Fund budget">
        <div>
          <div className="muted">Available to grant</div>
          <div className="big">{formatCents(queue.availableCents)}</div>
        </div>
        <div>
          <div className="muted">Requested in this queue</div>
          <div className="big" style={{ fontSize: "1.6rem" }}>
            {formatCents(totalRequested)}
          </div>
        </div>
        <div>
          <div className="muted">Order</div>
          {queue.order === "gemini" ? (
            <span className="badge info">Ranked by Gemini</span>
          ) : (
            <span className="badge warn">Formula order</span>
          )}
        </div>
      </div>

      <p className="muted">
        {queue.order === "gemini"
          ? "Gemini compared these requests using anonymized factor values only. The formula score sits beside each rank so you can see where they differ."
          : "Gemini's ranking wasn't available or didn't pass its checks, so requests are in formula order with standard explanations."}{" "}
        The order is a recommendation. You decide every grant and can open any request in any order.
      </p>

      {queue.items.length === 0 ? (
        <p className="card">Nothing waiting for review.</p>
      ) : (
        <ReviewQueue items={queue.items} order={queue.order} availableCents={queue.availableCents} />
      )}
    </main>
  );
}
