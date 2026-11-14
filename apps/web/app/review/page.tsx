import { CaseworkerQueue } from "./CaseworkerQueue";

// Screen 5: Caseworker queue in Gemini's rank order (SPEC rev 5 §4, §7 job 3).
export default async function CaseworkerQueuePage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return (
    <main className="page wide">
      <p className="muted">Caseworker</p>
      <h1>Requests ranked by need</h1>
      <CaseworkerQueue formulaPreview={order === "formula"} />
    </main>
  );
}
