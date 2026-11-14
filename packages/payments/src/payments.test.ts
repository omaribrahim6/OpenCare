import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { CoreError, getGrant, getLiveAttempt, type Db } from "@abdulcare/core";
import { createTestDb, seedBasics } from "../../core/src/test-helpers";
import { donateByCard } from "./donations";
import { centsToDollars, dollarsToCents } from "./money";
import { NessieClient, NessieError } from "./nessie";
import { reconcileGrant, redeemGrant, type PaymentsDeps } from "./redeem";
import { listIncomeDeposits, listPatientTransactions } from "./transactions";

// In-memory stand-in for the Nessie API, so tests never touch the network.
class FakeNessie {
  purchases: Record<string, unknown>[] = [];
  deposits: Record<string, unknown>[] = [];
  bills: Record<string, unknown>[] = [];
  merchants: Record<string, string> = { m_pharmacy: "Test Pharmacy", m_grocery: "Corner Grocery" };
  calls: string[] = [];
  /** Next POST /purchases: "timeout" writes then throws; "refuse" returns 400. */
  nextPurchase: "ok" | "timeout" | "refuse" = "ok";
  private seq = 0;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    this.calls.push(`${method} ${path}`);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const created = (obj: Record<string, unknown>) => json({ code: 201, message: "Created", objectCreated: obj }, 201);
    let m: RegExpMatchArray | null;

    if ((m = path.match(/^\/accounts\/([^/]+)\/purchases$/))) {
      if (method === "GET") return json(this.purchases.filter((p) => p.payer_id === m![1]));
      if (this.nextPurchase === "refuse") {
        this.nextPurchase = "ok";
        return json({ code: 400, message: "Invalid fields" }, 400);
      }
      const p = { _id: `pur_${++this.seq}`, payer_id: m[1], ...body };
      this.purchases.push(p);
      if (this.nextPurchase === "timeout") {
        this.nextPurchase = "ok";
        throw new TypeError("fetch failed");
      }
      return created(p);
    }
    if ((m = path.match(/^\/purchases\/([^/]+)$/))) {
      const p = this.purchases.find((x) => x._id === m![1]);
      return p ? json(p) : json({ code: 404, message: "Not found" }, 404);
    }
    if ((m = path.match(/^\/accounts\/([^/]+)\/deposits$/))) {
      if (method === "GET") return json(this.deposits.filter((d) => d.payee_id === m![1]));
      const d = { _id: `dep_${++this.seq}`, payee_id: m[1], ...body };
      this.deposits.push(d);
      return created(d);
    }
    if ((m = path.match(/^\/accounts\/([^/]+)\/bills$/))) return json(this.bills.filter((b) => b.account_id === m![1]));
    if ((m = path.match(/^\/bills\/([^/]+)$/)) && method === "PUT") {
      const b = this.bills.find((x) => x._id === m![1]);
      if (b) Object.assign(b, body);
      return json({ code: 202, message: "Accepted" }, 202);
    }
    if ((m = path.match(/^\/merchants\/([^/]+)$/))) {
      return this.merchants[m[1]] ? json({ _id: m[1], name: this.merchants[m[1]] }) : json({ code: 404 }, 404);
    }
    return json({ code: 404, message: "No route" }, 404);
  };

  purchaseCount(): number {
    return this.purchases.length;
  }
}

let db: Db;
let fake: FakeNessie;
let deps: PaymentsDeps;

/** An approved $45 grant for pat_1 at prv_1, against a Nessie bill. */
async function approvedGrant(cents = 4_500): Promise<string> {
  await db.query("update providers set nessie_merchant_id = 'm_pharmacy' where id = 'prv_1'");
  await db.query(
    "insert into documents (id, patient_id, source, nessie_id, status) values ('doc_1', 'pat_1', 'nessie_bill', 'bill_45', 'confirmed')",
  );
  await db.query(
    `insert into grants (id, patient_id, document_id, provider_id, program_id, program_name,
                         requested_cents, approved_cents, status)
     values ('grt_1', 'pat_1', 'doc_1', 'prv_1', 'fund', 'Community fund', $1, $1, 'approved')`,
    [cents],
  );
  await db.query("update fund set reserved_cents = reserved_cents + $1 where id = 'community'", [cents]);
  fake.bills.push({ _id: "bill_45", account_id: "acct_pat", status: "pending", payee: "Test Pharmacy", payment_amount: 45 });
  return "grt_1";
}

const REDEEM = { grantId: "grt_1", providerId: "prv_1", patientId: "pat_1" };

beforeEach(async () => {
  db = await createTestDb();
  await seedBasics(db);
  fake = new FakeNessie();
  deps = {
    db,
    nessie: new NessieClient({ apiKey: "test-key", baseUrl: "https://nessie.test", fetch: fake.fetch }),
    fundAccountId: "acct_fund",
    solana: null,
  };
});

describe("money", () => {
  test("converts dollars and cents at the edge", () => {
    assert.equal(dollarsToCents(45), 4_500);
    assert.equal(dollarsToCents(19.99), 1_999);
    assert.equal(dollarsToCents(0.1 + 0.2), 30);
    assert.equal(centsToDollars(4_500), 45);
    assert.throws(() => centsToDollars(45.5));
    assert.throws(() => dollarsToCents(Number.NaN));
  });
});

describe("Nessie client", () => {
  test("unwraps created objects and keeps the key out of errors", async () => {
    const dep = await deps.nessie.createDeposit("acct_fund", { amountCents: 2_500, description: "x" });
    assert.equal(dep.amount, 25);
    await assert.rejects(deps.nessie.getPurchase("missing"), (err: unknown) => {
      assert.ok(err instanceof NessieError);
      assert.equal(err.status, 404);
      assert.equal(err.uncertain, false);
      assert.ok(!err.message.includes("test-key"));
      return true;
    });
  });

  test("normalizes patient transactions and income deposits", async () => {
    fake.bills.push(
      { _id: "b1", account_id: "acct_pat", status: "pending", payee: "Clinic", payment_amount: 120.5, payment_date: "2026-11-20" },
      { _id: "b2", account_id: "acct_pat", status: "completed", payee: "Old", payment_amount: 10 },
    );
    fake.purchases.push({ _id: "p1", payer_id: "acct_pat", merchant_id: "m_grocery", amount: 64.2, status: "completed", purchase_date: "2026-11-11" });
    fake.deposits.push(
      { _id: "d1", payee_id: "acct_pat", amount: 969.23, status: "completed", transaction_date: "2026-11-10", description: "Payroll" },
      { _id: "d2", payee_id: "acct_pat", amount: 500, status: "completed", transaction_date: "2026-01-01" },
    );
    const txns = await listPatientTransactions(deps.nessie, "acct_pat");
    assert.deepEqual(
      txns.map((t) => [t.id, t.kind, t.merchant, t.amountCents]),
      [
        ["b1", "bill", "Clinic", 12_050],
        ["p1", "purchase", "Corner Grocery", 6_420],
      ],
    );
    const deposits = await listIncomeDeposits(deps.nessie, "acct_pat", { now: new Date("2026-11-14") });
    assert.deepEqual(deposits, [{ date: "2026-11-10", amountCents: 96_923 }]);
  });
});

describe("redemption", () => {
  test("pays exactly once, completes the bill, and marks the grant paid", async () => {
    await approvedGrant();
    const first = await redeemGrant(deps, REDEEM);
    assert.equal(first.payout, "paid");
    assert.equal(first.grant.status, "paid");
    assert.equal(first.grant.receipt?.nessiePaymentId, "pur_1");

    const again = await redeemGrant(deps, REDEEM); // repeated tap
    assert.equal(again.grant.status, "paid");
    assert.equal(fake.purchaseCount(), 1);

    const purchase = fake.purchases[0];
    assert.equal(purchase.merchant_id, "m_pharmacy");
    assert.equal(purchase.amount, 45);
    assert.equal(fake.bills[0].status, "completed");
    const { rows } = await db.query<{ paid_cents: number; reserved_cents: number }>(
      "select paid_cents, reserved_cents from fund where id = 'community'",
    );
    assert.equal(Number(rows[0].paid_cents), 4_500);
    assert.equal(Number(rows[0].reserved_cents), 0);
  });

  test("an uncertain write is reconciled by reading back, never paid twice", async () => {
    await approvedGrant();
    fake.nextPurchase = "timeout"; // Nessie wrote the purchase but the response was lost
    const first = await redeemGrant(deps, REDEEM);
    assert.equal(first.payout, "pending");
    assert.equal(first.grant.status, "payment_pending");

    const polled = await reconcileGrant(deps, "grt_1");
    assert.equal(polled.status, "paid");
    await redeemGrant(deps, REDEEM);
    assert.equal(fake.purchaseCount(), 1);
  });

  test("a missing purchase stays pending until the grace period, then frees the grant", async () => {
    await approvedGrant();
    fake.nextPurchase = "timeout";
    await redeemGrant(deps, REDEEM);
    fake.purchases = []; // the write never actually landed

    assert.equal((await reconcileGrant(deps, "grt_1")).status, "payment_pending");
    deps.nessieGraceMs = 0;
    assert.equal((await reconcileGrant(deps, "grt_1")).status, "approved");
    assert.equal((await getLiveAttempt(db, "grt_1", "nessie")), null);

    const retry = await redeemGrant(deps, REDEEM);
    assert.equal(retry.grant.status, "paid");
    assert.equal(fake.purchaseCount(), 1);
  });

  test("a refused payout releases the claim so the provider can retry", async () => {
    await approvedGrant();
    fake.nextPurchase = "refuse";
    await assert.rejects(redeemGrant(deps, REDEEM), (err: unknown) => err instanceof CoreError && err.code === "upstream_error");
    assert.equal((await getGrant(db, "grt_1")).status, "approved");
    assert.equal((await redeemGrant(deps, REDEEM)).grant.status, "paid");
    assert.equal(fake.purchaseCount(), 1);
  });

  test("the wrong provider can't redeem", async () => {
    await approvedGrant();
    await assert.rejects(
      redeemGrant(deps, { ...REDEEM, providerId: "prv_2" }),
      (err: unknown) => err instanceof CoreError && err.code === "forbidden",
    );
    assert.equal(fake.purchaseCount(), 0);
  });
});

describe("card donations", () => {
  test("deposit into the fund and record the donation once per idempotency key", async () => {
    const before = await db.query<{ total_cents: number }>("select total_cents from fund where id = 'community'");
    const first = await donateByCard(deps, { amountCents: 2_500, idempotencyKey: "donation-abc123" });
    const retry = await donateByCard(deps, { amountCents: 2_500, idempotencyKey: "donation-abc123" });
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.depositId, first.depositId);
    assert.equal(fake.deposits.length, 1);
    const after = await db.query<{ total_cents: number }>("select total_cents from fund where id = 'community'");
    assert.equal(Number(after.rows[0].total_cents) - Number(before.rows[0].total_cents), 2_500);
  });

  test("rejects out-of-range amounts", async () => {
    await assert.rejects(donateByCard(deps, { amountCents: 50 }), (err: unknown) => err instanceof CoreError);
    await assert.rejects(donateByCard(deps, { amountCents: 12.5 }), (err: unknown) => err instanceof CoreError);
  });
});
