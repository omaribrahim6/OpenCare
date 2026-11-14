import type { GrantStatus } from "@/lib/types";

// Text label plus a dot, never color alone (SPEC §4).
const MAP: Record<GrantStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "chip-outline" },
  pending_review: { label: "Waiting for review", tone: "chip-warn" },
  approved: { label: "Approved", tone: "chip-ok" },
  rejected: { label: "Not approved", tone: "chip-bad" },
  canceled: { label: "Canceled", tone: "chip-outline" },
  payment_pending: { label: "Paying provider", tone: "chip-info" },
  paid: { label: "Paid", tone: "chip-accent" },
};

export const STATUS_LABEL = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [k, v.label])) as Record<
  GrantStatus,
  string
>;

export function StatusBadge({ status, label }: { status: GrantStatus; label?: string }) {
  const s = MAP[status];
  return <span className={`chip chip-dot ${s.tone}`}>{label ?? s.label}</span>;
}
