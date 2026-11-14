// npm run solana:setup -w @abdulcare/payments
// Sets up the Solana devnet side (SPEC §8): a treasury keypair, a demo provider wallet, and devnet
// SOL for fees and receipts. Safe to re-run: it reuses what's already in .env.

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { createConnection, explorerAddressUrl, treasuryFromSecret } from "../src/solana";
import { loadEnv, setEnv } from "./env-file";

const TARGET_SOL = 1;

async function main() {
  loadEnv();
  if (!process.env.SOLANA_RPC_URL) setEnv("SOLANA_RPC_URL", "https://api.devnet.solana.com");
  if (!/devnet/.test(process.env.SOLANA_RPC_URL ?? "")) {
    throw new Error("SOLANA_RPC_URL must point at devnet. This project never touches mainnet.");
  }
  const connection = createConnection();

  if (!process.env.TREASURY_SECRET_KEY) {
    setEnv("TREASURY_SECRET_KEY", bs58.encode(Keypair.generate().secretKey));
    console.log("Created a new devnet treasury keypair (secret saved to .env, not printed).");
  }
  const treasury = treasuryFromSecret(process.env.TREASURY_SECRET_KEY as string);

  if (!process.env.PROVIDER_SOLANA_WALLET) {
    // The provider wallet only receives receipts, so only its address is kept.
    setEnv("PROVIDER_SOLANA_WALLET", Keypair.generate().publicKey.toBase58());
    console.log("Created a demo provider wallet address.");
  }
  if (!process.env.RECEIPT_LAMPORTS) setEnv("RECEIPT_LAMPORTS", "10000");
  const provider = process.env.PROVIDER_SOLANA_WALLET as string;

  let balance = await connection.getBalance(treasury.publicKey);
  if (balance < TARGET_SOL * LAMPORTS_PER_SOL * 0.5) {
    console.log(`Requesting a ${TARGET_SOL} SOL devnet airdrop...`);
    try {
      const sig = await connection.requestAirdrop(treasury.publicKey, TARGET_SOL * LAMPORTS_PER_SOL);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      balance = await connection.getBalance(treasury.publicKey);
    } catch (err) {
      const reason = /faucet is closed|410/i.test(String((err as Error).message)) ? "the RPC faucet is closed" : "rate-limited";
      console.log(`  Airdrop failed (${reason}).`);
      console.log("  Fund the treasury address below at https://faucet.solana.com (devnet), then re-run this script.");
    }
  }

  // A brand-new account must hold the rent-exempt minimum before small receipt transfers can land.
  const providerKey = new PublicKey(provider);
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  const providerBalance = await connection.getBalance(providerKey);
  if (providerBalance < rentExempt && balance > rentExempt * 2) {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: providerKey, lamports: rentExempt }),
    );
    await sendAndConfirmTransaction(connection, tx, [treasury], { commitment: "confirmed" });
    console.log("Opened the provider wallet on devnet (rent-exempt minimum).");
    balance = await connection.getBalance(treasury.publicKey);
  }

  console.log("\nSolana devnet is set up:");
  console.log(`  Treasury:        ${treasury.publicKey.toBase58()}  (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
  console.log(`                   ${explorerAddressUrl(treasury.publicKey.toBase58())}`);
  console.log(`  Provider wallet: ${provider}`);
  console.log(`  Receipt size:    ${process.env.RECEIPT_LAMPORTS} lamports`);
  console.log("\nAdd the same four SOLANA/TREASURY/RECEIPT/PROVIDER values to Vercel's environment variables.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
