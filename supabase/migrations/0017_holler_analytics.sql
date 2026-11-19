-- Holler: first-party funnel events and signup attribution. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_events: one row per funnel step (visit, area_check, signup, first_alert, trial_start, paid, app_open).
--   Stores NO IP address, NO user agent, NO referrer URL, no query string, no ZIP and no trade. Only:
--     name        which step
--     session_id  random id from the holler_sid cookie (22 to 40 url-safe characters), null for events with no browser behind them
--     user_id     the member, for steps that belong to an account (signup, trial_start, first_alert, paid); null for visitors
--     source, medium, campaign   first-touch campaign values from the holler_src cookie, lowercase letters, digits, dash, underscore, at most 40
--     path        the page path only, at most 80 characters, no query string
--
-- holler_attribution: one row per member holding their first-touch source, medium and campaign.
--   Why a separate table and not three columns on holler_profiles: the profile table's member write access is a list of column grants
--   (0001, 0002, 0004, 0012) and the billing guard trigger (0004) lists the columns a member may not change. A new profile column would
--   depend on that grant list staying exactly right on a shared database, and the guard would need editing to cover it. A service-role
--   table cannot be written from a browser at all, and holler_profiles is not touched.
--
-- Both tables are service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.
-- Account deletion (Settings > Delete account removes the profile but keeps the shared sign-in): a trigger on holler_profiles deletes the
-- member's events and attribution row, the same way 0008 does for feature picks.
--
-- Safe to apply before or after the code that writes it: the code ignores a missing table (track() never throws).

create table if not exists public.holler_events (
  id bigint generated always as identity primary key,
  name text not null,
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  source text,
  medium text,
  campaign text,
  path text,
  created_at timestamptz not null default now(),
  constraint holler_events_name_check check (name in ('visit', 'area_check', 'signup', 'first_alert', 'trial_start', 'paid', 'app_open')),
  constraint holler_events_session_check check (session_id is null or session_id ~ '^[A-Za-z0-9_-]{22,40}$'),
  constraint holler_events_source_check check (source is null or source ~ '^[a-z0-9_-]{1,40}$'),
  constraint holler_events_medium_check check (medium is null or medium ~ '^[a-z0-9_-]{1,40}$'),
  constraint holler_events_campaign_check check (campaign is null or campaign ~ '^[a-z0-9_-]{1,40}$'),
  -- A path only: starts with a slash, at most 80 characters, and no character that could start a query string or fragment.
  constraint holler_events_path_check check (path is null or (char_length(path) <= 80 and path ~ '^/[A-Za-z0-9/_.-]*$'))
);

create index if not exists holler_events_name_created_idx on public.holler_events (name, created_at);
create index if not exists holler_events_session_idx on public.holler_events (session_id);
-- The delete-account trigger and the cascade look rows up by member.
create index if not exists holler_events_user_idx on public.holler_events (user_id) where user_id is not null;
-- Account steps happen once per member. A retry, a replayed Stripe event or a second cron run hits this index and the insert is dropped.
create unique index if not exists holler_events_once_per_user_idx
  on public.holler_events (user_id, name)
  where user_id is not null and name in ('signup', 'first_alert', 'trial_start', 'paid');
-- One visit (or app open) per session per UTC day, whatever the browser sends.
create unique index if not exists holler_events_once_per_day_idx
  on public.holler_events (session_id, name, ((created_at at time zone 'UTC')::date))
  where session_id is not null and name in ('visit', 'app_open');

alter table public.holler_events enable row level security;
revoke all on table public.holler_events from public, anon, authenticated;
revoke all on sequence public.holler_events_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_events to service_role;
grant usage, select on sequence public.holler_events_id_seq to service_role;

create table if not exists public.holler_attribution (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null,
  medium text,
  campaign text,
  created_at timestamptz not null default now(),
  constraint holler_attribution_source_check check (source ~ '^[a-z0-9_-]{1,40}$'),
  constraint holler_attribution_medium_check check (medium is null or medium ~ '^[a-z0-9_-]{1,40}$'),
  constraint holler_attribution_campaign_check check (campaign is null or campaign ~ '^[a-z0-9_-]{1,40}$')
);

alter table public.holler_attribution enable row level security;
revoke all on table public.holler_attribution from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_attribution to service_role;

-- Retention: events older than p_days are deleted. Called from pg_cron (see the hand-back). Default 400 days.
create or replace function public.holler_events_prune(p_days int default 400)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted int;
begin
  delete from public.holler_events where created_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.holler_events_prune(int) from public, anon, authenticated;
grant execute on function public.holler_events_prune(int) to service_role;

-- Account deletion: remove the member's events and attribution with the profile.
create or replace function public.holler_profiles_delete_analytics()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_events where user_id = old.user_id;
  delete from public.holler_attribution where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_analytics() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_analytics on public.holler_profiles;
create trigger holler_profiles_delete_analytics
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_analytics();
