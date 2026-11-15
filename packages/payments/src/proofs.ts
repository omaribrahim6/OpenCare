// Linked rails, the Solana proof side: daily checkpoints that make our database and our Nessie
// books checkable by anyone.
//
// Each day's anchor is a public JSON payload with:
// - the need formula's version and SHA-256, so anyone can prove the formula never changed;
// - a Merkle root over the queue (opaque reference, score, rank), so a patient can prove their own
//   place in line without anyone else's data being shown;
// - a Merkle root over the public ledger (payouts, declines, donations), so editing history later
//   stops matching the chain;
// - a statement of the fund's Nessie accounts (deposits, payouts, transfers in and out).
// The payload's SHA-256 goes into a devnet memo signed by the treasury.

import { createHash } from "node:crypto";
import { CoreError, newId, payoutReference, type Db } from "@abdulcare/core";
import { dollarsToCents } from "./money";
import type { NessieClient } from "./nessie";
import type { PaymentsDeps } from "./redeem";
import { explorerTxUrl, sendReceipt } from "./solana";

// ---------------------------------------------------------------------------
// Merkle trees (SHA-256, sorted pairs, so a proof needs no left/right flags)
// ---------------------------------------------------------------------------

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function leafHash(leaf: string): string {
  return sha256Hex(`leaf:${leaf}`);
}

function pairHash(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return sha256Hex(Buffer.from(x + y, "hex"));
}

/** Root of the tree over already-hashed leaves. An empty tree's root is the hash of "empty". */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("empty");
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pairHash(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

/** Sibling hashes from a leaf up to the root. */
export function merkleProof(leaves: string[], index: number): string[] {
  if (index < 0 || index >= leaves.length) throw new Error("Leaf index out of range");
  const proof: string[] = [];
  let level = [...leaves];
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    const next: string[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(j + 1 < level.length ? pairHash(level[j], level[j + 1]) : level[j]);
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf: string, proof: string[], root: string): boolean {
  return proof.reduce((acc, sibling) => pairHash(acc, sibling), leaf) === root;
}

/** JSON with sorted keys, so the same payload always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Nessie account statements
// ---------------------------------------------------------------------------

export interface AccountStatement {
  accountTail: string;
  depositsCents: number;
  purchasesCents: number;
  transfersInCents: number;
  transfersOutCents: number;
  /** Money in minus money out, from the transactions themselves (Nessie's balance field is static). */
  netCents: number;
  transactions: number;
}

export async function accountStatement(nessie: NessieClient, accountId: string): Promise<AccountStatement> {
  const [deposits, purchases, transfers] = await Promise.all([
    nessie.listDeposits(accountId),
    nessie.listPurchases(accountId),
    nessie.listTransfers(accountId).catch(() => []),
  ]);
  const live = <T extends { status: string }>(xs: T[]) => xs.filter((x) => x.status !== "cancelled");
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + dollarsToCents(x.amount), 0);
  const tIn = live(transfers).filter((t) => t.payee_id === accountId);
  const tOut = live(transfers).filter((t) => t.payer_id === accountId);
  const depositsCents = sum(live(deposits));
  const purchasesCents = sum(live(purchases));
  const transfersInCents = sum(tIn);
  const transfersOutCents = sum(tOut);
  return {
    accountTail: accountId.slice(-4),
    depositsCents,
    purchasesCents,
    transfersInCents,
    transfersOutCents,
    netCents: depositsCents + transfersInCents - purchasesCents - transfersOutCents,
    transactions: deposits.length + purchases.length + tIn.length + tOut.length,
  };
}

// ---------------------------------------------------------------------------
// The daily anchor
// ---------------------------------------------------------------------------

export interface AnchorPayload {
  day: string;
  formula: { version: string; sha256: string };
  queue: { root: string; count: number; leaves: string[] };
  ledger: { root: string; count: number; leaves: string[] };
  nessie: { fund: AccountStatement | null; reserved: AccountStatement | null };
  programId: string | null;
}

export interface Anchor {
  id: string;
  day: string;
  digest: string;
  payload: AnchorPayload;
  signature: string | null;
  status: "pending" | "confirmed" | "failed";
  explorerUrl: string | null;
  createdAt: string;
}

interface AnchorRow {
  id: string;
  day: string | Date;
  digest: string;
  payload: AnchorPayload;
  signature: string | null;
  status: Anchor["status"];
  created_at: string | Date;
  private_index?: Record<string, { index: number; leaf: string }> | null;
}

const dayString = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

function toAnchor(r: AnchorRow): Anchor {
  return {
    id: r.id,
    day: dayString(r.day),
    digest: r.digest,
    payload: r.payload,
    signature: r.signature,
    status: r.status,
    explorerUrl: r.signature ? explorerTxUrl(r.signature) : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function anchorMemo(day: string, digest: string): string {
  return `oc_anchor:${day.replaceAll("-", "")}:${digest.slice(0, 32)}`;
}

/** The queue leaf for one request: opaque reference, score and rank on that day. */
export function queueLeaf(day: string, ref: string, score: number, rank: number): string {
  return `queue|${day}|${ref}|${score}|${rank}`;
}

async function queueLeaves(db: Db, day: string) {
  const { rows } = await db.query<{ id: string; public_ref: string | null; score: number | null; created_at: string | Date }>(
    `select g.id, g.public_ref, n.score, g.created_at
       from grants g left join need_assessments n on n.grant_id = g.id
      where g.status = 'pending_review'
      order by coalesce(n.score, 0) desc, g.created_at asc`,
  );
  return rows.map((r, i) => {
    const ref = r.public_ref ?? payoutReference(r.id);
    const leaf = queueLeaf(day, ref, Number(r.score ?? 0), i + 1);
    return { grantId: r.id, leaf, hash: leafHash(leaf) };
  });
}

async function ledgerLeaves(db: Db): Promise<string[]> {
  const { rows: grants } = await db.query<{ id: string; public_ref: string | null; status: string; approved_cents: string | null; provider_id: string; decided_at: string | Date | null }>(
    `select id, public_ref, status, approved_cents, provider_id, decided_at from grants
      where status in ('paid', 'rejected') order by id`,
  );
  const { rows: donations } = await db.query<{ id: string; rail: string; amount_cents: string }>(
    "select id, rail, amount_cents from donations order by id",
  );
  const leaves = grants.map((g) => {
    const ref = g.public_ref ?? payoutReference(g.id);
    const month = g.decided_at ? new Date(g.decided_at).toISOString().slice(0, 7) : "";
    return g.status === "paid" ? `paid|${ref}|${g.approved_cents}|${g.provider_id}|${month}` : `declined|${ref}|${month}`;
  });
  for (const d of donations) leaves.push(`donation|${d.id}|${d.rail}|${d.amount_cents}`);
  return leaves.map(leafHash);
}

export async function getAnchor(db: Db, day: string): Promise<Anchor | null> {
  const { rows } = await db.query<AnchorRow>("select * from chain_anchors where day = $1", [day]);
  return rows[0] ? toAnchor(rows[0]) : null;
}

export async function listAnchors(db: Db, limit = 30): Promise<Anchor[]> {
  const { rows } = await db.query<AnchorRow>("select * from chain_anchors order by day desc limit $1", [limit]);
  return rows.map(toAnchor);
}

/**
 * Build today's anchor and publish its digest on devnet. One anchor per day: calling again returns
 * the confirmed one, or retries publishing a pending one.
 */
export async function anchorDay(
  deps: PaymentsDeps,
  input: { formula: { version: string } & Record<string, unknown>; day?: string; programId?: string | null },
): Promise<Anchor> {
  const day = input.day ?? new Date().toISOString().slice(0, 10);
  const existing = await getAnchor(deps.db, day);
  if (existing?.status === "confirmed") return existing;

  let row: Anchor;
  if (existing) {
    row = existing;
  } else {
    const queue = await queueLeaves(deps.db, day);
    const ledger = await ledgerLeaves(deps.db);
    const [fund, reserved] = await Promise.all([
      accountStatement(deps.nessie, deps.fundAccountId).catch(() => null),
      deps.reservedAccountId ? accountStatement(deps.nessie, deps.reservedAccountId).catch(() => null) : Promise.resolve(null),
    ]);
    const payload: AnchorPayload = {
      day,
      formula: { version: input.formula.version, sha256: sha256Hex(canonicalJson(input.formula)) },
      queue: { root: merkleRoot(queue.map((q) => q.hash)), count: queue.length, leaves: queue.map((q) => q.hash) },
      ledger: { root: merkleRoot(ledger), count: ledger.length, leaves: ledger },
      nessie: { fund, reserved },
      programId: input.programId ?? null,
    };
    const digest = sha256Hex(canonicalJson(payload));
    const privateIndex = Object.fromEntries(queue.map((q, i) => [q.grantId, { index: i, leaf: q.leaf }]));
    const { rows } = await deps.db.query<AnchorRow>(
      `insert into chain_anchors (id, day, digest, payload, private_index) values ($1, $2, $3, $4, $5)
       on conflict (day) do update set day = excluded.day
       returning *`,
      [newId("anc"), day, digest, JSON.stringify(payload), JSON.stringify(privateIndex)],
    );
    row = toAnchor(rows[0]);
  }

  if (!deps.solana) return row;
  const { signature, status } = await sendReceipt(deps.solana, { memo: anchorMemo(row.day, row.digest), lamports: 0 });
  const next = status === "confirmed" ? "confirmed" : status === "pending" ? "pending" : "failed";
  const { rows } = await deps.db.query<AnchorRow>(
    "update chain_anchors set signature = $2, status = $3 where id = $1 returning *",
    [row.id, signature, next],
  );
  return toAnchor(rows[0]);
}

export interface CaseProof {
  day: string;
  leaf: string;
  leafHash: string;
  proof: string[];
  root: string;
  verified: boolean;
  rank: number;
  outOf: number;
  anchorSignature: string | null;
  explorerUrl: string | null;
}

/** A patient's proof of their place in the queue on the latest anchored day that includes them. */
export async function caseProof(db: Db, grantId: string): Promise<CaseProof | null> {
  const { rows } = await db.query<AnchorRow>(
    "select * from chain_anchors where jsonb_exists(private_index, $1) order by day desc limit 1",
    [grantId],
  );
  const r = rows[0];
  if (!r?.private_index) return null;
  const entry = r.private_index[grantId];
  if (!entry) return null;
  const leaves = r.payload.queue.leaves;
  const hash = leaves[entry.index];
  if (hash !== leafHash(entry.leaf)) throw new CoreError("internal", "Anchor index doesn't match its leaves");
  const proof = merkleProof(leaves, entry.index);
  const rank = Number(entry.leaf.split("|")[4] ?? 0);
  return {
    day: dayString(r.day),
    leaf: entry.leaf,
    leafHash: hash,
    proof,
    root: r.payload.queue.root,
    verified: verifyMerkleProof(hash, proof, r.payload.queue.root),
    rank,
    outOf: leaves.length,
    anchorSignature: r.signature,
    explorerUrl: r.signature ? explorerTxUrl(r.signature) : null,
  };
}
