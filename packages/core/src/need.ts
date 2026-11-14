// Need assessments and the caseworker queue (SPEC §7 jobs 2–3).
// Core gathers inputs and stores results; the formula and Gemini live in @abdulcare/ai, passed in
// as a NeedEngine. Core re-checks Gemini's order (defense in depth) and caches it by input hash so
// a reload never reshuffles the queue.

import type {
  Grant,
  NeedAssessment,
  NeedEngine,
  NeedInput,
  PatientProfile,
  QueueItem,
  QueueRanking,
  RankingRow,
  ReviewQueue,
  SuspiciousContent,
} from "@abdulcare/contracts";
import type { Db } from "./db";
import { getGrant, listGrants } from "./grants";
import { getPatientWithProfile } from "./profiles";
import { CoreError, sha256 } from "./util";

const DAY_MS = 86_400_000;

/** Gemini placing a request this many positions from formula order is flagged for the caseworker. */
export const DISAGREEMENT_POSITIONS = 2;

interface StoredAssessment {
  grant_id: string;
  inputs: NeedInput;
  assessment: NeedAssessment;
  suspicious: SuspiciousContent | null;
}

export function daysWaiting(createdAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(createdAt)) / DAY_MS));
}

/** Gather the formula's inputs for one grant. Holds no names, IDs or free text. */
export async function buildNeedInput(
  db: Db,
  grant: Grant,
  opts: { depositIncomeCents?: number | null; now?: Date } = {},
): Promise<{ input: NeedInput; profile: PatientProfile }> {
  const now = opts.now ?? new Date();
  const { profile } = await getPatientWithProfile(db, grant.patient.id);
  const { rows } = await db.query<{ n: number; cents: number }>(
    `select count(*)::int as n, coalesce(sum(approved_cents), 0)::bigint as cents
       from grants
      where patient_id = $1 and id <> $2 and status = 'paid' and paid_at > $3`,
    [grant.patient.id, grant.id, new Date(now.getTime() - 90 * DAY_MS)],
  );
  return {
    profile,
    input: {
      householdSize: profile.householdSize,
      profileIncomeCents: profile.monthlyIncomeCents,
      depositIncomeCents: opts.depositIncomeCents ?? null,
      insurance: profile.insurance,
      billCents: grant.requestedCents,
      category: grant.bill.category,
      daysWaiting: daysWaiting(grant.createdAt, now),
      priorPaidCount90d: rows[0]?.n ?? 0,
      priorPaidCents90d: Number(rows[0]?.cents ?? 0),
    },
  };
}

function untrustedFields(grant: Grant) {
  const fields: { field: SuspiciousContent["field"]; text: string }[] = [{ field: "merchant", text: grant.bill.merchant }];
  if (grant.bill.description) fields.push({ field: "description", text: grant.bill.description });
  if (grant.hardshipNote) fields.push({ field: "hardship_note", text: grant.hardshipNote });
  return fields;
}

/**
 * Assess a grant and store the result. On the first assessment the untrusted text is checked
 * for injected instructions; later recomputes (wait time grows daily) keep that result and the
 * deposit-based income estimate.
 */
export async function assessGrant(
  db: Db,
  engine: NeedEngine,
  grantId: string,
  opts: { depositIncomeCents?: number | null; now?: Date } = {},
): Promise<{ assessment: NeedAssessment; suspicious: SuspiciousContent | null; profile: PatientProfile; input: NeedInput }> {
  const grant = await getGrant(db, grantId);
  const { rows } = await db.query<StoredAssessment>(
    "select grant_id, inputs, assessment, suspicious from need_assessments where grant_id = $1",
    [grantId],
  );
  const stored = rows[0];
  const depositIncomeCents =
    opts.depositIncomeCents !== undefined ? opts.depositIncomeCents : (stored?.inputs.depositIncomeCents ?? null);
  const { input, profile } = await buildNeedInput(db, grant, { depositIncomeCents, now: opts.now });

  const assessment = engine.assessNeed(input);
  if (!Number.isFinite(assessment.score) || assessment.score < 0 || assessment.score > 100) {
    throw new CoreError("internal", "Need score out of range");
  }
  const score = Math.round(assessment.score);

  let suspicious = stored ? stored.suspicious : null;
  if (!stored) {
    try {
      suspicious = await engine.detectSuspicious(untrustedFields(grant));
    } catch {
      suspicious = null; // Detection is a warning only; it never blocks a request.
    }
  }

  await db.query(
    `insert into need_assessments (grant_id, score, formula_version, inputs, assessment, suspicious, computed_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (grant_id) do update
       set score = excluded.score, formula_version = excluded.formula_version, inputs = excluded.inputs,
           assessment = excluded.assessment, computed_at = now()`,
    [grantId, score, assessment.formulaVersion, JSON.stringify(input), JSON.stringify(assessment), JSON.stringify(suspicious)],
  );
  return { assessment, suspicious, profile, input };
}

/** A, B, …, Z, AA, AB, …: labels Gemini sees instead of IDs. */
export function rankingLabel(i: number): string {
  let n = i;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function templatedRationale(row: RankingRow): string {
  const top = [...row.factors]
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((f) => `${f.label.toLowerCase()} (${f.input})`);
  return top.length
    ? `Need score ${row.score}. Largest factors: ${top.join(" and ")}.`
    : `Need score ${row.score}.`;
}

/** Formula order with templated rationales: the fallback whenever Gemini can't be used. */
export function formulaRanking(rows: RankingRow[]): QueueRanking {
  return {
    source: "formula",
    order: rows.map((r) => r.label),
    rationales: Object.fromEntries(rows.map((r) => [r.label, templatedRationale(r)])),
    model: null,
  };
}

/** Gemini's order must contain every label exactly once, with a rationale string for each. */
export function isValidRanking(ranking: QueueRanking, rows: RankingRow[]): boolean {
  const labels = rows.map((r) => r.label).sort();
  const order = Array.isArray(ranking?.order) ? [...ranking.order].sort() : [];
  return (
    order.length === labels.length &&
    order.every((l, i) => l === labels[i]) &&
    rows.every((r) => typeof ranking.rationales?.[r.label] === "string")
  );
}

/**
 * The caseworker queue: every pending request, freshly assessed, in Gemini's order (cached by
 * input hash) or formula order on fallback. Gemini sees only anonymized RankingRows.
 */
export async function getReviewQueue(db: Db, engine: NeedEngine, opts: { now?: Date } = {}): Promise<ReviewQueue> {
  const now = opts.now ?? new Date();
  const { rows: fund } = await db.query<{ available: number }>(
    "select (total_cents - reserved_cents - paid_cents)::bigint as available from fund where id = 'community'",
  );
  const availableCents = Number(fund[0]?.available ?? 0);

  const pending = (await listGrants(db, { status: "pending_review" })).sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  if (pending.length === 0) {
    return { source: "formula", model: null, availableCents, items: [], rankedAt: now.toISOString() };
  }

  const assessed: (Awaited<ReturnType<typeof assessGrant>> & { grant: Grant; days: number })[] = [];
  for (const grant of pending) {
    const result = await assessGrant(db, engine, grant.id, { now });
    assessed.push({ grant, ...result, days: result.input.daysWaiting });
  }

  // Formula order: score, then longest wait, then earliest request (SPEC §7).
  assessed.sort(
    (a, b) =>
      b.assessment.score - a.assessment.score ||
      b.days - a.days ||
      Date.parse(a.grant.createdAt) - Date.parse(b.grant.createdAt),
  );
  const rows: RankingRow[] = assessed.map((a, i) => ({
    label: rankingLabel(i),
    score: Math.round(a.assessment.score),
    factors: a.assessment.factors,
    incomePctOfPoverty: a.assessment.incomePctOfPoverty,
    billCents: a.grant.requestedCents,
    daysWaiting: a.days,
  }));
  const byLabel = new Map(rows.map((r, i) => [r.label, assessed[i]]));
  const inputsHash = sha256(JSON.stringify({ ids: assessed.map((a) => a.grant.id), rows }));

  let ranking: QueueRanking | null = null;
  let rankedAt = now.toISOString();
  const { rows: cached } = await db.query<{
    source: QueueRanking["source"];
    grant_order: string[];
    rationales: Record<string, string>;
    model: string | null;
    computed_at: Date;
  }>("select source, grant_order, rationales, model, computed_at from queue_rankings where inputs_hash = $1", [inputsHash]);
  if (cached[0]) {
    ranking = { source: cached[0].source, order: cached[0].grant_order, rationales: cached[0].rationales, model: cached[0].model };
    rankedAt = new Date(cached[0].computed_at).toISOString();
  } else {
    try {
      const candidate = await engine.rankQueue(rows);
      ranking = isValidRanking(candidate, rows) ? candidate : formulaRanking(rows);
    } catch {
      ranking = formulaRanking(rows);
    }
    // Only Gemini results are cached; a fallback is retried on the next load.
    if (ranking.source === "gemini") {
      await db.query(
        `insert into queue_rankings (inputs_hash, source, grant_order, rationales, model)
         values ($1, $2, $3, $4, $5) on conflict (inputs_hash) do nothing`,
        [inputsHash, ranking.source, JSON.stringify(ranking.order), JSON.stringify(ranking.rationales), ranking.model],
      );
    }
  }

  const formulaPos = new Map(rows.map((r, i) => [r.label, i + 1]));
  const items: QueueItem[] = ranking.order.map((label, i) => {
    const a = byLabel.get(label)!;
    const formulaRank = formulaPos.get(label)!;
    return {
      rank: i + 1,
      formulaRank,
      disagreesWithFormula: ranking.source === "gemini" && Math.abs(i + 1 - formulaRank) >= DISAGREEMENT_POSITIONS,
      grant: a.grant,
      profile: a.profile,
      daysWaiting: a.days,
      assessment: a.assessment,
      rationale: ranking.rationales[label] ?? templatedRationale(rows[formulaRank - 1]),
      suspiciousContent: a.suspicious,
    };
  });

  return { source: ranking.source, model: ranking.model, availableCents, items, rankedAt };
}
