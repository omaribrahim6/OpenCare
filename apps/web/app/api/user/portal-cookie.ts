// The patient portal's own httpOnly cookie. Kiosk tap sessions use a different cookie
// (SESSION_COOKIE) and are never touched by /user.

import { cookies } from "next/headers";
import { PORTAL_COOKIE, PORTAL_SESSION_DAYS } from "@abdulcare/core";

export async function readPortalCookie(): Promise<string | undefined> {
  return (await cookies()).get(PORTAL_COOKIE)?.value;
}

export async function setPortalCookie(secret: string): Promise<void> {
  (await cookies()).set(PORTAL_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PORTAL_SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearPortalCookie(): Promise<void> {
  (await cookies()).delete(PORTAL_COOKIE);
}
