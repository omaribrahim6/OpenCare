// Solana Action (Blink) for donations: GET returns what a wallet or Blink client shows, POST builds
// the donor → treasury transfer for the donor's wallet to sign. Share
// https://dial.to/?action=solana-action:<site>/api/actions/donate&cluster=devnet to try it.

import { NextResponse } from "next/server";
import { CoreError } from "@abdulcare/core";
import { ACTION_HEADERS, buildDonateAction, donateActionMetadata } from "@abdulcare/payments";
import { baseUrl, centsPerDevnetSol, rails, requireSolana } from "@/app/api/_lib/rails";

export const dynamic = "force-dynamic";

function actionError(err: unknown) {
  const message = err instanceof CoreError ? err.message : "The donation couldn't be prepared";
  if (!(err instanceof CoreError)) console.error("[api] blink failed:", err);
  return NextResponse.json({ message }, { status: 400, headers: ACTION_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: ACTION_HEADERS });
}

export function GET(req: Request) {
  return NextResponse.json(donateActionMetadata(baseUrl(req)), { headers: ACTION_HEADERS });
}

export async function POST(req: Request) {
  try {
    const amount = Number(new URL(req.url).searchParams.get("amount"));
    const body = (await req.json().catch(() => ({}))) as { account?: string };
    if (!body.account) throw new CoreError("bad_request", "account is required");
    const deps = rails();
    requireSolana(deps);
    const response = await buildDonateAction(deps, { account: body.account, amount, fallbackCentsPerSol: centsPerDevnetSol(), baseUrl: baseUrl(req) });
    return NextResponse.json(response, { headers: ACTION_HEADERS });
  } catch (err) {
    return actionError(err);
  }
}
