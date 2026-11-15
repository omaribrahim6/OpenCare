// Linked rails: the client for the opencare_fund program on Solana devnet
// (packages/solana-program). The program decides what the fund may pay; Nessie pays it.
//
// For every rev 6 grant:
//   approve in the admin  → approve_grant on chain (the grant's account can only be created once,
//                           the amount must be within the published largest grant, and the hospital
//                           must be attested)
//   Nessie pays the hospital → mark_paid on chain with a fingerprint of the Nessie purchase ID
//   decline                → decline_grant on chain
// The caseworker desk signs with the fund's authority key, held by the server (caseworkers have no
// wallets). Instructions are encoded by hand (Anchor's 8-byte discriminators + Borsh), so the web app
// needs no Anchor dependency.

import { createHash } from "node:crypto";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { payoutReference, type Db } from "@abdulcare/core";
import { getLink, nessieFingerprint, saveLink } from "./rails";
import type { PaymentsDeps } from "./redeem";
import { explorerAddressUrl, explorerTxUrl, waitForSignature, type SolanaConfig } from "./solana";

export const GRANT_STATUS = { 1: "approved", 2: "declined", 3: "paid" } as const;

export function programIdFromEnv(): PublicKey | null {
  const id = process.env.OPENCARE_PROGRAM_ID;
  if (!id) return null;
  try {
    return new PublicKey(id);
  } catch {
    return null;
  }
}

const disc = (namespace: "global" | "account", name: string) =>
  createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8);

const u64 = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

const bytes32 = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  if (b.length !== 32) throw new Error("Expected 32 bytes");
  return b;
};

/** The case's on-chain key: SHA-256 of its opaque public reference. */
export function caseHash(grantId: string): string {
  return createHash("sha256").update(payoutReference(grantId)).digest("hex");
}

/** Fingerprint of a hospital's Nessie merchant ID, as attested on chain. */
export function merchantHash(merchantId: string): string {
  return nessieFingerprint(`merchant:${merchantId}`);
}

/** Hash of the fund's published rules text. */
export function rulesHash(rules: unknown): string {
  return createHash("sha256").update(JSON.stringify(rules)).digest("hex");
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}
export function hospitalPda(programId: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("hospital"), wallet.toBuffer()], programId)[0];
}
export function grantPda(programId: PublicKey, caseHashHex: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("grant"), bytes32(caseHashHex)], programId)[0];
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export function initializeIx(programId: PublicKey, authority: PublicKey, maxGrantCents: number, rulesHashHex: string) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("global", "initialize"), u64(maxGrantCents), bytes32(rulesHashHex)]),
  });
}

export function setRulesIx(programId: PublicKey, authority: PublicKey, maxGrantCents: number, rulesHashHex: string) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc("global", "set_rules"), u64(maxGrantCents), bytes32(rulesHashHex)]),
  });
}

export function attestHospitalIx(programId: PublicKey, authority: PublicKey, wallet: PublicKey, merchantHashHex: string) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: hospitalPda(programId, wallet), isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("global", "attest_hospital"), bytes32(merchantHashHex)]),
  });
}

function decideKeys(programId: PublicKey, authority: PublicKey, wallet: PublicKey, caseHashHex: string) {
  return [
    { pubkey: configPda(programId), isSigner: false, isWritable: true },
    { pubkey: hospitalPda(programId, wallet), isSigner: false, isWritable: false },
    { pubkey: grantPda(programId, caseHashHex), isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

export function approveGrantIx(programId: PublicKey, authority: PublicKey, wallet: PublicKey, caseHashHex: string, amountCents: number) {
  return new TransactionInstruction({
    programId,
    keys: decideKeys(programId, authority, wallet, caseHashHex),
    data: Buffer.concat([disc("global", "approve_grant"), bytes32(caseHashHex), u64(amountCents)]),
  });
}

export function declineGrantIx(programId: PublicKey, authority: PublicKey, wallet: PublicKey, caseHashHex: string) {
  return new TransactionInstruction({
    programId,
    keys: decideKeys(programId, authority, wallet, caseHashHex),
    data: Buffer.concat([disc("global", "decline_grant"), bytes32(caseHashHex)]),
  });
}

export function markPaidIx(programId: PublicKey, authority: PublicKey, caseHashHex: string, nessieHashHex: string, paidCents: number) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
      { pubkey: grantPda(programId, caseHashHex), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc("global", "mark_paid"), bytes32(nessieHashHex), u64(paidCents)]),
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface FundConfigAccount {
  address: string;
  authority: string;
  maxGrantCents: number;
  rulesHash: string;
  rulesVersion: number;
  grantsApproved: number;
  grantsDeclined: number;
  centsApproved: number;
  centsPaid: number;
}

export interface GrantAccount {
  address: string;
  caseHash: string;
  hospital: string;
  amountCents: number;
  status: (typeof GRANT_STATUS)[keyof typeof GRANT_STATUS] | "unknown";
  rulesVersion: number;
  decidedAt: number;
  paidAt: number;
  nessiePaymentHash: string | null;
}

export interface HospitalAccount {
  address: string;
  wallet: string;
  merchantHash: string;
  active: boolean;
  attestedAt: number;
}

export function decodeConfig(address: string, data: Buffer): FundConfigAccount {
  let o = 8;
  const authority = new PublicKey(data.subarray(o, (o += 32))).toBase58();
  const maxGrantCents = Number(data.readBigUInt64LE(o)); o += 8;
  const rules = data.subarray(o, (o += 32)).toString("hex");
  const rulesVersion = data.readUInt32LE(o); o += 4;
  const grantsApproved = Number(data.readBigUInt64LE(o)); o += 8;
  const grantsDeclined = Number(data.readBigUInt64LE(o)); o += 8;
  const centsApproved = Number(data.readBigUInt64LE(o)); o += 8;
  const centsPaid = Number(data.readBigUInt64LE(o));
  return { address, authority, maxGrantCents, rulesHash: rules, rulesVersion, grantsApproved, grantsDeclined, centsApproved, centsPaid };
}

export function decodeGrant(address: string, data: Buffer): GrantAccount {
  let o = 8;
  const ch = data.subarray(o, (o += 32)).toString("hex");
  const hospital = new PublicKey(data.subarray(o, (o += 32))).toBase58();
  const amountCents = Number(data.readBigUInt64LE(o)); o += 8;
  const status = data.readUInt8(o); o += 1;
  const rulesVersion = data.readUInt32LE(o); o += 4;
  const decidedAt = Number(data.readBigInt64LE(o)); o += 8;
  const paidAt = Number(data.readBigInt64LE(o)); o += 8;
  const nessie = data.subarray(o, o + 32).toString("hex");
  return {
    address,
    caseHash: ch,
    hospital,
    amountCents,
    status: GRANT_STATUS[status as 1 | 2 | 3] ?? "unknown",
    rulesVersion,
    decidedAt,
    paidAt,
    nessiePaymentHash: /^0+$/.test(nessie) ? null : nessie,
  };
}

export function decodeHospital(address: string, data: Buffer): HospitalAccount {
  let o = 8;
  const wallet = new PublicKey(data.subarray(o, (o += 32))).toBase58();
  const mh = data.subarray(o, (o += 32)).toString("hex");
  const active = data.readUInt8(o) === 1; o += 1;
  const attestedAt = Number(data.readBigInt64LE(o));
  return { address, wallet, merchantHash: mh, active, attestedAt };
}

export async function fetchConfig(connection: Connection, programId: PublicKey): Promise<FundConfigAccount | null> {
  const address = configPda(programId);
  const info = await connection.getAccountInfo(address, "confirmed");
  return info ? decodeConfig(address.toBase58(), info.data) : null;
}

export async function fetchGrant(connection: Connection, programId: PublicKey, caseHashHex: string): Promise<GrantAccount | null> {
  const address = grantPda(programId, caseHashHex);
  const info = await connection.getAccountInfo(address, "confirmed");
  return info ? decodeGrant(address.toBase58(), info.data) : null;
}

export async function fetchHospital(connection: Connection, programId: PublicKey, wallet: PublicKey): Promise<HospitalAccount | null> {
  const address = hospitalPda(programId, wallet);
  const info = await connection.getAccountInfo(address, "confirmed");
  return info ? decodeHospital(address.toBase58(), info.data) : null;
}

async function listByDiscriminator(connection: Connection, programId: PublicKey, name: string) {
  return connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc("account", name)) } }],
  });
}

export async function listGrantAccounts(connection: Connection, programId: PublicKey): Promise<GrantAccount[]> {
  const accounts = await listByDiscriminator(connection, programId, "Grant");
  return accounts.map((a) => decodeGrant(a.pubkey.toBase58(), a.account.data)).sort((a, b) => b.decidedAt - a.decidedAt);
}

export async function listHospitalAccounts(connection: Connection, programId: PublicKey): Promise<HospitalAccount[]> {
  const accounts = await listByDiscriminator(connection, programId, "Hospital");
  return accounts.map((a) => decodeHospital(a.pubkey.toBase58(), a.account.data));
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function send(sol: SolanaConfig, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await sol.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: sol.treasury.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(sol.treasury);
  const signature = await sol.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const status = await waitForSignature(sol.connection, signature, lastValidBlockHeight, 15_000);
  if (status === "failed" || status === "expired") throw new Error(`Program transaction ${status}`);
  return signature;
}

/** Fund rules as published: the largest grant and the hash of the rules text. */
export const FUND_RULES = {
  version: 1,
  maxGrantCents: Number(process.env.FUND_MAX_GRANT_CENTS || 100_000_000),
  text: [
    "Everyone is eligible. The published need-v1 formula only sets the order of the queue.",
    "A caseworker approves or declines every request; one approval pays a grant of any size up to the largest grant.",
    "Approved money goes only to an attested hospital, never to the patient.",
    "Every payout, decline, donation and refund gets a public devnet record with no patient data.",
  ],
};

/**
 * Create the fund's config on chain if it isn't there yet, or publish a new rules version when the
 * rules in code changed. Returns the config.
 */
export async function ensureFundConfig(sol: SolanaConfig, programId: PublicKey): Promise<{ config: FundConfigAccount; signature: string | null }> {
  const existing = await fetchConfig(sol.connection, programId);
  if (existing && existing.rulesHash === rulesHash(FUND_RULES) && existing.maxGrantCents === FUND_RULES.maxGrantCents) {
    return { config: existing, signature: null };
  }
  if (existing) {
    const signature = await send(sol, [setRulesIx(programId, sol.treasury.publicKey, FUND_RULES.maxGrantCents, rulesHash(FUND_RULES))]);
    return { config: (await fetchConfig(sol.connection, programId)) as FundConfigAccount, signature };
  }
  const signature = await send(sol, [initializeIx(programId, sol.treasury.publicKey, FUND_RULES.maxGrantCents, rulesHash(FUND_RULES))]);
  const config = await fetchConfig(sol.connection, programId);
  if (!config) throw new Error("Config didn't appear after initialize");
  return { config, signature };
}

/** Attest a hospital's wallet (linked to its Nessie merchant) if it isn't attested yet. */
export async function ensureHospitalAttested(
  deps: PaymentsDeps,
  programId: PublicKey,
  input: { providerId: string; wallet: string; merchantId: string },
): Promise<HospitalAccount> {
  const sol = deps.solana as SolanaConfig;
  const wallet = new PublicKey(input.wallet);
  const existing = await fetchHospital(sol.connection, programId, wallet);
  if (existing) return existing;
  await ensureFundConfig(sol, programId);
  const signature = await send(sol, [attestHospitalIx(programId, sol.treasury.publicKey, wallet, merchantHash(input.merchantId))]);
  await saveLink(deps.db, { kind: "attest", ref: input.providerId, signature, detail: { wallet: input.wallet } });
  const hospital = await fetchHospital(sol.connection, programId, wallet);
  if (!hospital) throw new Error("Hospital attestation didn't appear");
  return hospital;
}

interface GrantChainTarget {
  status: string;
  approvedCents: number;
  providerId: string;
  wallet: string | null;
  merchantId: string | null;
}

async function grantTarget(db: Db, grantId: string): Promise<GrantChainTarget | null> {
  const { rows } = await db.query<{ status: string; approved_cents: string | null; provider_id: string; solana_wallet: string | null; nessie_merchant_id: string | null }>(
    `select g.status, g.approved_cents, g.provider_id, p.solana_wallet, p.nessie_merchant_id
       from grants g join providers p on p.id = g.provider_id where g.id = $1`,
    [grantId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status,
    approvedCents: Number(r.approved_cents ?? 0),
    providerId: r.provider_id,
    wallet: r.solana_wallet ?? process.env.PROVIDER_SOLANA_WALLET ?? null,
    merchantId: r.nessie_merchant_id ?? process.env.NESSIE_PROVIDER_MERCHANT_ID ?? null,
  };
}

export interface GrantOnChain {
  account: GrantAccount | null;
  explorerUrl: string | null;
  approveSignature: string | null;
  paidSignature: string | null;
}

/**
 * Bring the grant's on-chain account up to date with its database state: approve or decline it once,
 * then mark it paid with the Nessie purchase fingerprint once the hospital is paid. Safe to call on
 * every read. Returns what's on chain, or null when the program isn't configured.
 */
export async function syncGrantOnChain(deps: PaymentsDeps, grantId: string): Promise<GrantOnChain | null> {
  const programId = programIdFromEnv();
  const sol = deps.solana;
  if (!programId || !sol) return null;
  const target = await grantTarget(deps.db, grantId);
  if (!target || !target.wallet) return null;
  const ch = caseHash(grantId);
  let account = await fetchGrant(sol.connection, programId, ch);
  const decided = ["approved", "payment_pending", "paid"].includes(target.status);

  if (!account && (decided || target.status === "rejected")) {
    await ensureHospitalAttested(deps, programId, { providerId: target.providerId, wallet: target.wallet, merchantId: target.merchantId ?? target.providerId });
    const wallet = new PublicKey(target.wallet);
    const ix = decided
      ? approveGrantIx(programId, sol.treasury.publicKey, wallet, ch, target.approvedCents)
      : declineGrantIx(programId, sol.treasury.publicKey, wallet, ch);
    const signature = await send(sol, [ix]);
    await saveLink(deps.db, { kind: decided ? "program_approve" : "program_decline", ref: grantId, signature, amountCents: target.approvedCents });
    account = await fetchGrant(sol.connection, programId, ch);
  }

  if (account?.status === "approved" && target.status === "paid") {
    const { rows } = await deps.db.query<{ external_id: string | null }>(
      "select external_id from payment_attempts where grant_id = $1 and rail = 'nessie' and status = 'confirmed' order by created_at desc limit 1",
      [grantId],
    );
    const purchaseId = rows[0]?.external_id;
    if (purchaseId) {
      const signature = await send(sol, [markPaidIx(programId, sol.treasury.publicKey, ch, nessieFingerprint(purchaseId), target.approvedCents)]);
      await saveLink(deps.db, { kind: "program_paid", ref: grantId, signature, nessieId: purchaseId, amountCents: target.approvedCents });
      account = await fetchGrant(sol.connection, programId, ch);
    }
  }

  return {
    account,
    explorerUrl: account ? explorerAddressUrl(account.address) : null,
    approveSignature: (await getLink(deps.db, "program_approve", grantId))?.signature ?? (await getLink(deps.db, "program_decline", grantId))?.signature ?? null,
    paidSignature: (await getLink(deps.db, "program_paid", grantId))?.signature ?? null,
  };
}

export { explorerTxUrl };
