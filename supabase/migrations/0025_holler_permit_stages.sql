-- Holler 0025: permit stage history (PLAN-2.0 2.1) and project links + duplicate log (PLAN-2.0 2.3).
-- Purely additive and idempotent; every object is prefixed holler_. Shared Supabase project: never touch non-holler objects.
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.
--
-- The code works WITHOUT this migration: a scan that finds a table missing turns the feature off for that scan (no stage
-- tracking, no cross-record dedupe) and carries on exactly as before. Applying it changes no stored row.
--
-- 1. holler_permit_stages: one row per (source, permit id, stage) the scan has seen. The permit id is the record's own external id
--    (the permit number inside its source), so (source, permit_id) is the stable id of a permit. The stage is one of five fixed codes
--    (lib/signals/stage.ts); the portal's own status text is never stored. emitted marks the row that started the one "coming soon"
--    update for that permit. signal_id is ON DELETE SET NULL: the history outlives the 120 day signal prune, so a permit that was already
--    updated is never updated again when a portal later lists it once more.
-- 2. holler_project_links: one row per stored permit that has a street address and a trade, keyed by a normalized address + trade
--    (lib/signals/project.ts). A new record is compared with the rows of the same key inside the 3 day window. A record that matches an
--    earlier one is still stored (two permit numbers are two permits); root_source / root_external_id name the first record of its
--    project, which is the project's one card. Rows go with their signal.
-- 3. holler_dedupe_drops: one row per record stored as a FOLLOWER of an earlier record (same project: kind 'duplicate' for the same source
--    or a mirror, 'corroboration' for another source). Nothing is dropped; the name is kept for the dashboard. Ids and the kind only: no
--    address, title or text. The quality dashboard counts it per source for the last 7 days; the scan deletes rows older than 30 days.

create table if not exists public.holler_permit_stages (
  source text not null,
  permit_id text not null,
  stage text not null,
  signal_id bigint references public.holler_signals (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  emitted boolean not null default false,
  constraint holler_permit_stages_pk primary key (source, permit_id, stage),
  constraint holler_permit_stages_stage_check check (stage in ('issued', 'final_inspection', 'finaled', 'certificate_of_occupancy', 'stopped')),
  constraint holler_permit_stages_len check (char_length(source) between 1 and 80 and char_length(permit_id) between 1 and 200)
);

create index if not exists holler_permit_stages_signal_idx on public.holler_permit_stages (signal_id);

create table if not exists public.holler_project_links (
  id bigserial primary key,
  project_key text not null,
  source text not null,
  external_id text not null,
  signal_id bigint not null references public.holler_signals (id) on delete cascade,
  occurred_at timestamptz not null,
  city text,
  lat double precision,
  lon double precision,
  root_source text,
  root_external_id text,
  created_at timestamptz not null default now(),
  constraint holler_project_links_record_key unique (source, external_id),
  constraint holler_project_links_len check (char_length(project_key) between 1 and 300)
);

create index if not exists holler_project_links_key_idx on public.holler_project_links (project_key, occurred_at);
create index if not exists holler_project_links_signal_idx on public.holler_project_links (signal_id);

create table if not exists public.holler_dedupe_drops (
  source text not null,
  external_id text not null,
  kind text not null,
  of_source text not null,
  of_external_id text not null,
  dropped_at timestamptz not null default now(),
  constraint holler_dedupe_drops_pk primary key (source, external_id),
  constraint holler_dedupe_drops_kind_check check (kind in ('duplicate', 'corroboration'))
);

create index if not exists holler_dedupe_drops_when_idx on public.holler_dedupe_drops (source, dropped_at desc);

alter table public.holler_permit_stages enable row level security;
alter table public.holler_project_links enable row level security;
alter table public.holler_dedupe_drops enable row level security;

revoke all on table public.holler_permit_stages from public, anon, authenticated;
revoke all on table public.holler_project_links from public, anon, authenticated;
revoke all on table public.holler_dedupe_drops from public, anon, authenticated;
revoke all on sequence public.holler_project_links_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.holler_permit_stages to service_role;
grant select, insert, update, delete on table public.holler_project_links to service_role;
grant select, insert, update, delete on table public.holler_dedupe_drops to service_role;
grant usage, select on sequence public.holler_project_links_id_seq to service_role;
