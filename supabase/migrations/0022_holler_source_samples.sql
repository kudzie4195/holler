-- Holler: holler_source_samples, the holding table for sources on probation (Adapter.probation in lib/signals/types.ts).
-- Purely additive and idempotent; every object is prefixed holler_. Shared Supabase project: never touch non-holler objects.
--
-- A new source whose live output nobody has checked yet is scanned like any other source, but its rows are written here instead of
-- holler_signals / holler_signal_contacts. holler_signals can be read with the public anon key, so unchecked rows never go there:
-- they cannot be matched, pushed, emailed, classified, indexed or shown. Each run keeps up to 300 rows per source and deletes that
-- source's samples older than 14 days. `row` is the full SignalInput as the adapter produced it, plus any contacts it produced.
-- To put a source live, remove `probation: true` from its adapter: the next scan writes to holler_signals normally.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.
--
-- Safe to apply before or after the code that writes it: until it is applied, a probation source logs
-- "holler_source_samples missing: apply 0022" in scan_runs and writes nothing anywhere else.

create table if not exists public.holler_source_samples (
  id bigserial primary key,
  source text not null,
  external_id text not null,
  fetched_at timestamptz not null default now(),
  "row" jsonb not null,
  unique (source, external_id)
);

create index if not exists holler_source_samples_source_fetched_idx
  on public.holler_source_samples (source, fetched_at desc);

alter table public.holler_source_samples enable row level security;

revoke all on table public.holler_source_samples from public, anon, authenticated;
revoke all on sequence public.holler_source_samples_id_seq from public, anon, authenticated;

comment on table public.holler_source_samples is
  'Rows of a source on probation are kept here, service role only, never in holler_signals.';
