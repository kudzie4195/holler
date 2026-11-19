-- Holler: ingest monitor. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_ops_alerts remembers which ingest alerts have been emailed, so the owner is told when something first breaks, then at most
-- once every 24 hours while it lasts, and is not told anything while ingest is fine. One row per alert key, for example
-- 'scan:error', 'feed:silent' or 'source:nws:silent'. It holds keys, times and a count. Never row data.
--   last_state: alerting (emailed in this episode), suppressed (came back inside the 24 hour window, not emailed), recovered.
--
-- holler_source_health gets three columns the monitor needs to tell a quiet feed (no storms today) from a broken one:
--   last_new_at       last successful run that stored at least one new signal
--   last_rows_seen_at last successful run that parsed at least one row, new or not
--   tracked_since     when the row was created, so a brand-new source is not called silent on its first day
-- Existing rows get their values from what is already stored; the scan keeps them current from the next tick.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.

create table if not exists public.holler_ops_alerts (
  key text primary key,
  first_seen_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_state text not null default 'alerting',
  count integer not null default 0,
  constraint holler_ops_alerts_state_check check (last_state in ('alerting', 'suppressed', 'recovered')),
  constraint holler_ops_alerts_key_len check (char_length(key) between 1 and 200),
  constraint holler_ops_alerts_count_check check (count >= 0)
);

alter table public.holler_ops_alerts enable row level security;
revoke all on table public.holler_ops_alerts from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_ops_alerts to service_role;

alter table public.holler_source_health add column if not exists last_new_at timestamptz;
alter table public.holler_source_health add column if not exists last_rows_seen_at timestamptz;
alter table public.holler_source_health add column if not exists tracked_since timestamptz not null default now();

-- Fill from what is stored. Only touches rows that are still empty, so running this twice changes nothing.
update public.holler_source_health set last_new_at = last_run_at where last_new_at is null and rows_new_last_run > 0 and last_run_at is not null;
update public.holler_source_health set last_rows_seen_at = last_run_at where last_rows_seen_at is null and rows_seen_last_run > 0 and last_run_at is not null;
