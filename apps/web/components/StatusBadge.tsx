import type { GrantStatus } from "@/lib/types";

// Text label plus border, never color alone (SPEC §4).
const MAP: Record<GrantStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "info" },
  pending_review: { label: "Waiting for review", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Not approved", tone: "bad" },
  canceled: { label: "Canceled", tone: "bad" },
  payment_pending: { label: "Payment in progress", tone: "info" },
  paid: { label: "Paid", tone: "ok" },
};

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(MAP).map(([k, v]) => [k, v.label]),
) as Record<GrantStatus, string>;

export function StatusBadge({ status }: { status: GrantStatus }) {
  const s = MAP[status];
  return (
    <span className={`badge ${s.tone}`}>
      {s.label}
    </span>
  );
}
