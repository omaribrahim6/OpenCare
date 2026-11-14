-- Public profiles for everyone money moves between (fraud resistance): who gave, who was paid,
-- and non-identifying context about who received care. All seeded records are fictional.

-- Funders. Institutions are always named; a person can choose to be named or stay anonymous.
create table if not exists donors (
  id          text primary key,
  name        text not null,
  kind        text not null check (kind in ('state_program', 'federal_program', 'hospital', 'foundation',
                                            'corporate', 'community', 'individual')),
  public_name boolean not null default true,
  ein         text,
  address     text,
  website     text,
  contact     text,
  description text,
  fictional   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table donations add column if not exists donor_id text references donors (id) on delete set null;
-- Public note from the donor (purpose or restriction), e.g. "Pediatric trauma care".
alter table donations add column if not exists purpose text;

-- Hospitals (and other payees): the public facts a payout is checked against.
alter table providers add column if not exists address text;
alter table providers add column if not exists ein text;
alter table providers add column if not exists npi text;
alter table providers add column if not exists website text;
alter table providers add column if not exists phone text;
alter table providers add column if not exists nonprofit boolean;
alter table providers add column if not exists beds int;
alter table providers add column if not exists description text;

-- Non-identifying context about the patient's situation, e.g. "Construction worker, unable to work".
alter table patients add column if not exists employment text;
