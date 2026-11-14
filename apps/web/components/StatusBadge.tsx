import type { GrantStatus } from "@/lib/types";

// Text + symbol, never color alone (SPEC §4).
const MAP: Record<GrantStatus, { label: string; tone: string; icon: string }> = {
  draft: { label: "Draft", tone: "info", icon: "✎" },
  pending_review: { label: "Waiting for review", tone: "warn", icon: "⏳" },
  approved: { label: "Approved", tone: "ok", icon: "✓" },
  rejected: { label: "Not approved", tone: "bad", icon: "✕" },
  canceled: { label: "Canceled", tone: "bad", icon: "✕" },
  payment_pending: { label: "Payment in progress", tone: "info", icon: "↻" },
  paid: { label: "Paid", tone: "ok", icon: "✓" },
};

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(MAP).map(([k, v]) => [k, v.label]),
) as Record<GrantStatus, string>;

export function StatusBadge({ status }: { status: GrantStatus }) {
  const s = MAP[status];
  return (
    <span className={`badge ${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}
