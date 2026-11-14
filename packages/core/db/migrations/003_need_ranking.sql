-- Spec rev 5: need-based ranking replaces bill scanning (SPEC §3, §7, §9).
-- Documents become copies of the patient's chosen Nessie item; grants lose program matching
-- and gain a hardship note and second approvals; need assessments and Gemini rankings are stored.
-- No grants or documents existed yet, so those tables are rebuilt rather than altered.

drop table payment_attempts;
drop table grants;
drop table documents;

-- Need profile, set at enrollment (seeded for the demo). Null means unknown.
alter table patients add column household_size int check (household_size between 1 and 20);
alter table patients add column monthly_income_cents bigint check (monthly_income_cents >= 0);
alter table patients add column insurance_status text
  check (insurance_status in ('uninsured', 'underinsured', 'insured'));

-- The Nessie bill or purchase a patient chose. Merchant and description are untrusted text.
create table documents (
  id             text primary key,
  patient_id     text not null references patients (id) on delete cascade,
  source         text not null check (source in ('nessie_bill', 'nessie_purchase')),
  nessie_id      text not null,
  merchant       text not null,
  description    text,
  bill_date      date,
  amount_cents   bigint not null check (amount_cents > 0),
  likely_medical boolean,
  category       text check (category in ('pharmacy', 'emergency', 'hospital', 'primary_care',
                                          'dental_vision', 'other_medical')),
  created_at     timestamptz not null default now(),
  unique (patient_id, nessie_id)
);

create table grants (
  id                 text primary key,
  patient_id         text not null references patients (id),
  document_id        text not null unique references documents (id),
  provider_id        text not null references providers (id),
  requested_cents    bigint not null check (requested_cents > 0),
  approved_cents     bigint check (approved_cents > 0),
  hardship_note      text check (char_length(hardship_note) <= 500),
  status             text not null default 'pending_review'
                     check (status in ('draft', 'pending_review', 'approved', 'rejected',
                                       'canceled', 'payment_pending', 'paid')),
  reviewer_device_id text references devices (id),
  decision_note      text,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  paid_at            timestamptz,
  updated_at         timestamptz not null default now(),
  check (approved_cents is null or approved_cents <= requested_cents),
  check (status not in ('approved', 'payment_pending', 'paid') or approved_cents is not null)
);
create index grants_status_idx on grants (status);
create index grants_patient_idx on grants (patient_id);

-- One approval per caseworker device. Large grants need two distinct devices (SPEC §2).
create table grant_approvals (
  grant_id           text not null references grants (id) on delete cascade,
  reviewer_device_id text not null references devices (id),
  approved_cents     bigint not null check (approved_cents > 0),
  created_at         timestamptz not null default now(),
  primary key (grant_id, reviewer_device_id)
);

-- Same as 001: one row per external payment call, at most one live attempt per grant and rail.
create table payment_attempts (
  id                      text primary key,
  grant_id                text not null references grants (id),
  rail                    text not null check (rail in ('nessie', 'solana')),
  idempotency_key         text not null unique,
  amount_cents            bigint,
  lamports                bigint,
  recipient               text not null,
  external_id             text,
  signed_tx               text,
  last_valid_block_height bigint,
  status                  text not null default 'pending'
                          check (status in ('pending', 'confirmed', 'failed', 'expired')),
  error                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index payment_attempts_one_live
  on payment_attempts (grant_id, rail)
  where status in ('pending', 'confirmed');

-- Latest formula assessment per grant (SPEC §7 job 2). Recomputed as wait time grows.
create table need_assessments (
  grant_id         text primary key references grants (id) on delete cascade,
  score            int not null check (score between 0 and 100),
  formula_version  text not null,
  inputs           jsonb not null,
  assessment       jsonb not null,
  suspicious       jsonb,
  computed_at      timestamptz not null default now()
);

-- Gemini's queue order, cached by a hash of the queue's inputs so a reload never reshuffles.
create table queue_rankings (
  inputs_hash  text primary key,
  source       text not null check (source in ('gemini', 'formula')),
  grant_order  jsonb not null,
  rationales   jsonb not null,
  model        text,
  computed_at  timestamptz not null default now()
);

-- Donations (SPEC §8): anonymous, one row per card deposit or devnet SOL transfer.
create table donations (
  id                text primary key,
  rail              text not null check (rail in ('nessie', 'solana')),
  amount_cents      bigint not null check (amount_cents > 0),
  nessie_deposit_id text unique,
  solana_signature  text unique,
  created_at        timestamptz not null default now()
);
