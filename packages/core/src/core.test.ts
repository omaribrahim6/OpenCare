import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { ConfirmedFields, Device, ExtractionResult } from "@abdulcare/contracts";
import { createAttempt, getLiveAttempt, updateAttempt } from "./attempts";
import { getSessionPatient, issueCard, resolveTap, endSession } from "./cards";
import type { Db } from "./db";
import { authenticateDevice, pairDevice, requireRole } from "./devices";
import { confirmDocument, createScanDocument, saveExtraction } from "./documents";
import { addDonation, getFundSummary } from "./fund";
import {
  cancelGrant,
  claimForRedemption,
  completePayout,
  createGrant,
  decideGrant,
  getGrant,
  payoutReference,
  releaseClaim,
} from "./grants";
import { createTestDb, seedBasics } from "./test-helpers";
import { CoreError } from "./util";

const CONFIRMED: ConfirmedFields = {
  provider: "Test Pharmacy",
  documentType: "pharmacy_receipt",
  currency: "USD",
  totalCents: 4500,
  date: "2026-11-10",
};

const EXTRACTION: ExtractionResult = {
  readable: true,
  fields: {
    provider: { value: "Test Pharmacy", evidence: "TEST PHARMACY" },
    documentType: { value: "pharmacy_receipt", evidence: null },
    currency: { value: "USD", evidence: "$" },
    totalCents: { value: 4500, evidence: "TOTAL $45.00" },
    date: { value: "2026-11-10", evidence: "11/10/2026" },
  },
  missing: [],
  supportingText: [],
  warnings: [],
  source: "scan",
};

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof CoreError, `expected CoreError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

let db: Db;
let kiosk: Device;
let provider: Device;
let reviewer: Device;

async function confirmedDocument(patientId = "pat_1"): Promise<string> {
  const doc = await createScanDocument(db, patientId, Buffer.from("fake-jpeg"), "image/jpeg");
  await saveExtraction(db, doc.id, EXTRACTION);
  await confirmDocument(db, doc.id, patientId, CONFIRMED);
  return doc.id;
}

async function approvedGrant(cents = 4500): Promise<string> {
  const documentId = await confirmedDocument();
  const grant = await createGrant(db, {
    patientId: "pat_1",
    documentId,
    providerId: "prv_1",
    programId: "prog_rx",
    programName: "Community Rx Relief (fictional)",
    requestedCents: 4500,
  });
  await decideGrant(db, grant.id, reviewer.id, { decision: "approve", approvedCents: cents });
  return grant.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedBasics(db);
  kiosk = (await pairDevice(db, { role: "kiosk", pin: "4242", label: "Kiosk" })).device;
  provider = (await pairDevice(db, { role: "provider", pin: "4242", label: "Counter", providerId: "prv_1" })).device;
  reviewer = (await pairDevice(db, { role: "reviewer", pin: "4242", label: "Laptop" })).device;
});

describe("devices", () => {
  test("pairing needs the right PIN and a provider for provider devices", async () => {
    await rejectsWith(pairDevice(db, { role: "kiosk", pin: "0000", label: "x" }), "forbidden");
    await rejectsWith(pairDevice(db, { role: "provider", pin: "4242", label: "x" }), "bad_request");
  });

  test("the cookie secret authenticates the device; nothing else does", async () => {
    const { device, secret } = await pairDevice(db, { role: "kiosk", pin: "4242", label: "K2" });
    assert.equal((await authenticateDevice(db, secret))?.id, device.id);
    assert.equal(await authenticateDevice(db, "wrong"), null);
    assert.equal(await authenticateDevice(db, undefined), null);
    assert.throws(() => requireRole(device, ["reviewer"]), CoreError);
  });
});

describe("card taps", () => {
  test("a paired kiosk starts a session; the card URL holds only the token", async () => {
    const { token, url } = await issueCard(db, "pat_1");
    assert.equal(url, `https://abdulcare.test/t/${token}`);
    const { result, sessionSecret } = await resolveTap(db, token, kiosk);
    assert.equal(result.kind, "session");
    assert.ok(sessionSecret);
    assert.equal((await getSessionPatient(db, sessionSecret, kiosk))?.id, "pat_1");
    // The session is bound to the device that was tapped.
    assert.equal(await getSessionPatient(db, sessionSecret, provider), null);
    await endSession(db, sessionSecret);
    assert.equal(await getSessionPatient(db, sessionSecret, kiosk), null);
  });

  test("an unpaired phone or reviewer laptop learns nothing from a card", async () => {
    const { token } = await issueCard(db, "pat_1");
    assert.deepEqual((await resolveTap(db, token, null)).result, { kind: "unpaired_device" });
    assert.deepEqual((await resolveTap(db, token, reviewer)).result, { kind: "unpaired_device" });
  });

  test("unknown or malformed tokens are reported as unknown cards", async () => {
    assert.equal((await resolveTap(db, "notARealToken12345", kiosk)).result.kind, "unknown_card");
    assert.equal((await resolveTap(db, "../../etc", kiosk)).result.kind, "unknown_card");
  });

  test("a new tap on the same device replaces the previous patient's session", async () => {
    const a = await issueCard(db, "pat_1");
    const b = await issueCard(db, "pat_2");
    const first = await resolveTap(db, a.token, kiosk);
    const second = await resolveTap(db, b.token, kiosk);
    assert.equal(await getSessionPatient(db, first.sessionSecret, kiosk), null);
    assert.equal((await getSessionPatient(db, second.sessionSecret, kiosk))?.id, "pat_2");
  });

  test("a provider tap lists only that patient's approved grants for that provider", async () => {
    const grantId = await approvedGrant();
    const { token } = await issueCard(db, "pat_1");
    const { result } = await resolveTap(db, token, provider);
    assert.equal(result.kind, "redemption");
    if (result.kind === "redemption") assert.deepEqual(result.redeemableGrants.map((g) => g.id), [grantId]);
  });
});

describe("documents", () => {
  test("only the owner can confirm, and amounts must be positive integer cents", async () => {
    const doc = await createScanDocument(db, "pat_1", Buffer.from("img"), "image/png");
    await rejectsWith(confirmDocument(db, doc.id, "pat_1", CONFIRMED), "invalid_state"); // still extracting
    await saveExtraction(db, doc.id, EXTRACTION);
    await rejectsWith(confirmDocument(db, doc.id, "pat_2", CONFIRMED), "forbidden");
    await rejectsWith(confirmDocument(db, doc.id, "pat_1", { ...CONFIRMED, totalCents: 45.5 }), "bad_request");
    const confirmed = await confirmDocument(db, doc.id, "pat_1", CONFIRMED);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.imageUrl, `/api/documents/${doc.id}/image`);
  });

  test("rejects non-image uploads", async () => {
    await rejectsWith(createScanDocument(db, "pat_1", Buffer.from("x"), "application/pdf"), "bad_request");
  });
});

describe("grants", () => {
  test("can't request more than the confirmed bill, or twice for one document", async () => {
    const documentId = await confirmedDocument();
    const base = { patientId: "pat_1", documentId, providerId: "prv_1", programId: "p", programName: "P" };
    await rejectsWith(createGrant(db, { ...base, requestedCents: 4501 }), "bad_request");
    await createGrant(db, { ...base, requestedCents: 4500 });
    await rejectsWith(createGrant(db, { ...base, requestedCents: 4500 }), "conflict");
  });

  test("approval reserves budget; it can't exceed the request or the fund", async () => {
    const documentId = await confirmedDocument();
    const grant = await createGrant(db, {
      patientId: "pat_1", documentId, providerId: "prv_1", programId: "p", programName: "P", requestedCents: 4500,
    });
    await rejectsWith(decideGrant(db, grant.id, reviewer.id, { decision: "approve", approvedCents: 5000 }), "bad_request");
    await db.query("update fund set total_cents = 1000");
    await rejectsWith(decideGrant(db, grant.id, reviewer.id, { decision: "approve", approvedCents: 4500 }), "insufficient_funds");
    assert.equal((await getGrant(db, grant.id)).status, "pending_review"); // rolled back
    await db.query("update fund set total_cents = 10000");
    const approved = await decideGrant(db, grant.id, reviewer.id, { decision: "approve", approvedCents: 4500 });
    assert.equal(approved.status, "approved");
    const fund = await getFundSummary(db);
    assert.equal(fund.reservedCents, 4500);
    assert.equal(fund.availableCents, 5500);
    // A second decision is rejected.
    await rejectsWith(decideGrant(db, grant.id, reviewer.id, { decision: "reject" }), "invalid_state");
  });

  test("pending and rejected grants can't be redeemed", async () => {
    const documentId = await confirmedDocument();
    const grant = await createGrant(db, {
      patientId: "pat_1", documentId, providerId: "prv_1", programId: "p", programName: "P", requestedCents: 4500,
    });
    const claim = { grantId: grant.id, providerId: "prv_1", patientId: "pat_1" };
    await rejectsWith(claimForRedemption(db, claim), "invalid_state");
    await decideGrant(db, grant.id, reviewer.id, { decision: "reject" });
    await rejectsWith(claimForRedemption(db, claim), "invalid_state");
  });

  test("redemption needs the grant's provider and the matching patient's card", async () => {
    const grantId = await approvedGrant();
    await rejectsWith(claimForRedemption(db, { grantId, providerId: "prv_2", patientId: "pat_1" }), "forbidden");
    await rejectsWith(claimForRedemption(db, { grantId, providerId: "prv_1", patientId: "pat_2" }), "forbidden");
  });

  test("repeated redeem calls claim once; payout completes once and moves budget", async () => {
    const grantId = await approvedGrant();
    const claim = { grantId, providerId: "prv_1", patientId: "pat_1" };
    const first = await claimForRedemption(db, claim);
    const second = await claimForRedemption(db, claim);
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    assert.equal(second.grant.status, "payment_pending");

    await completePayout(db, grantId);
    const again = await completePayout(db, grantId); // idempotent
    assert.equal(again.status, "paid");
    const fund = await getFundSummary(db);
    assert.equal(fund.reservedCents, 0);
    assert.equal(fund.paidCents, 4500);
    assert.equal(fund.paidCount, 1);
    assert.equal((await claimForRedemption(db, claim)).claimed, false);
  });

  test("cancel releases the reservation; paid grants can't be canceled", async () => {
    const grantId = await approvedGrant();
    await cancelGrant(db, grantId);
    assert.equal((await getFundSummary(db)).reservedCents, 0);
    await rejectsWith(cancelGrant(db, grantId), "invalid_state");
  });

  test("the public reference is opaque and stable", async () => {
    const ref = payoutReference("grt_abc");
    assert.equal(ref, payoutReference("grt_abc"));
    assert.match(ref, /^ac_[0-9a-f]{20}$/);
    assert.ok(!ref.includes("grt_abc"));
  });
});

describe("payment attempts", () => {
  test("only one live attempt per grant and rail; a failed one can be retried", async () => {
    const grantId = await approvedGrant();
    await claimForRedemption(db, { grantId, providerId: "prv_1", patientId: "pat_1" });
    const attempt = await createAttempt(db, { grantId, rail: "nessie", recipient: "merchant_1", amountCents: 4500 });
    await rejectsWith(createAttempt(db, { grantId, rail: "nessie", recipient: "merchant_1", amountCents: 4500 }), "conflict");
    // A Solana receipt is a separate rail.
    await createAttempt(db, { grantId, rail: "solana", recipient: "wallet", lamports: 1000 });

    // While a Nessie attempt is live, the claim can't be released.
    await rejectsWith(releaseClaim(db, grantId), "invalid_state");
    await updateAttempt(db, attempt.id, { status: "failed", error: "timeout, reconciled: not executed" });
    assert.equal(await getLiveAttempt(db, grantId, "nessie"), null);
    const retry = await createAttempt(db, { grantId, rail: "nessie", recipient: "merchant_1", amountCents: 4500 });
    assert.equal(retry.status, "pending");
  });

  test("the grant receipt shows the confirmed Nessie ID and Solana signature", async () => {
    const grantId = await approvedGrant();
    await claimForRedemption(db, { grantId, providerId: "prv_1", patientId: "pat_1" });
    const n = await createAttempt(db, { grantId, rail: "nessie", recipient: "m", amountCents: 4500 });
    await updateAttempt(db, n.id, { status: "confirmed", externalId: "nessie_purchase_1" });
    const s = await createAttempt(db, { grantId, rail: "solana", recipient: "w", lamports: 1000 });
    await updateAttempt(db, s.id, { externalId: "5igSig" });
    await completePayout(db, grantId);
    const grant = await getGrant(db, grantId);
    assert.equal(grant.receipt?.nessiePaymentId, "nessie_purchase_1");
    assert.equal(grant.receipt?.solanaSignature, "5igSig");
    assert.equal(grant.receipt?.receiptStatus, "receipt_pending");
    assert.match(grant.receipt?.explorerUrl ?? "", /cluster=devnet/);
  });
});

describe("fund", () => {
  test("donations add to the total; the summary has no patient data", async () => {
    await addDonation(db, 2500, "sig123");
    const summary = await getFundSummary(db);
    assert.equal(summary.totalCents, 12_500);
    assert.equal(summary.recent[0].type, "donation");
    assert.ok(!JSON.stringify(summary).includes("pat_"));
    await rejectsWith(addDonation(db, -5), "bad_request");
  });
});
