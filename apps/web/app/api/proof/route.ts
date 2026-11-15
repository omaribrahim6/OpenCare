// GET /api/proof: everything a donor, judge or auditor needs to check the fund without trusting us.
// The on-chain fund program (rules, attested hospitals, every decided grant), the daily anchors, and
// the fund-side Nessie records each Solana record points back to. No patient data: patient-side
// Nessie movements appear only as counts.

import { getDb } from "@abdulcare/core";
import {
  explorerAddressUrl,
  explorerTxUrl,
  FUND_RULES,
  fetchConfig,
  listAnchors,
  listGrantAccounts,
  listHospitalAccounts,
  listLinks,
  programIdFromEnv,
  rulesHash,
  solanaFromEnv,
} from "@abdulcare/payments";
import { ok, route } from "@/app/api/_lib/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PUBLIC_NESSIE = new Set(["reserve", "contribution", "donor_transfer", "refund", "program_paid"]);

export const GET = route(async () => {
  const db = getDb();
  const sol = solanaFromEnv();
  const programId = programIdFromEnv();

  let program: Record<string, unknown> | null = null;
  if (sol && programId) {
    try {
      const [config, grants, hospitals] = await Promise.all([
        fetchConfig(sol.connection, programId),
        listGrantAccounts(sol.connection, programId),
        listHospitalAccounts(sol.connection, programId),
      ]);
      program = {
        id: programId.toBase58(),
        explorerUrl: explorerAddressUrl(programId.toBase58()),
        config,
        rules: { ...FUND_RULES, hash: rulesHash(FUND_RULES), matchesChain: config ? config.rulesHash === rulesHash(FUND_RULES) : null },
        hospitals: hospitals.map((h) => ({ ...h, explorerUrl: explorerAddressUrl(h.address) })),
        grants: grants.slice(0, 50).map((g) => ({ ...g, explorerUrl: explorerAddressUrl(g.address) })),
        grantCount: grants.length,
      };
    } catch (err) {
      console.error("[api] program read failed:", (err as Error).message);
      program = { id: programId.toBase58(), explorerUrl: explorerAddressUrl(programId.toBase58()), error: "The program couldn't be read right now" };
    }
  }

  const anchors = (await listAnchors(db, 14)).map((a) => ({
    day: a.day,
    digest: a.digest,
    status: a.status,
    signature: a.signature,
    explorerUrl: a.explorerUrl,
    formula: a.payload.formula,
    queue: { root: a.payload.queue.root, count: a.payload.queue.count },
    ledger: { root: a.payload.ledger.root, count: a.payload.ledger.count },
    nessie: a.payload.nessie,
  }));

  const links = await listLinks(db, undefined, 500);
  const counts: Record<string, number> = {};
  for (const l of links) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
  const recent = links
    .filter((l) => PUBLIC_NESSIE.has(l.kind) || l.kind.startsWith("program_") || l.kind === "attest")
    .slice(0, 40)
    .map((l) => ({
      kind: l.kind,
      amountCents: l.amountCents,
      nessieId: PUBLIC_NESSIE.has(l.kind) ? l.nessieId : null,
      signature: l.signature,
      explorerUrl: l.signature ? explorerTxUrl(l.signature) : null,
      at: l.createdAt,
    }));

  return ok({
    treasury: sol ? { address: sol.treasury.publicKey.toBase58(), explorerUrl: explorerAddressUrl(sol.treasury.publicKey.toBase58()) } : null,
    program,
    anchors,
    rails: { counts, recent },
  });
});
