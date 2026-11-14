-- TimescaleDB features (Tiger Cloud only; skipped on plain Postgres and in tests).
-- The fund ledger becomes a hypertable, and a continuous aggregate feeds the dashboard.

create extension if not exists timescaledb;

select create_hypertable('fund_events', by_range('time'), if_not_exists => true, migrate_data => true);

create materialized view fund_daily
with (timescaledb.continuous) as
select
  time_bucket('1 day', time) as day,
  sum(amount_cents) filter (where type = 'reservation') as approved_cents,
  sum(amount_cents) filter (where type = 'payout')      as paid_cents,
  sum(amount_cents) filter (where type = 'donation')    as donated_cents,
  count(*)          filter (where type = 'payout')      as payouts
from fund_events
group by day
with no data;

-- Refresh often: the demo needs the dashboard to update within a minute.
select add_continuous_aggregate_policy('fund_daily',
  start_offset      => interval '7 days',
  end_offset        => null,
  schedule_interval => interval '1 minute');

-- Real-time aggregation: include not-yet-materialized rows in queries.
alter materialized view fund_daily set (timescaledb.materialized_only = false);
