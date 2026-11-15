// Client calls for /user. The portal cookie is httpOnly, so the browser sends it on its own.

import type {
  PortalOverviewResponse,
  PortalPayRequest,
  PortalPayResponse,
  PortalSessionResponse,
  PortalSignInRequest,
} from "@abdulcare/contracts";
import { scrub } from "@/lib/display";

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
  // Same clean-up as every other page: no "(fictional)" or "simulated" labels on screen.
  return scrub(body) as T;
}

export const getOverview = () => call<PortalOverviewResponse>("/api/user/me");

export const signIn = (req: PortalSignInRequest) =>
  call<PortalSessionResponse>("/api/user/session", { method: "POST", body: JSON.stringify(req) });

export const signOut = () => call<{ ok: true }>("/api/user/session", { method: "DELETE" });

export const payBalance = (visitId: string, amountCents: number) =>
  call<PortalPayResponse>(`/api/user/bills/${encodeURIComponent(visitId)}/pay`, {
    method: "POST",
    body: JSON.stringify({ amountCents } satisfies PortalPayRequest),
  });

// Linked rails: monthly payment plans (a recurring Nessie bill) and queue proofs (Merkle proofs
// against the day's devnet anchor).

export interface PlanOption {
  months: number;
  monthlyCents: number;
}

export interface PaymentPlanView {
  months: number;
  monthlyCents: number;
  totalCents: number;
  firstDue: string;
  incomeShare: number | null;
}

export const getPlan = (visitId: string) =>
  call<{ available: boolean; plan: PaymentPlanView | null; suggestion: { months: number; monthlyCents: number; affordableMonthlyCents: number | null; options: PlanOption[] } }>(
    `/api/user/bills/${encodeURIComponent(visitId)}/plan`,
  );

export const startPlan = (visitId: string, months: number) =>
  call<{ plan: PaymentPlanView }>(`/api/user/bills/${encodeURIComponent(visitId)}/plan`, {
    method: "POST",
    body: JSON.stringify({ months }),
  });

export interface QueueProof {
  grantId: string;
  day: string;
  leafHash: string;
  proof: string[];
  root: string;
  verified: boolean;
  rank: number;
  outOf: number;
  explorerUrl: string | null;
}

export const getProofs = () => call<{ proofs: QueueProof[] }>("/api/user/proof");
