// Crypto donations, linked to the fund (SPEC §8 donations, linked rails):
// - Solana Pay transfer requests (a QR code on /fund), in devnet SOL or devnet USDC, each tagged
//   with a one-time reference key so the donation is found on chain without copying a signature;
// - Solana Actions (Blinks): a shareable link any Blink-aware wallet or site turns into a Donate
//   button, which builds the same transfer for the donor's wallet to sign;
// - Pyth's SOL/USD price at the time of the gift, so the dollar value we credit can be checked.
// Crypto only ever flows in: hospitals are paid in dollars through Nessie.

import { randomBytes } from "node:crypto";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import type { Donation } from "@abdulcare/contracts";
import { CoreError, recordDonation, type Db } from "@abdulcare/core";
import type { PaymentsDeps } from "./redeem";
import { MEMO_PROGRAM_ID, type SolanaConfig } from "./solana";

/** Circle's devnet USDC mint. */
export const DEVNET_USDC_MINT = new PublicKey(process.env.USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdJVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** Devnet's genesis hash, for the Blink's X-Blockchain-Ids header. */
export const DEVNET_CHAIN_ID = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
/** Pyth's SOL/USD price feed. */
export const PYTH_SOL_USD_FEED = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

// ---------------------------------------------------------------------------
// Pyth: what one SOL is worth right now
// ---------------------------------------------------------------------------

export interface SolPrice {
  centsPerSol: number;
  source: "pyth" | "fixed";
  publishTime: number | null;
}

/** Pyth's sponsored SOL/USD price account (PriceUpdateV2), the same address on devnet and mainnet. */
export const PYTH_SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
/** Older than this and the price counts as stale. */
const PRICE_MAX_AGE_S = 15 * 60;

/** Decode a Pyth PriceUpdateV2 account: the feed ID, price, exponent and publish time. */
export function decodePythPriceUpdate(data: Buffer): { feedId: string; price: bigint; expo: number; publishTime: number } {
  let o = 8 + 32; // discriminator, write authority
  const level = data[o];
  o += level === 0 ? 2 : 1; // VerificationLevel: Partial { num_signatures } | Full
  const feedId = data.subarray(o, o + 32).toString("hex");
  o += 32;
  const price = data.readBigInt64LE(o);
  o += 16; // price, conf
  const expo = data.readInt32LE(o);
  o += 4;
  const publishTime = Number(data.readBigInt64LE(o));
  return { feedId, price, expo, publishTime };
}

/** SOL/USD read on chain from Pyth's price account, or the fixed demo rate if it's missing or stale. */
export async function solUsdPrice(fallbackCentsPerSol: number, connection?: Connection): Promise<SolPrice> {
  try {
    if (!connection) throw new Error("No connection");
    const info = await connection.getAccountInfo(PYTH_SOL_USD_ACCOUNT, "confirmed");
    if (!info) throw new Error("Pyth price account not found");
    const p = decodePythPriceUpdate(info.data);
    if (p.feedId !== PYTH_SOL_USD_FEED) throw new Error("Not the SOL/USD feed");
    if (Date.now() / 1000 - p.publishTime > PRICE_MAX_AGE_S) throw new Error("Pyth price is stale");
    const usd = Number(p.price) * 10 ** p.expo;
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("Pyth price is not a positive number");
    return { centsPerSol: Math.round(usd * 100), source: "pyth", publishTime: p.publishTime };
  } catch {
    return { centsPerSol: fallbackCentsPerSol, source: "fixed", publishTime: null };
  }
}

// ---------------------------------------------------------------------------
// Solana Pay transfer requests
// ---------------------------------------------------------------------------

export type CryptoRail = "sol" | "usdc";

export interface DonationRequest {
  reference: string;
  rail: CryptoRail;
  /** Decimal amount in SOL or USDC, as written in the URL. */
  amount: string;
  url: string;
  recipient: string;
  usdCents: number;
  priceSource: SolPrice["source"] | "usdc";
}

function validAmount(rail: CryptoRail, amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new CoreError("bad_request", "Amount must be more than zero");
  if (rail === "sol" && (amount < 0.001 || amount > 100)) throw new CoreError("bad_request", "Give between 0.001 and 100 devnet SOL");
  if (rail === "usdc" && (amount < 1 || amount > 10_000)) throw new CoreError("bad_request", "Give between $1 and $10,000 in devnet USDC");
  return rail === "sol" ? String(Math.round(amount * 1e6) / 1e6) : String(Math.round(amount * 100) / 100);
}

/**
 * A Solana Pay URL for a donation to the treasury, with a fresh reference key. The request is saved
 * so `confirmDonationRequest` can find the donor's transfer later.
 */
export async function createDonationRequest(
  deps: PaymentsDeps,
  input: { rail: CryptoRail; amount: number; fallbackCentsPerSol: number },
): Promise<DonationRequest> {
  if (!deps.solana) throw new CoreError("upstream_error", "Solana is not configured on this deployment");
  const amount = validAmount(input.rail, input.amount);
  const reference = Keypair.generate().publicKey.toBase58();
  const recipient = deps.solana.treasury.publicKey.toBase58();
  const price = input.rail === "sol" ? await solUsdPrice(input.fallbackCentsPerSol, deps.solana.connection) : null;
  const usdCents = input.rail === "sol" ? Math.round(Number(amount) * (price as SolPrice).centsPerSol) : Math.round(Number(amount) * 100);

  const params = new URLSearchParams();
  params.set("amount", amount);
  if (input.rail === "usdc") params.set("spl-token", DEVNET_USDC_MINT.toBase58());
  params.set("reference", reference);
  params.set("label", "OpenCare Community Fund");
  params.set("message", "Helps pay a patient's hospital bill. Every dollar gets a public receipt.");
  params.set("memo", `oc_pay_${randomBytes(6).toString("hex")}`);
  const url = `solana:${recipient}?${params.toString()}`;

  await deps.db.query(
    `insert into donation_requests (reference, rail, amount_units, usd_cents, price_source) values ($1, $2, $3, $4, $5)`,
    [reference, input.rail, amount, usdCents, price?.source ?? "usdc"],
  );
  return { reference, rail: input.rail, amount, url, recipient, usdCents, priceSource: price?.source ?? "usdc" };
}

type AnyInstruction = ParsedInstruction | PartiallyDecodedInstruction;

/** Lamports and USDC (6 decimals) a confirmed transaction moved into the treasury. */
export async function incomingToTreasury(
  sol: SolanaConfig,
  signature: string,
): Promise<{ lamports: number; usdcUnits: number; from: string } | null> {
  const tx = await sol.connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx || tx.meta?.err) return null;
  const treasury = sol.treasury.publicKey.toBase58();
  const treasuryUsdc = associatedTokenAddress(sol.treasury.publicKey, DEVNET_USDC_MINT).toBase58();
  const all: AnyInstruction[] = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  let lamports = 0;
  let usdcUnits = 0;
  let from = "";
  for (const ix of all) {
    if (!("parsed" in ix)) continue;
    const parsed = ix.parsed as { type?: string; info?: Record<string, unknown> };
    const info = parsed.info ?? {};
    if (ix.program === "system" && parsed.type === "transfer" && info.destination === treasury) {
      lamports += Number(info.lamports ?? 0);
      from = String(info.source ?? from);
    }
    if (ix.program === "spl-token" && info.destination === treasuryUsdc) {
      if (parsed.type === "transferChecked" && info.mint === DEVNET_USDC_MINT.toBase58()) {
        usdcUnits += Number((info.tokenAmount as { amount?: string } | undefined)?.amount ?? 0);
        from = String(info.authority ?? info.source ?? from);
      } else if (parsed.type === "transfer") {
        usdcUnits += Number(info.amount ?? 0);
        from = String(info.authority ?? info.source ?? from);
      }
    }
  }
  return lamports > 0 || usdcUnits > 0 ? { lamports, usdcUnits, from } : null;
}

export interface ConfirmedCryptoDonation {
  status: "confirmed" | "waiting";
  donation: Donation | null;
  signature: string | null;
  usdCents: number | null;
}

/**
 * Look for the donor's transfer carrying this request's reference key, verify it reached the
 * treasury, and record the donation once. "waiting" means the wallet hasn't sent it yet.
 */
export async function confirmDonationRequest(
  deps: PaymentsDeps,
  input: { reference: string; signature?: string; fallbackCentsPerSol: number },
): Promise<ConfirmedCryptoDonation> {
  if (!deps.solana) throw new CoreError("upstream_error", "Solana is not configured on this deployment");
  const req = await getDonationRequest(deps.db, input.reference);
  if (!req) throw new CoreError("not_found", "Unknown donation request");
  if (req.donation_id) {
    const { rows } = await deps.db.query<{ solana_signature: string | null; amount_cents: string }>(
      "select solana_signature, amount_cents from donations where id = $1",
      [req.donation_id],
    );
    return { status: "confirmed", donation: null, signature: rows[0]?.solana_signature ?? null, usdCents: Number(rows[0]?.amount_cents ?? 0) };
  }

  let signature = input.signature ?? null;
  if (!signature) {
    const found = await deps.solana.connection.getSignaturesForAddress(new PublicKey(input.reference), { limit: 5 }, "confirmed");
    signature = found.find((s) => !s.err)?.signature ?? null;
  }
  if (!signature) return { status: "waiting", donation: null, signature: null, usdCents: null };

  // The transaction must actually mention this reference key, so one signature can't be claimed twice.
  const tx = await deps.solana.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const keys = tx?.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58()) ?? [];
  if (!keys.includes(input.reference)) throw new CoreError("bad_request", "That transaction isn't for this donation request");

  const moved = await incomingToTreasury(deps.solana, signature);
  if (!moved) return { status: "waiting", donation: null, signature, usdCents: null };
  let usdCents: number;
  if (moved.usdcUnits > 0) {
    usdCents = Math.round(moved.usdcUnits / 10_000);
  } else {
    const price = await solUsdPrice(input.fallbackCentsPerSol, deps.solana.connection);
    usdCents = Math.round((moved.lamports / LAMPORTS_PER_SOL) * price.centsPerSol);
  }
  if (usdCents <= 0) throw new CoreError("bad_request", "That donation is too small to record");
  const donation = await recordDonation(deps.db, { rail: "solana", amountCents: usdCents, solanaSignature: signature });
  await deps.db.query("update donation_requests set donation_id = $2, usd_cents = $3 where reference = $1", [input.reference, donation.id, usdCents]);
  return { status: "confirmed", donation, signature, usdCents };
}

async function getDonationRequest(db: Db, reference: string) {
  const { rows } = await db.query<{ reference: string; rail: CryptoRail; amount_units: string; donation_id: string | null }>(
    "select reference, rail, amount_units, donation_id from donation_requests where reference = $1",
    [reference],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Solana Actions (Blinks)
// ---------------------------------------------------------------------------

/** Headers every Actions response needs, including CORS for wallets and Blink clients. */
export const ACTION_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": DEVNET_CHAIN_ID,
  "Content-Type": "application/json",
};

/** The Blink's metadata: what a wallet or site shows before the donor picks an amount. */
export function donateActionMetadata(baseUrl: string) {
  const href = (amount: string) => `${baseUrl}/api/actions/donate?amount=${amount}`;
  return {
    type: "action",
    icon: `${baseUrl}/kiosk-icon-512.png`,
    title: "Donate to the OpenCare Community Fund",
    description:
      "Your gift pays down a patient's hospital bill. A caseworker approves every grant, the hospital is paid directly, and every dollar gets a public receipt on Solana devnet.",
    label: "Donate",
    links: {
      actions: [
        { type: "transaction", label: "0.05 SOL", href: href("0.05") },
        { type: "transaction", label: "0.1 SOL", href: href("0.1") },
        { type: "transaction", label: "0.5 SOL", href: href("0.5") },
        {
          type: "transaction",
          label: "Donate",
          href: `${baseUrl}/api/actions/donate?amount={amount}`,
          parameters: [{ type: "number", name: "amount", label: "Amount in devnet SOL", required: true, min: 0.001, max: 100 }],
        },
      ],
    },
  };
}

/**
 * The unsigned transfer a Blink hands the donor's wallet: donor → treasury, tagged with a fresh
 * reference key and a memo. The request is saved like a Solana Pay one, so the gift is recorded
 * once it confirms (via the Action's `next` callback, or anyone polling the reference).
 */
export async function buildDonateAction(
  deps: PaymentsDeps,
  input: { account: string; amount: number; fallbackCentsPerSol: number; baseUrl: string },
): Promise<{ type: "transaction"; transaction: string; message: string; links: { next: { type: "post"; href: string } } }> {
  if (!deps.solana) throw new CoreError("upstream_error", "Solana is not configured on this deployment");
  let donor: PublicKey;
  try {
    donor = new PublicKey(input.account);
  } catch {
    throw new CoreError("bad_request", "account must be a Solana address");
  }
  const amount = validAmount("sol", input.amount);
  const lamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
  const reference = Keypair.generate().publicKey;
  const price = await solUsdPrice(input.fallbackCentsPerSol, deps.solana.connection);

  const transfer = SystemProgram.transfer({ fromPubkey: donor, toPubkey: deps.solana.treasury.publicKey, lamports });
  transfer.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  const memo = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: donor, isSigner: true, isWritable: false }],
    data: Buffer.from(`oc_blink_${reference.toBase58().slice(0, 12)}`, "utf8"),
  });
  const { blockhash, lastValidBlockHeight } = await deps.solana.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: donor, blockhash, lastValidBlockHeight }).add(transfer, memo);

  await deps.db.query(
    `insert into donation_requests (reference, rail, amount_units, usd_cents, price_source) values ($1, 'sol', $2, $3, $4)`,
    [reference.toBase58(), amount, Math.round(Number(amount) * price.centsPerSol), price.source],
  );
  return {
    type: "transaction",
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    message: `Thank you. ${amount} SOL (about $${((Number(amount) * price.centsPerSol) / 100).toFixed(2)}) goes to the community fund.`,
    links: { next: { type: "post", href: `${input.baseUrl}/api/actions/donate/next?reference=${reference.toBase58()}` } },
  };
}
