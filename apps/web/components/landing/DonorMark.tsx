import type { DonorKind } from "@abdulcare/contracts";

/**
 * Logo for a fictional funder. Institutions use a logo generated with Gemini (public/donors/<id>.webp);
 * people, and anyone without a logo, get their initials on a tint picked by the funder's kind.
 */
export const DONOR_KIND_LABEL: Record<DonorKind, string> = {
  state_program: "State program",
  federal_program: "Federal program",
  hospital: "Hospital",
  foundation: "Foundation",
  corporate: "Company",
  community: "Community group",
  individual: "Individual",
};

/** Seeded donors with a generated logo, by donor ID, with the organization's name for hospitals. */
const LOGOS: Record<string, string> = {
  dnr_hist_ucpool: "Commonwealth Uncompensated Care Pool",
  dnr_hist_dsh: "Federal Disproportionate Share Hospital allocation",
  dnr_hist_metro: "Metro Boston Regional Burn & Trauma",
  dnr_hist_crmc: "Connecticut River Medical Center",
  dnr_hist_valley: "Valley General Hospital",
  dnr_hist_berkshire: "Berkshire Ridge Trauma Center",
  dnr_hist_childrens_fdn: "Pioneer Children's Hospital Foundation",
  dnr_hist_harbor: "Harbor Lane Insurance Group",
  dnr_hist_pvcf: "Pioneer Valley Community Foundation",
  dnr_hist_union: "Holyoke Building Trades Relief Fund",
  dnr_hist_rotary: "Northampton Rotary Club",
  dnr_hist_students: "Five College Students for Care",
};

const BY_NAME = new Map(Object.entries(LOGOS).map(([id, name]) => [normalize(name), id]));

function normalize(name: string): string {
  return name.replace(/\s*\(fictional\)\s*$/i, "").trim().toLowerCase();
}

/** The logo for an organization by name (hospitals in the claims list), if one was generated. */
export function logoIdForName(name: string | null | undefined): string | null {
  return name ? (BY_NAME.get(normalize(name)) ?? null) : null;
}

const SKIP = new Set(["of", "the", "and", "&", "for", "a"]);

export function initials(name: string): string {
  const words = name
    .replace(/[^A-Za-z&\s'.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SKIP.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

export function DonorMark({ id, name, kind }: { id?: string | null; name: string; kind: DonorKind }) {
  if (id && kind !== "individual" && LOGOS[id]) {
    return (
      <span className="ln-mark ln-mark-logo" aria-hidden="true">
        {/* Small static WebP files; next/image would add an optimization round trip for nothing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/donors/${id}.webp`} alt="" width={46} height={46} loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className={`ln-mark ln-mark-${kind}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
