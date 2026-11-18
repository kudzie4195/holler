-- Holler: per-source delivery health. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_source_health keeps one row per data source (the adapter id, for example 'nws' or 'socrata-chicago-permits'). The scan
-- upserts it after each source runs. It says whether the source is still delivering, so the product never implies coverage it does
-- not have. Internal only: no public page reads it.
--
-- last_error holds an error code or a short message, at most 300 characters. It never holds row data.
-- last_record_at is the newest record time seen from the source (the record's own date, not the time we fetched it).
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.

create table if not exists public.holler_source_health (
  source text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_record_at timestamptz,
  rows_seen_last_run integer not null default 0,
  rows_new_last_run integer not null default 0,
  consecutive_failures integer not null default 0,
  status text not null default 'healthy',
  updated_at timestamptz not null default now(),
  constraint holler_source_health_status_check check (status in ('healthy', 'delayed', 'degraded', 'unavailable')),
  constraint holler_source_health_error_len check (last_error is null or char_length(last_error) <= 300),
  constraint holler_source_health_counts_check check (rows_seen_last_run >= 0 and rows_new_last_run >= 0 and consecutive_failures >= 0)
);

-- The owner's "what is unhealthy" query filters on status.
create index if not exists holler_source_health_status_idx
  on public.holler_source_health (status) where status <> 'healthy';

alter table public.holler_source_health enable row level security;
revoke all on table public.holler_source_health from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_source_health to service_role;
