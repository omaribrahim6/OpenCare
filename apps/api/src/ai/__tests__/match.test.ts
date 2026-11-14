import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPrograms, matchProgram, MATCH_NOTE } from "../match";
import { CATALOG } from "../catalog";
import type { ConfirmedFields } from "../types";

const today = new Date("2026-11-14T12:00:00Z");
const rxBill: ConfirmedFields = {
  provider: "Riverside Community Pharmacy",
  documentType: "pharmacy_receipt",
  currency: "USD",
  totalCents: 4500,
  date: "2026-11-02",
};
const rx = CATALOG.find((p) => p.id === "prog_rx_bridge")!;

test("the demo $45 pharmacy bill is a possible fit with full patient info", () => {
  const m = matchProgram(rx, rxBill, { householdSize: 2, annualIncomeCents: 3_000_000 }, today);
  assert.equal(m.fit, "possible");
  assert.equal(m.possibleFit, true);
  assert.equal(m.maxCents, 4500);
  assert.deepEqual(m.missingInfo, []);
  assert.equal(m.note, MATCH_NOTE);
  assert.ok(m.reasons.some((r) => r.includes("$45.00")));
  assert.ok(m.criteria.every((c) => c.status === "met"));
});

test("missing patient info gives needs_info with a question", () => {
  const m = matchProgram(rx, rxBill, {}, today);
  assert.equal(m.fit, "needs_info");
  assert.equal(m.possibleFit, true);
  assert.equal(m.missingInfo.length, 1);
  assert.match(m.missingInfo[0], /household/);
});

test("income over the limit makes the program unlikely", () => {
  const m = matchProgram(rx, rxBill, { householdSize: 1, annualIncomeCents: 9_000_000 }, today);
  assert.equal(m.fit, "unlikely");
  assert.equal(m.possibleFit, false);
  assert.ok(m.criteria.find((c) => c.id === "income")!.detail.includes("over"));
});

test("cap limits maxCents and unknown totals give null", () => {
  const big = matchProgram(rx, { ...rxBill, totalCents: 40_000 }, {}, today);
  assert.equal(big.maxCents, 15_000);
  const unknown = matchProgram(rx, { ...rxBill, totalCents: null }, {}, today);
  assert.equal(unknown.maxCents, null);
  assert.ok(unknown.missingInfo.some((q) => q.includes("total amount")));
});

test("wrong document type, old bill and foreign currency fail clearly", () => {
  const m = matchProgram(rx, { ...rxBill, documentType: "dental_bill", date: "2025-01-01", currency: "EUR" }, {}, today);
  const byId = Object.fromEntries(m.criteria.map((c) => [c.id, c.status]));
  assert.equal(byId.document_type, "not_met");
  assert.equal(byId.bill_date, "not_met");
  assert.equal(byId.currency, "not_met");
  assert.equal(m.fit, "unlikely");
});

test("future dates are questioned, not accepted", () => {
  const m = matchProgram(rx, { ...rxBill, date: "2027-01-01" }, {}, today);
  assert.equal(m.criteria.find((c) => c.id === "bill_date")!.status, "unknown");
});

test("insurance status drives the uninsured program", () => {
  const p = CATALOG.find((x) => x.id === "prog_uninsured_care")!;
  assert.equal(matchProgram(p, rxBill, { insured: false }, today).fit, "possible");
  assert.equal(matchProgram(p, rxBill, { insured: true }, today).fit, "unlikely");
  assert.equal(matchProgram(p, rxBill, {}, today).fit, "needs_info");
});

test("matchPrograms sorts best fits first and every result is fictional and hedged", () => {
  const ms = matchPrograms(rxBill, { householdSize: 2, annualIncomeCents: 3_000_000, insured: true }, { today });
  assert.equal(ms.length, 3);
  assert.equal(ms[0].programId, "prog_rx_bridge");
  assert.equal(ms[0].fit, "possible");
  assert.equal(ms.at(-1)!.fit, "unlikely");
  for (const m of ms) {
    assert.equal(m.fictional, true);
    assert.match(m.name, /fictional/);
    assert.doesNotMatch(JSON.stringify(m), /guarantee(d|s)? (to|you)|you (are|will be) eligible|approved/i);
  }
});

test("invalid patient numbers are treated as unknown", () => {
  const m = matchProgram(rx, rxBill, { householdSize: 0, annualIncomeCents: -5 }, today);
  assert.equal(m.criteria.find((c) => c.id === "income")!.status, "unknown");
});
