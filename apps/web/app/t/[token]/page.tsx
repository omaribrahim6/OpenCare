import { TapLanding } from "./TapLanding";

// Card tap landing: the NFC CareCard opens /t/<token>. Covers the patient session, provider
// redemption, unknown card, and unpaired phone (screen 8) states.
export default async function TapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TapLanding token={token} />;
}
