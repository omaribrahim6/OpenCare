// Devnet SOL donations from the donor's own wallet (Phantom). The browser only builds and asks the
// wallet to sign a transfer to the treasury's PUBLIC address; no key ever touches this app.
// The server then verifies the signature (POST /api/fund/donations/solana).

import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? "";
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider } };
  const p = w.phantom?.solana;
  return p?.isPhantom ? p : null;
}

export function isValidAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/** Base58 transaction signature (64 bytes → 86–88 chars). Loose check; the server verifies it. */
export function looksLikeSignature(sig: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(sig.trim());
}

/** Sends `sol` devnet SOL from the connected Phantom wallet to the treasury; resolves with the signature. */
export async function sendDevnetSol(sol: number): Promise<string> {
  const phantom = getPhantom();
  if (!phantom) throw new Error("Phantom wallet not found");
  if (!isValidAddress(TREASURY_ADDRESS)) throw new Error("Treasury address is not configured");

  const { publicKey } = await phantom.connect();
  const connection = new Connection(RPC_URL, "confirmed");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: new PublicKey(TREASURY_ADDRESS),
      lamports: Math.round(sol * LAMPORTS_PER_SOL),
    }),
  );
  const { signature } = await phantom.signAndSendTransaction(tx);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
