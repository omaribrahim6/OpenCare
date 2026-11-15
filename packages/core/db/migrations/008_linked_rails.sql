-- Linked rails: Nessie holds the dollars, Solana holds the rules and the proof.
-- Every Nessie money movement that matters gets one row here, with the Solana record that proves it.

create table if not exists rail_links (
  id           text primary key,
  -- payout | patient_payment | reserve | contribution | donor_transfer | refund | plan | bill_sync
  -- | program_approve | program_decline | program_paid | attest
  kind         text not null,
  -- The opaque thing it belongs to: a grant ID, a visit ID, a provider ID, an idempotency key.
  ref          text not null,
  nessie_id    text,
  signature    text,
  amount_cents bigint,
  detail       jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kind, ref)
);

-- Daily public checkpoints: Merkle roots of the queue and the ledger, the need formula's hash and a
-- snapshot of the fund's Nessie accounts. The payload is public; its digest goes in a devnet memo.
create table if not exists chain_anchors (
  id         text primary key,
  day        date not null,
  digest     text not null,
  payload    jsonb not null,
  -- Server-only: which queue leaf belongs to which grant, so a patient can get their own proof.
  private_index jsonb,
  signature  text,
  status     text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  unique (day)
);

-- Which Solana Pay / Blink donation requests are still waiting for the donor's wallet.
create table if not exists donation_requests (
  reference    text primary key,
  rail         text not null check (rail in ('sol', 'usdc')),
  amount_units text not null,
  usd_cents    bigint,
  price_source text,
  donation_id  text,
  created_at   timestamptz not null default now()
)
