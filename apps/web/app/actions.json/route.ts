// /actions.json: tells Blink clients which paths on this site are Solana Actions.

import { NextResponse } from "next/server";
import { ACTION_HEADERS } from "@abdulcare/payments";

export function GET() {
  return NextResponse.json({ rules: [{ pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }] }, { headers: ACTION_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: ACTION_HEADERS });
}
