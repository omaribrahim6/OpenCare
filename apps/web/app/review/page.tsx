import { getReviewQueue } from "@/lib/mock";
import { ReviewQueue } from "./ReviewQueue";

// Screen 6: Reviewer queue, ranked by need score (SPEC rev 4 §4, §7).
export default async function ReviewerConsole() {
  const queue = await getReviewQueue();
  return (
    <main className="page wide">
      <p className="muted">Fund reviewer · signed in (mock)</p>
      <h1>Requests ranked by need</h1>
      <p className="muted">
        The order is a recommendation from a fixed, auditable formula. You decide every grant and can open any request in
        any order.
      </p>
      {queue.length === 0 ? <p className="card">Nothing waiting for review.</p> : <ReviewQueue items={queue} />}
    </main>
  );
}
