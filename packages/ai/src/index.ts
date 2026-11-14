// Public API of @abdulcare/ai. Server-only: never import this from a client component.
// Shapes (NeedInput, NeedAssessment, QueueRanking, …) come from @abdulcare/contracts.
export { needEngine, createNeedEngine } from "./engine";
export { assessNeed, estimateMonthlyIncomeCents, FORMULA, povertyLineCents } from "./formula";
export { rankQueue, formulaRanking, templatedRationale, RANK_PROMPT_VERSION } from "./rank";
export { detectSuspicious } from "./suspicious";
export { classifyTransactions } from "./classify";
export { explainBill, templateExplanation, DISCLAIMER } from "./explain";
export type { BillToExplain } from "./explain";
export { createGeminiClient, ModelUnavailableError, DEFAULT_MODEL } from "./gemini";
export type { ModelClient } from "./gemini";
export { vertexFromEnv, VERTEX_DEFAULT_MODEL } from "./vertex";
export type { VertexConfig } from "./vertex";
