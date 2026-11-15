// Linked rails: the pure parts (Merkle proofs, anchors, plans, program encoding, Pyth decoding).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  anchorMemo,
  canonicalJson,
  leafHash,
  merkleProof,
  merkleRoot,
  queueLeaf,
  verifyMerkleProof,
} from "./proofs";
import { approveGrantIx, decodeGrant, grantPda, markPaidIx } from "./program";
import { affordableMonthlyCents, nessieFingerprint, suggestPlanMonths, wholeDollarPart } from "./rails";
import { decodePythPriceUpdate, PYTH_SOL_USD_FEED } from "./solana-pay";

const MEMO_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;

describe("Merkle proofs", () => {
  const leaves = Array.from({ length: 11 }, (_, i) => leafHash(queueLeaf("2026-11-15", `ac_${i}`, 90 - i, i + 1)));

  it("proves every leaf against the root, including the odd one out", () => {
    const root = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) assert.ok(verifyMerkleProof(leaves[i], merkleProof(leaves, i), root), `leaf ${i}`);
  });

  it("rejects a leaf with a changed score or rank", () => {
    const root = merkleRoot(leaves);
    const forged = leafHash(queueLeaf("2026-11-15", "ac_3", 99, 1));
    assert.equal(verifyMerkleProof(forged, merkleProof(leaves, 3), root), false);
  });

  it("gives an empty queue a fixed root", () => {
    assert.equal(merkleRoot([]), merkleRoot([]));
  });

  it("hashes the same payload the same way whatever the key order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } }), canonicalJson({ a: { c: "x", d: [1, 2] }, b: 1 }));
  });

  it("fits the anchor in a valid memo", () => {
    assert.match(anchorMemo("2026-11-15", "f".repeat(64)), MEMO_PATTERN);
  });
});

describe("Nessie amounts and plans", () => {
  it("moves only whole dollars", () => {
    assert.equal(wholeDollarPart(43_250), 43_200);
    assert.equal(wholeDollarPart(99), 0);
  });

  it("keeps a plan payment near 5% of monthly income", () => {
    assert.equal(affordableMonthlyCents(260_000), 13_000);
    assert.equal(suggestPlanMonths(43_200, 260_000), 6);
    assert.equal(suggestPlanMonths(30_000, 260_000), 3);
    assert.equal(suggestPlanMonths(500_000, 150_000), 12);
    assert.equal(suggestPlanMonths(43_200, null), 6);
  });

  it("puts a payout fingerprint in the receipt memo without breaking its format", () => {
    assert.match(`ac_${"a".repeat(20)}:nx${nessieFingerprint("65f1c0ffee").slice(0, 16)}`, MEMO_PATTERN);
  });
});

describe("Fund program encoding", () => {
  const programId = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const wallet = Keypair.generate().publicKey;
  const caseHash = createHash("sha256").update("ac_case").digest("hex");

  it("uses Anchor's discriminator and Borsh layout for approve_grant", () => {
    const ix = approveGrantIx(programId, authority, wallet, caseHash, 43_200);
    const disc = createHash("sha256").update("global:approve_grant").digest().subarray(0, 8);
    assert.deepEqual(ix.data.subarray(0, 8), disc);
    assert.equal(ix.data.subarray(8, 40).toString("hex"), caseHash);
    assert.equal(ix.data.readBigUInt64LE(40), 43_200n);
    assert.ok(ix.keys[2].pubkey.equals(grantPda(programId, caseHash)));
  });

  it("marks paid with the Nessie fingerprint", () => {
    const fp = nessieFingerprint("purchase123");
    const ix = markPaidIx(programId, authority, caseHash, fp, 43_200);
    assert.equal(ix.data.subarray(8, 40).toString("hex"), fp);
  });

  it("decodes a grant account", () => {
    const disc = createHash("sha256").update("account:Grant").digest().subarray(0, 8);
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(43_200n);
    const rules = Buffer.alloc(4);
    rules.writeUInt32LE(3);
    const t = Buffer.alloc(8);
    t.writeBigInt64LE(1_794_739_135n);
    const data = Buffer.concat([disc, Buffer.from(caseHash, "hex"), wallet.toBuffer(), amount, Buffer.from([3]), rules, t, t, Buffer.from(nessieFingerprint("p"), "hex"), Buffer.from([255])]);
    const g = decodeGrant("addr", data);
    assert.equal(g.status, "paid");
    assert.equal(g.amountCents, 43_200);
    assert.equal(g.hospital, wallet.toBase58());
    assert.equal(g.rulesVersion, 3);
    assert.equal(g.nessiePaymentHash, nessieFingerprint("p"));
  });
});

describe("Pyth price account", () => {
  it("decodes a PriceUpdateV2 with full verification", () => {
    const price = Buffer.alloc(8);
    price.writeBigInt64LE(7_189_861_634n);
    const conf = Buffer.alloc(8);
    const expo = Buffer.alloc(4);
    expo.writeInt32LE(-8);
    const time = Buffer.alloc(8);
    time.writeBigInt64LE(1_794_739_000n);
    const data = Buffer.concat([Buffer.alloc(8), new PublicKey(Keypair.generate().publicKey).toBuffer(), Buffer.from([1]), Buffer.from(PYTH_SOL_USD_FEED, "hex"), price, conf, expo, time]);
    const p = decodePythPriceUpdate(data);
    assert.equal(p.feedId, PYTH_SOL_USD_FEED);
    assert.equal(Number(p.price) * 10 ** p.expo, 71.89861634);
    assert.equal(p.publishTime, 1_794_739_000);
  });
});
