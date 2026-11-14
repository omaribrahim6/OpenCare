import type { DonorKind } from "@abdulcare/contracts";

/** Generated logo mark for a fictional funder: initials on a tint picked by the funder's kind. */
export const DONOR_KIND_LABEL: Record<DonorKind, string> = {
  state_program: "State program",
  federal_program: "Federal program",
  hospital: "Hospital",
  foundation: "Foundation",
  corporate: "Company",
  community: "Community group",
  individual: "Individual",
};

const SKIP = new Set(["of", "the", "and", "&", "for", "a"]);

export function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-z&\s'.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SKIP.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

export function DonorMark({ name, kind }: { name: string; kind: DonorKind }) {
  return (
    <span className={`ln-mark ln-mark-${kind}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
