-- Spec rev 6: the bill-reduction pipeline (SPEC §7–§9).
-- A hospital device logs a visit; insurance and every hospital policy post events to the visit's
-- bill; the remaining balance goes to the community fund, where a reviewer's approval pays the
-- hospital. Additive: rev 5 documents and grants keep working until the web screens move over.

-- Devices: "hospital" is the intake terminal (replaces "provider", which stays valid for now).
alter table devices drop constraint if exists devices_role_check;
alter table devices drop constraint if exists devices_check;
alter table devices add constraint devices_role_check
  check (role in ('kiosk', 'hospital', 'reviewer', 'provider'));
alter table devices add constraint devices_hospital_needs_provider
  check (role not in ('hospital', 'provider') or provider_id is not null);

-- A made-up insurance plan per demo patient (SPEC §3). No row means uninsured.
create table insurance_plans (
  patient_id            text primary key references patients (id) on delete cascade,
  payer_name            text not null,
  deductible_cents      bigint not null check (deductible_cents >= 0),
  deductible_met_cents  bigint not null default 0 check (deductible_met_cents >= 0),
  coinsurance_pct       int not null check (coinsurance_pct between 0 and 100),
  oop_max_cents         bigint not null check (oop_max_cents >= 0),
  oop_met_cents         bigint not null default 0 check (oop_met_cents >= 0)
);

-- Seeded visits a hospital device can log. Descriptions are untrusted text.
create table visit_templates (
  id          text primary key,
  hospital_id text not null references providers (id) on delete cascade,
  label       text not null,
  category    text not null check (category in ('pharmacy', 'emergency', 'hospital', 'primary_care',
                                                'dental_vision', 'other_medical')),
  description text not null,
  line_items  jsonb not null,
  total_cents bigint not null check (total_cents > 0),
  sort_order  int not null default 0
);

create table visits (
  id              text primary key,
  patient_id      text not null references patients (id) on delete cascade,
  hospital_id     text not null references providers (id),
  template_id     text references visit_templates (id) on delete set null,
  visit_date      date not null default current_date,
  category        text not null check (category in ('pharmacy', 'emergency', 'hospital', 'primary_care',
                                                    'dental_vision', 'other_medical')),
  description     text not null,
  line_items      jsonb not null,
  total_cents     bigint not null check (total_cents > 0),
  device_id       text references devices (id) on delete set null,
  attested_by     text not null,
  idempotency_key text not null unique,
  suspicious      jsonb,
  explanation     jsonb,
  created_at      timestamptz not null default now()
);
create index visits_patient_idx on visits (patient_id, created_at desc);

-- Each hospital's assistance policies: fictional, hand-written rules (SPEC §7.2).
create table hospital_policies (
  id          text primary key,
  hospital_id text not null references providers (id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('charity_care', 'self_pay_discount', 'catastrophic_cap')),
  rules       jsonb not null,
  apply_order int not null,
  source      text not null,
  reviewed_on date not null,
  fictional   boolean not null default true,
  unique (hospital_id, apply_order)
);

-- One application per visit and policy; submission and the hospital's decision are simulated.
create table policy_applications (
  id               text primary key,
  visit_id         text not null references visits (id) on delete cascade,
  policy_id        text not null references hospital_policies (id),
  evaluation       jsonb not null,
  application_text text not null,
  text_source      text not null check (text_source in ('gemini', 'template')),
  status           text not null check (status in ('prepared', 'submitted_simulated',
                                                   'approved_simulated', 'denied_simulated')),
  reduction_cents  bigint not null default 0 check (reduction_cents >= 0),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  unique (visit_id, policy_id)
);

-- The bill ledger (SPEC §8). Fund grants are read from the grants table, so a grant's status
-- and the bill can never disagree; every other event is stored here exactly once.
create table bill_events (
  id           text primary key,
  visit_id     text not null references visits (id) on delete cascade,
  type         text not null check (type in ('charge', 'insurance_adjustment', 'hospital_assistance',
                                              'patient_payment')),
  amount_cents bigint not null check (amount_cents > 0),
  source_kind  text not null check (source_kind in ('hospital', 'insurer', 'policy', 'patient')),
  source_label text not null,
  source_id    text,
  status       text not null default 'confirmed' check (status in ('pending', 'confirmed')),
  simulated    boolean not null default false,
  reference    text,
  label        text not null,
  seq          int not null,
  created_at   timestamptz not null default now(),
  unique (visit_id, seq)
);
create unique index bill_events_one_charge on bill_events (visit_id) where type = 'charge';
create unique index bill_events_one_insurance on bill_events (visit_id) where type = 'insurance_adjustment';
create unique index bill_events_one_per_policy on bill_events (visit_id, reference) where type = 'hospital_assistance';

-- Grants: rev 6 requests point at a visit instead of a Nessie document.
alter table grants alter column document_id drop not null;
alter table grants add column visit_id text references visits (id);
alter table grants add constraint grants_document_or_visit check (document_id is not null or visit_id is not null);
-- One live request per visit: a rejected or canceled one can be asked again.
create unique index grants_one_live_per_visit on grants (visit_id)
  where visit_id is not null and status not in ('rejected', 'canceled');

-- The decision brief per grant, cached by a hash of its inputs (SPEC §7.4).
create table decision_briefs (
  grant_id    text primary key references grants (id) on delete cascade,
  inputs_hash text not null,
  brief       jsonb not null,
  source      text not null check (source in ('gemini', 'template')),
  checked     boolean not null,
  computed_at timestamptz not null default now()
);
