// Client calls for /user. The portal cookie is httpOnly, so the browser sends it on its own.

import type { PortalOverviewResponse, PortalSessionResponse, PortalSignInRequest } from "@abdulcare/contracts";

export class PortalError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new PortalError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export const getOverview = () => call<PortalOverviewResponse>("/api/user/me");

export const signIn = (req: PortalSignInRequest) =>
  call<PortalSessionResponse>("/api/user/session", { method: "POST", body: JSON.stringify(req) });

export const signOut = () => call<{ ok: true }>("/api/user/session", { method: "DELETE" });
