import { ProviderTerminal } from "./ProviderTerminal";

// Screen 6: Provider terminal (redemption after the patient's card tap).
export default async function ProviderPage({ searchParams }: { searchParams: Promise<{ grant?: string }> }) {
  const { grant } = await searchParams;
  return <ProviderTerminal grantId={grant ?? null} />;
}
