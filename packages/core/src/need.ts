// Need assessments and the reviewer queue (SPEC §7.3–7.4, rev 6).
// Core gathers inputs and stores results; the formula and Gemini live in @abdulcare/ai, passed in
// as a NeedEngine and a BillEngine. Rev 6: the queue is in formula order only (Gemini no longer
// ranks it), and every pending request carries a decision brief cached by a hash of its inputs.

import {
  SECOND_APPROVAL_ABOVE_CENTS,
  type BillEngine,
  type BriefInput,
  type CaseDetail,
  type DecisionBrief,
  type Grant,
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
import { briefFallback } from "./bill-fallback";
import type { Db } from "./db";
import { getGrant, listGrants } from "./grants";
import { getPatientWithProfile } from "./profiles";
import { CoreError, sha256 } from "./util";
import { triageCase } from "./triage";
import { getBill } from "./visits";

const DAY_MS = 86_400_000;

/** How many requests at the top of the queue get a model-written brief; the rest use the template. */
export const MODEL_BRIEFS = 8;

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
export async function getReviewQueue(
  db: Db,
  engine: NeedEngine,
  opts: { now?: Date; bills?: BillEngine } = {},
): Promise<ReviewQueue> {
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

  // Rev 6: formula order only. Gemini writes the brief, never the order.
  // Only the top of the queue gets a model-written brief (in parallel), so a long backlog stays
  // inside the route's time limit; the rest get the template brief, which never calls a model.
  const ranking = formulaRanking(rows);
  const { rows: work } = await db.query<{ id: string; employment: string | null }>(
    "select id, employment from patients where id = any($1)",
    [assessed.map((a) => a.grant.patient.id)],
  );
  const employment = new Map(work.map((r) => [r.id, r.employment]));
  const items: QueueItem[] = await Promise.all(
    ranking.order.map(async (label, i) => {
      const a = byLabel.get(label)!;
      const bill = a.grant.visit ? await getBill(db, a.grant.visit.id) : null;
      const suspicious = a.suspicious ?? bill?.suspiciousContent ?? null;
      const remainingCents = bill ? bill.remainingCents : a.grant.requestedCents;
      const brief = await getDecisionBrief(db, i < MODEL_BRIEFS ? opts.bills : undefined, a.grant.id, {
        path: bill?.steps ?? [],
        remainingCents,
        assessment: a.assessment,
        factors: a.assessment.factors,
        rank: i + 1,
        queueLength: rows.length,
        daysWaiting: a.days,
        suspiciousContent: suspicious,
        secondApprovalAboveCents: SECOND_APPROVAL_ABOVE_CENTS,
      });
      const insight = bill
        ? triageCase({
            bill,
            remainingCents,
            assessment: a.assessment,
            profile: a.profile,
            suspicious,
            priorPaidCount90d: a.input.priorPaidCount90d,
            employment: employment.get(a.grant.patient.id) ?? null,
          })
        : undefined;
      return {
        rank: i + 1,
        formulaRank: i + 1,
        disagreesWithFormula: false,
        grant: a.grant,
        profile: a.profile,
        daysWaiting: a.days,
        assessment: a.assessment,
        rationale: brief.reasons.join(" "),
        suspiciousContent: suspicious,
        brief,
        path: bill?.steps ?? [],
        remainingCents,
        insight,
      };
    }),
  );

  return { source: "formula", model: null, availableCents, items, rankedAt: now.toISOString() };
}

/**
 * The decision brief for a pending request, cached by a hash of its inputs so reloads are stable.
 * Core re-checks the amount (whole cents, at most the remaining balance) and falls back to the
 * template brief if the engine fails or breaks that rule.
 */
export async function getDecisionBrief(
  db: Db,
  engine: BillEngine | undefined,
  grantId: string,
  input: BriefInput,
): Promise<DecisionBrief> {
  const inputsHash = sha256(JSON.stringify(input));
  const { rows } = await db.query<{ inputs_hash: string; brief: DecisionBrief | string }>(
    "select inputs_hash, brief from decision_briefs where grant_id = $1",
    [grantId],
  );
  if (rows[0] && rows[0].inputs_hash === inputsHash) {
    const b = rows[0].brief;
    return oneApproval(typeof b === "string" ? (JSON.parse(b) as DecisionBrief) : b);
  }
  let draft = briefFallback(input);
  if (engine) {
    try {
      const candidate = await engine.writeBrief(input);
      const okAmount =
        Number.isSafeInteger(candidate.suggestedCents) &&
        candidate.suggestedCents >= 0 &&
        candidate.suggestedCents <= input.remainingCents;
      if (okAmount && Array.isArray(candidate.reasons) && Array.isArray(candidate.flags)) draft = candidate;
    } catch {
      // Keep the template brief.
    }
  }
  const brief: DecisionBrief = oneApproval({ ...draft, grantId, computedAt: new Date().toISOString() });
  await db.query(
    `insert into decision_briefs (grant_id, inputs_hash, brief, source, checked, computed_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (grant_id) do update
       set inputs_hash = excluded.inputs_hash, brief = excluded.brief, source = excluded.source,
           checked = excluded.checked, computed_at = now()`,
    [grantId, inputsHash, JSON.stringify(brief), brief.source, brief.checked],
  );
  return brief;
}

/** One caseworker approval is enough at any amount, whatever the engine or an older cache says. */
function oneApproval(brief: DecisionBrief): DecisionBrief {
  return { ...brief, needsSecondApproval: false };
}

/** Everything the reviewer's case screen shows for one rev 6 request (SPEC §4 screen 7). */
export async function getCaseDetail(
  db: Db,
  engines: { need: NeedEngine; bills?: BillEngine },
  grantId: string,
  opts: { now?: Date } = {},
): Promise<CaseDetail | null> {
  const grant = await getGrant(db, grantId);
  if (!grant.visit) return null;
  const { profile } = await getPatientWithProfile(db, grant.patient.id);
  if (grant.status === "pending_review") {
    const queue = await getReviewQueue(db, engines.need, { now: opts.now, bills: engines.bills });
    const item = queue.items.find((it) => it.grant.id === grantId);
    if (item) {
      return { bill: await getBill(db, grant.visit.id), brief: item.brief ?? null, profile, assessment: item.assessment, rank: item.rank };
    }
  }
  const parse = <T>(v: T | string | undefined): T | null =>
    v == null ? null : typeof v === "string" ? (JSON.parse(v) as T) : v;
  const { rows } = await db.query<{ assessment: NeedAssessment | string }>(
    "select assessment from need_assessments where grant_id = $1",
    [grantId],
  );
  const { rows: briefs } = await db.query<{ brief: DecisionBrief | string }>(
    "select brief from decision_briefs where grant_id = $1",
    [grantId],
  );
  return {
    bill: await getBill(db, grant.visit.id),
    brief: briefs[0]?.brief == null ? null : oneApproval(parse(briefs[0].brief)!),
    profile,
    assessment: parse(rows[0]?.assessment),
    rank: null,
  };
}

