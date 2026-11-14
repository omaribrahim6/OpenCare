-- Public ledger (fraud resistance): anyone can audit every case the fund decided, with the cost
-- of care, the itemized bill, insurance, hospital assistance, the need score and the decision,
-- while identity stays private. Only a paired reviewer device can reveal who a case belongs to,
-- and every reveal is logged.

-- Coarse, non-identifying context shown on the public ledger.
alter table patients add column if not exists region text;
alter table patients add column if not exists age_band text;

-- Identity: never shown publicly, never sent to a model, never put on-chain. All fictional.
create table if not exists patient_identities (
  patient_id    text primary key references patients (id) on delete cascade,
  legal_name    text not null,
  date_of_birth date not null,
  ssn           text not null,
  address       text,
  phone         text,
  member_id     text,
  fictional     boolean not null default true
);

-- Audit log: which caseworker device revealed which case's identity, when and why.
create table if not exists identity_reveals (
  id         text primary key,
  patient_id text not null references patients (id) on delete cascade,
  grant_id   text references grants (id) on delete cascade,
  device_id  text not null references devices (id),
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists identity_reveals_grant_idx on identity_reveals (grant_id);

-- The opaque reference written to the fund ledger and the Solana memo. Stored so the public
-- ledger can find the case without recomputing the HMAC.
alter table grants add column if not exists public_ref text;
create unique index if not exists grants_public_ref_idx on grants (public_ref) where public_ref is not null;
-- Memo-only devnet receipt of a decision that moved no money (a declined request).
alter table grants add column if not exists decision_signature text;

-- Institutional funders (hospital community benefit, state programs) can be named; people stay anonymous.
alter table donations add column if not exists donor_label text;
