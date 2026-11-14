// Gemini rewrites for revision 6 (SPEC §7.2, §7.4, §7.5). Each starts from the template, asks the
// model to reword it, and keeps the result only if it passes ./checks. Amounts, flags, the path
// and the suggested action always come from code. Untrusted visit text is fenced; flagged text is
// never sent. On a timeout, an error or a failed check, the template is returned.

import type {
  ApplicationText,
  ApplicationTextInput,
  BillExplanationInput,
  BriefDraft,
  BriefInput,
  Explanation,
} from "@abdulcare/contracts";
import { createGeminiClient, S, type ModelClient } from "../gemini";
import { asRecord, parseModelJson, usd } from "../json";
import { BASE_RULES, cleanUntrusted, fenceUntrusted } from "../sanitize";
import { allowedNumbers, checkText, dollars, withDeadline } from "./checks";
import { applicationTemplate, briefTemplate, CATEGORY_LABELS, explanationTemplate, safeText, SIMULATED_FOOTER } from "./templates";

export const BILL_PROMPT_VERSION = "bills-v1";

export interface LiveDeps {
  client?: ModelClient;
  /** Per-call deadlines, ms. Intake writes one application per policy in a row, so keep it short. */
  timeouts?: { application?: number; brief?: number; explanation?: number };
}

const DEFAULT_TIMEOUTS = { application: 6_000, brief: 12_000, explanation: 10_000 };

function modelName(client: ModelClient): string {
  return `${client.model ?? "unknown-model"}/${BILL_PROMPT_VERSION}`;
}

// ---------------------------------------------------------------------------
// Application text

const APPLICATION_SCHEMA = S.obj({ text: S.str("The rewritten application, plain text, at most 1,500 characters") });

const APPLICATION_PROMPT = `Rewrite this hospital financial-assistance application as a short, clear, polite letter from the patient to the hospital.
Keep every fact exactly as given: the policy and hospital names, the visit date, the balance, the household details, each criterion and the requested reduction.
Do not add any number, date, amount, fact or claim that is not in the draft. Do not say the request is or will be approved. Do not mention medical details.
Use plain text, no markdown headings. Write amounts exactly as they appear in the draft.`;

export async function writeApplicationLive(input: ApplicationTextInput, deps: LiveDeps = {}): Promise<ApplicationText> {
  const template = applicationTemplate(input);
  try {
    const client = deps.client ?? createGeminiClient();
    const raw = await withDeadline(
      client.generateJson({
        system: BASE_RULES,
        parts: [{ text: `${APPLICATION_PROMPT}\n\nDraft:\n${template.text}` }],
        schema: APPLICATION_SCHEMA,
        temperature: 0.2,
      }),
      deps.timeouts?.application ?? DEFAULT_TIMEOUTS.application,
    );
    const text = cleanUntrusted(asRecord(parseModelJson(raw)).text, 1600).replace(/\s*\[truncated\]$/, "");
    const problem = checkText(text, {
      allowed: allowedNumbers([template.text]),
      noDecisions: true,
      maxLength: 1600,
      mustInclude: [usd(input.evaluation.reductionCents), input.policy.name],
    });
    if (problem) return template;
    return { text: text.includes(SIMULATED_FOOTER) ? text : `${text}\n\n${SIMULATED_FOOTER}`, source: "gemini", model: modelName(client) };
  } catch {
    return template;
  }
}

// ---------------------------------------------------------------------------
// Decision brief (reasons only; everything else is code)

const BRIEF_SCHEMA = S.obj({
  reasons: S.list({ type: "STRING" }, "2 or 3 short sentences explaining why this request sits where it does in the queue"),
});

const BRIEF_PROMPT = `You help a community care fund's reviewer. Below is one anonymized pending request: its need-score factors, its position in the queue (ordered by a fixed published formula), and the bill's path.
Write 2 or 3 short sentences explaining why it sits where it does, for example:
"Income is 113% of the poverty guideline for a household of 3, the largest factor. $432.00 is left after insurance and charity care."
Rules:
- Use only numbers that appear in the data, written the same way. Do not compute new numbers.
- Do not recommend, approve, deny or judge eligibility; the reviewer decides. Do not mention names or medical details.
- The order and the score are fixed; do not suggest changing them.`;

function briefPromptData(input: BriefInput) {
  return {
    needScore: Math.round(input.assessment.score),
    positionInQueue: input.rank,
    queueLength: input.queueLength,
    daysWaiting: input.daysWaiting,
    incomePctOfPoverty: input.assessment.incomePctOfPoverty,
    remaining: usd(input.remainingCents),
    factors: input.factors.map((f) => ({
      factor: f.label,
      value: cleanUntrusted(f.input, 120),
      points: f.points,
      maxPoints: f.maxPoints,
      ...(f.unknown && { unknown: true }),
    })),
    billPath: input.path.map((s) => ({ step: cleanUntrusted(s.label, 80), reduction: usd(s.reductionCents), balance: usd(s.balanceCents) })),
  };
}

export async function writeBriefLive(input: BriefInput, deps: LiveDeps = {}): Promise<BriefDraft> {
  const template = briefTemplate(input);
  try {
    const client = deps.client ?? createGeminiClient();
    const data = briefPromptData(input);
    const raw = await withDeadline(
      client.generateJson({
        system: BASE_RULES,
        parts: [{ text: `${BRIEF_PROMPT}\n\nRequest:\n${JSON.stringify(data)}` }],
        schema: BRIEF_SCHEMA,
        temperature: 0,
      }),
      deps.timeouts?.brief ?? DEFAULT_TIMEOUTS.brief,
    );
    const reasons = asRecord(parseModelJson(raw)).reasons;
    if (!Array.isArray(reasons) || reasons.length < 2 || reasons.length > 3) return template;
    const allowed = allowedNumbers([
      data.needScore,
      data.positionInQueue,
      data.queueLength,
      data.daysWaiting,
      data.incomePctOfPoverty,
      dollars(input.remainingCents),
      ...input.factors.flatMap((f) => [f.points, f.maxPoints, f.input, f.label]),
      ...input.path.flatMap((s) => [dollars(s.reductionCents), dollars(s.balanceCents), s.label]),
    ]);
    const clean = reasons.map((r) => cleanUntrusted(r, 400));
    if (clean.some((r) => checkText(r, { allowed, noDecisions: true, maxLength: 400 }) !== null)) return template;
    return { ...template, reasons: clean, source: "gemini", model: modelName(client), checked: true };
  } catch {
    return template;
  }
}

// ---------------------------------------------------------------------------
// Patient explanation (summary and questions; the step points stay exact from code)

const EXPLANATION_SCHEMA = S.obj({
  summary: S.str("2 or 3 short sentences at a 6th-grade reading level"),
  questionsToAsk: S.list({ type: "STRING" }, "Up to 3 short questions the patient could ask the hospital's billing office"),
});

const EXPLANATION_PROMPT = `Explain this hospital bill to the patient in plain, friendly language: what was charged, how insurance and hospital assistance lowered it, and what is left.
Use only the data below. Write amounts exactly as given. Do not add charges, amounts or dates.
Insurance and hospital decisions are simulated in this prototype; you may say so.
Do not mention diagnoses, health conditions or treatment. Do not say the fund or anyone will pay or approve anything; the patient may ask the community care fund for help.`;

export async function explainBillLive(input: BillExplanationInput, deps: LiveDeps = {}): Promise<Explanation> {
  const template = explanationTemplate(input);
  try {
    const client = deps.client ?? createGeminiClient();
    const facts = {
      hospital: safeText(input.hospitalName, "the hospital"),
      visitType: CATEGORY_LABELS[input.category],
      steps: input.steps.map((s) => ({ step: cleanUntrusted(s.label, 80), reduction: usd(s.reductionCents), balance: usd(s.balanceCents), simulated: s.simulated, status: s.status })),
      remaining: usd(input.remainingCents),
    };
    // Line-item text is untrusted: flagged items are replaced, the rest is fenced.
    const items = input.lineItems.slice(0, 8).map((li) => `${safeText(li.description, "Other charge")}: ${usd(li.cents)}`).join("\n");
    const raw = await withDeadline(
      client.generateJson({
        system: BASE_RULES,
        parts: [{ text: `${EXPLANATION_PROMPT}\n\nBill: ${JSON.stringify(facts)}\n\nLine items:\n${fenceUntrusted("line_items", items)}` }],
        schema: EXPLANATION_SCHEMA,
        temperature: 0.2,
      }),
      deps.timeouts?.explanation ?? DEFAULT_TIMEOUTS.explanation,
    );
    const obj = asRecord(parseModelJson(raw));
    const summary = cleanUntrusted(obj.summary, 600);
    const questions = Array.isArray(obj.questionsToAsk) ? obj.questionsToAsk.map((q) => cleanUntrusted(q, 160)).filter(Boolean).slice(0, 3) : [];
    const allowed = allowedNumbers([
      dollars(input.remainingCents),
      ...input.lineItems.flatMap((li) => [dollars(li.cents), safeText(li.description, "")]),
      ...input.steps.flatMap((s) => [dollars(s.reductionCents), dollars(s.balanceCents), s.label]),
    ]);
    const opts = { allowed, noDecisions: true, maxLength: 600 };
    const mustInclude = input.remainingCents > 0 ? [usd(input.remainingCents)] : [];
    if (checkText(summary, { ...opts, mustInclude }) !== null) return template;
    // A question that fails the checks is dropped on its own; the summary is what matters.
    const safeQuestions = questions.filter((q) => checkText(q, opts) === null);
    return { ...template, summary, questionsToAsk: safeQuestions.length ? safeQuestions : template.questionsToAsk, fallback: false };
  } catch {
    return template;
  }
}
