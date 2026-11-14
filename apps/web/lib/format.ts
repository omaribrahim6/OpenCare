// Display formatting. All amounts are integer cents.

export { formatCents } from "./mock";

/** $45 for whole dollars, $45.50 otherwise. */
export function usd(cents: number | null | undefined): string {
  if (cents == null) return "Unknown";
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** $1.2k / $12k for tight spaces. */
export function usdCompact(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

/** Splits an amount for display: ["$45", ".00"]. */
export function usdParts(cents: number): [string, string] {
  const s = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const i = s.lastIndexOf(".");
  return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i)];
}

/** "Alex Rivera (fictional)" → "Alex Rivera". The fictional marker is shown separately. */
export function cleanName(name: string): string {
  return name.replace(/\s*\(fictional\)\s*$/i, "").trim();
}

export function firstName(name: string): string {
  return cleanName(name).split(/\s+/)[0] ?? name;
}

export function initials(name: string): string {
  return cleanName(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "No date";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export const shortSig = (sig: string) => (sig.length > 16 ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : sig);

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=devnet`;

/** Bill step labels carry "(simulated)" for the record; screens show that as a separate tag instead. */
export const stepLabel = (label: string) => label.replace(/ \((hospital decision, )?simulated\)$/, "");
