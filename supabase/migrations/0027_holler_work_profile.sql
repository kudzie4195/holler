-- Holler 0027: member work profile and feed-only cards (round 18 ROUTES).
-- Additive and idempotent (safe to run twice); holler_* objects only (the project is shared with other products). The owner applies this
-- by hand. No existing row is rewritten: a member with no work-profile row reads the defaults (both / no minimum / both), so matching is
-- unchanged for everyone until a member saves "What work do you take?" in Settings.
--
-- What it adds:
--  1. holler_work_profiles: one row per member (a small table rather than columns on holler_profiles, so no existing read of
--     holler_profiles changes):
--       work_property   'residential' | 'commercial' | 'both' (default 'both')
--       work_min_value  whole US dollars, 1 to 100,000,000, or null (no minimum, the default)
--       work_type       'repairs' | 'installs' | 'both' (default 'both')
--     The row belongs to the member's holler_profiles row and is deleted with it (on delete cascade), so account deletion removes it.
--     RLS on: a member reads, inserts and updates only their own row; nothing for anon. The scan reads it with the service role.
--     Matching reads it (lib/signals/work-profile.ts); a record that does not state a class, a kind of work or a job value is never
--     filtered out.
--  2. holler_matches.alert_hold: null, or why a matched card is feed-only and was NOT sent by email or push:
--       'background' a building permit that names no business and no job-site street address (lib/signals/alert-gate.ts contactPathOf)
--       'below_min'  a permit whose stated job value is below the member's minimum
--       'held'       a trade + rule-family pair in the code table PRECISION_HOLDS (empty at round 18)
--     Written by the scan (service role) only. Members can read it on their own rows (RLS select own, 0001) and can never write it.
--
-- Nothing breaks without it: with this migration NOT applied, the Settings section is hidden, the matcher's work-profile read fails
-- quietly (42P01 / PGRST205) and matching is exactly as before; the scan's match insert is retried without alert_hold, and the email,
-- push and feed reads are retried without it, so every card goes out as it did before round 18.

create table if not exists public.holler_work_profiles (
  user_id uuid primary key references public.holler_profiles(user_id) on delete cascade,
  work_property text not null default 'both',
  work_min_value integer,
  work_type text not null default 'both',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_work_profiles_property_check' and conrelid = 'public.holler_work_profiles'::regclass
  ) then
    alter table public.holler_work_profiles
      add constraint holler_work_profiles_property_check check (work_property in ('residential', 'commercial', 'both'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'holler_work_profiles_min_value_check' and conrelid = 'public.holler_work_profiles'::regclass
  ) then
    alter table public.holler_work_profiles
      add constraint holler_work_profiles_min_value_check check (work_min_value is null or (work_min_value >= 1 and work_min_value <= 100000000));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'holler_work_profiles_type_check' and conrelid = 'public.holler_work_profiles'::regclass
  ) then
    alter table public.holler_work_profiles
      add constraint holler_work_profiles_type_check check (work_type in ('repairs', 'installs', 'both'));
  end if;
end
$$;

drop trigger if exists holler_work_profiles_set_updated_at on public.holler_work_profiles;
create trigger holler_work_profiles_set_updated_at
  before update on public.holler_work_profiles
  for each row execute function public.holler_set_updated_at();

alter table public.holler_work_profiles enable row level security;

drop policy if exists holler_work_profiles_select_own on public.holler_work_profiles;
create policy holler_work_profiles_select_own on public.holler_work_profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists holler_work_profiles_insert_own on public.holler_work_profiles;
create policy holler_work_profiles_insert_own on public.holler_work_profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists holler_work_profiles_update_own on public.holler_work_profiles;
create policy holler_work_profiles_update_own on public.holler_work_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Grants: nothing for anon; a member gets exactly what the Settings save needs (an upsert of their own row: PostgREST's upsert also sets
-- user_id on conflict, so update covers it; the update policy's check keeps it the member's own id). No delete: the row goes with the
-- profile (cascade, service role).
revoke all on table public.holler_work_profiles from public, anon, authenticated;
grant select on table public.holler_work_profiles to authenticated;
grant insert (user_id, work_property, work_min_value, work_type) on table public.holler_work_profiles to authenticated;
grant update (user_id, work_property, work_min_value, work_type) on table public.holler_work_profiles to authenticated;
grant select, insert, update, delete on table public.holler_work_profiles to service_role;

-- holler_matches.alert_hold (RLS on since 0001, unchanged). holler_matches is the busiest table: every statement on it waits at most 5 s
-- for its lock and then fails (re-run the file; it converges) instead of queueing every reader and writer behind it.
set lock_timeout = '5s';

-- A nullable column with no default: a catalog change only, no table rewrite.
alter table public.holler_matches add column if not exists alert_hold text;

-- The check is added NOT VALID: Postgres then checks only rows written from now on and does not scan the table under an exclusive lock.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_matches_alert_hold_check' and conrelid = 'public.holler_matches'::regclass
  ) then
    alter table public.holler_matches
      add constraint holler_matches_alert_hold_check check (alert_hold is null or alert_hold in ('background', 'below_min', 'held')) not valid;
  end if;
end
$$;

-- Separate statement: validates the existing rows (every one is null, the column is new) under a SHARE UPDATE EXCLUSIVE lock, which does
-- not block reads or writes. The owner can run this one statement again at any time, on its own; on a constraint that is already valid
-- it does nothing.
alter table public.holler_matches validate constraint holler_matches_alert_hold_check;

reset lock_timeout;

-- Only the scan (service role) writes alert_hold.
revoke insert (alert_hold), update (alert_hold) on table public.holler_matches from anon, authenticated;
