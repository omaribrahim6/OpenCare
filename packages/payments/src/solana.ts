// Solana devnet: the fund's public, privacy-safe record (SPEC §8, §10). Every receipt is a small
// lamport transfer from the treasury plus a memo holding only an opaque reference. Devnet SOL
// has no dollar value; label these "public test receipts".

import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Memos are opaque references only: never names, IDs, amounts, or medical text. */
const MEMO_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;

export type ChainStatus = "pending" | "confirmed" | "failed" | "expired";

export interface SolanaConfig {
  connection: Connection;
  treasury: Keypair;
  /** Lamports sent with each receipt. */
  receiptLamports: number;
  /** Fallback receipt recipient when a provider has no wallet on file. */
  defaultRecipient?: string;
}

export function createConnection(rpcUrl = process.env.SOLANA_RPC_URL): Connection {
  return new Connection(rpcUrl || clusterApiUrl("devnet"), "confirmed");
}

export function treasuryFromSecret(secret: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(secret.trim()));
}

/** Config from env, or null when Solana isn't set up (receipts are then skipped, payouts still run). */
export function solanaFromEnv(): SolanaConfig | null {
  const secret = process.env.TREASURY_SECRET_KEY;
  if (!secret) return null;
  return {
    connection: createConnection(),
    treasury: treasuryFromSecret(secret),
    receiptLamports: Number(process.env.RECEIPT_LAMPORTS || 10_000),
    defaultRecipient: process.env.PROVIDER_SOLANA_WALLET || undefined,
  };
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export interface SignedReceipt {
  signature: string;
  /** Base64 signed transaction, persisted before broadcast so it can be rebroadcast as-is. */
  signedTx: string;
  lastValidBlockHeight: number;
  lamports: number;
  /** The treasury itself for memo-only receipts. */
  recipient: string;
  memo: string;
}

/**
 * Build and sign (but don't send) a receipt: a treasury → recipient transfer plus the memo.
 * With `lamports: 0` it is a memo-only record signed by the treasury (used for card donations).
 */
export async function buildReceipt(
  config: SolanaConfig,
  input: { recipient?: string; memo: string; lamports?: number },
): Promise<SignedReceipt> {
  if (!MEMO_PATTERN.test(input.memo)) throw new Error("Receipt memo must be an opaque reference");
  const lamports = input.lamports ?? config.receiptLamports;
  if (!Number.isInteger(lamports) || lamports < 0) throw new Error("Receipt lamports must be a whole number");
  const payer = config.treasury.publicKey;
  if (lamports > 0 && !input.recipient) throw new Error("A receipt that moves lamports needs a recipient");
  const recipient = lamports > 0 ? new PublicKey(input.recipient as string) : payer;

  const { blockhash, lastValidBlockHeight } = await config.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  if (lamports > 0) tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports }));
  tx.add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      data: Buffer.from(input.memo, "utf8"),
    }),
  );
  tx.sign(config.treasury);
  if (!tx.signature) throw new Error("Signing the receipt failed");

  return {
    signature: bs58.encode(tx.signature),
    signedTx: tx.serialize().toString("base64"),
    lastValidBlockHeight,
    lamports,
    recipient: recipient.toBase58(),
    memo: input.memo,
  };
}

/** The signature of a persisted signed transaction. */
export function signatureOf(signedTx: string): string {
  const tx = Transaction.from(Buffer.from(signedTx, "base64"));
  if (!tx.signature) throw new Error("Transaction is not signed");
  return bs58.encode(tx.signature);
}

/**
 * Send a signed transaction. Rebroadcasting the same bytes is safe: the network processes a
 * signature at most once, so "already processed" counts as sent.
 */
export async function broadcast(connection: Connection, signedTx: string): Promise<void> {
  try {
    await connection.sendRawTransaction(Buffer.from(signedTx, "base64"), { skipPreflight: false, maxRetries: 3 });
  } catch (err) {
    if (/already (been )?processed/i.test(String((err as Error).message))) return;
    throw err;
  }
}

/** Where a signature stands. `expired` means it can never land: its blockhash is too old. */
export async function checkSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
): Promise<ChainStatus> {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = value[0];
  if (status) {
    if (status.err) return "failed";
    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return "confirmed";
    return "pending";
  }
  const height = await connection.getBlockHeight("confirmed");
  return height > lastValidBlockHeight ? "expired" : "pending";
}

/** Poll briefly for confirmation; returns the last status seen (often still "pending"). */
export async function waitForSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  timeoutMs = 8_000,
): Promise<ChainStatus> {
  const deadline = Date.now() + timeoutMs;
  let status: ChainStatus = "pending";
  while (Date.now() < deadline) {
    status = await checkSignature(connection, signature, lastValidBlockHeight);
    if (status !== "pending") return status;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return status;
}

/** Build, send and briefly wait for a receipt that has no database attempt (e.g. donations). */
export async function sendReceipt(
  config: SolanaConfig,
  input: { recipient?: string; memo: string; lamports?: number },
): Promise<{ signature: string; status: ChainStatus }> {
  const receipt = await buildReceipt(config, input);
  await broadcast(config.connection, receipt.signedTx);
  const status = await waitForSignature(config.connection, receipt.signature, receipt.lastValidBlockHeight);
  return { signature: receipt.signature, status };
}

/**
 * Check a devnet SOL donation: a confirmed transaction that moved lamports into the treasury.
 * Returns the lamports received, or null if the signature isn't a confirmed transfer to us.
 */
export async function verifySolDonation(
  config: SolanaConfig,
  signature: string,
): Promise<{ lamports: number; from: string } | null> {
  const tx = await config.connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) return null;
  const treasury = config.treasury.publicKey.toBase58();
  let lamports = 0;
  let from = "";
  for (const ix of tx.transaction.message.instructions) {
    if (!("parsed" in ix) || ix.program !== "system") continue;
    const parsed = ix.parsed as { type?: string; info?: { destination?: string; source?: string; lamports?: number } };
    if (parsed.type === "transfer" && parsed.info?.destination === treasury && parsed.info.lamports) {
      lamports += parsed.info.lamports;
      from = parsed.info.source ?? from;
    }
  }
  return lamports > 0 ? { lamports, from } : null;
}
