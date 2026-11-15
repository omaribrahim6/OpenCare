-- Patient portal (/user): a patient signs in on their own phone with the public account ID printed
-- on their CareCard (or a tap of the card) plus their birth date. Kiosk sessions are untouched:
-- portal sessions live in their own table and cookie.

-- Public account ID printed on the card, e.g. "otc7-jd4-rx19". Not a secret: the NFC token is.
alter table patients add column if not exists account_code text;
alter table patients add column if not exists birth_date date;

-- Match ignoring case, dashes and spaces, and treat o/0 and i/l/1 as the same character.
create unique index if not exists patients_account_code_key
  on patients (translate(regexp_replace(lower(account_code), '[^a-z0-9]', '', 'g'), 'oil', '011'))
  where account_code is not null;

create table if not exists portal_sessions (
  secret_hash text primary key,
  patient_id  text not null references patients (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz
);
create index if not exists portal_sessions_patient_idx on portal_sessions (patient_id);

-- Failed sign-ins, so a birth date can't be guessed by trying every day of the year.
create table if not exists portal_sign_in_failures (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists portal_sign_in_failures_key_idx on portal_sign_in_failures (key, at);
