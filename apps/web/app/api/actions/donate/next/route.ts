// The Blink's `next` callback: after the donor's wallet sends the transfer it POSTs { account,
// signature } here. The gift is verified against the treasury, recorded once, and the wallet shows a
// completed card with the public receipt.

import { NextResponse } from "next/server";
import { CoreError } from "@abdulcare/core";
import { ACTION_HEADERS, confirmDonationRequest } from "@abdulcare/payments";
import { baseUrl, centsPerDevnetSol, rails, requireSolana } from "@/app/api/_lib/rails";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: ACTION_HEADERS });
}

export async function POST(req: Request) {
  const icon = `${baseUrl(req)}/kiosk-icon-512.png`;
  try {
    const reference = new URL(req.url).searchParams.get("reference") ?? "";
    const body = (await req.json().catch(() => ({}))) as { signature?: string };
    const deps = rails();
    requireSolana(deps);
    const result = await confirmDonationRequest(deps, { reference, signature: body.signature, fallbackCentsPerSol: centsPerDevnetSol() });
    const dollars = result.usdCents ? `$${(result.usdCents / 100).toFixed(2)}` : "Your gift";
    return NextResponse.json(
      {
        type: "completed",
        icon,
        title: result.status === "confirmed" ? "Thank you" : "Almost there",
        description:
          result.status === "confirmed"
            ? `${dollars} reached the OpenCare Community Fund. It's on the public ledger at ${baseUrl(req)}/fund.`
            : "Your transfer hasn't confirmed yet. It will show on the public ledger once it does.",
        label: "Done",
      },
      { headers: ACTION_HEADERS },
    );
  } catch (err) {
    const message = err instanceof CoreError ? err.message : "The donation couldn't be confirmed";
    return NextResponse.json({ message }, { status: 400, headers: ACTION_HEADERS });
  }
}
