import { listPendingGrants } from "@/lib/mock";
import { ReviewPanel } from "./ReviewPanel";

// Screen 6: Reviewer console.
export default async function ReviewerConsole() {
  const grants = await listPendingGrants();
  return (
    <main className="page wide">
      <p className="muted">Fund reviewer · signed in (mock)</p>
      <h1>Requests to review</h1>
      {grants.length === 0 ? (
        <p className="card">Nothing waiting for review.</p>
      ) : (
        grants.map((g) => <ReviewPanel key={g.id} grant={g} />)
      )}
    </main>
  );
}
