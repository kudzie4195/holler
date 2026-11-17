-- Holler: initial schema. Purely additive; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.

-- ---------------------------------------------------------------------------
-- holler_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.holler_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null,
  categories text[] not null default '{}',
  zip text,
  city text,
  state text,
  lat double precision,
  lon double precision,
  radius_mi int not null default 25 check (radius_mi between 5 and 100),
  alert_email boolean not null default true,
  subscription_status text not null default 'trialing',
  trial_ends_at timestamptz not null default now() + interval '7 days',
  stripe_customer_id text,
  stripe_subscription_id text,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.holler_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists holler_profiles_set_updated_at on public.holler_profiles;
create trigger holler_profiles_set_updated_at
  before update on public.holler_profiles
  for each row execute function public.holler_set_updated_at();

create index if not exists holler_profiles_state_idx on public.holler_profiles (state);
create index if not exists holler_profiles_categories_idx on public.holler_profiles using gin (categories);
create index if not exists holler_profiles_stripe_customer_idx on public.holler_profiles (stripe_customer_id);

alter table public.holler_profiles enable row level security;

drop policy if exists holler_profiles_select_own on public.holler_profiles;
create policy holler_profiles_select_own on public.holler_profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists holler_profiles_insert_own on public.holler_profiles;
create policy holler_profiles_insert_own on public.holler_profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists holler_profiles_update_own on public.holler_profiles;
create policy holler_profiles_update_own on public.holler_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- holler_signals
-- ---------------------------------------------------------------------------
create table if not exists public.holler_signals (
  id bigserial primary key,
  source text not null,
  external_id text not null,
  kind text not null,
  title text not null,
  summary text,
  url text,
  lat double precision,
  lon double precision,
  city text,
  state text,
  county text,
  zip text,
  place_slug text,
  categories text[] not null default '{}',
  severity smallint not null default 1 check (severity between 1 and 3),
  occurred_at timestamptz not null,
  expires_at timestamptz,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint holler_signals_source_external_id_key unique (source, external_id)
);

create index if not exists holler_signals_place_occurred_idx on public.holler_signals (place_slug, occurred_at desc);
create index if not exists holler_signals_state_occurred_idx on public.holler_signals (state, occurred_at desc);
create index if not exists holler_signals_categories_idx on public.holler_signals using gin (categories);
create index if not exists holler_signals_occurred_idx on public.holler_signals (occurred_at desc);

alter table public.holler_signals enable row level security;

drop policy if exists holler_signals_public_read on public.holler_signals;
create policy holler_signals_public_read on public.holler_signals
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- holler_matches
-- ---------------------------------------------------------------------------
create table if not exists public.holler_matches (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id bigint not null references public.holler_signals(id) on delete cascade,
  distance_mi real,
  status text not null default 'new',
  draft text,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint holler_matches_user_signal_key unique (user_id, signal_id)
);

create index if not exists holler_matches_user_created_idx on public.holler_matches (user_id, created_at desc);
create index if not exists holler_matches_unnotified_idx on public.holler_matches (user_id) where notified = false;
create index if not exists holler_matches_signal_idx on public.holler_matches (signal_id);

alter table public.holler_matches enable row level security;

drop policy if exists holler_matches_select_own on public.holler_matches;
create policy holler_matches_select_own on public.holler_matches
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists holler_matches_update_own on public.holler_matches;
create policy holler_matches_update_own on public.holler_matches
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- holler_scan_runs (service role only: RLS on, no policies)
-- ---------------------------------------------------------------------------
create table if not exists public.holler_scan_runs (
  id bigserial primary key,
  source text,
  started_at timestamptz,
  finished_at timestamptz,
  fetched int,
  inserted int,
  matched int,
  error text
);

create index if not exists holler_scan_runs_source_started_idx on public.holler_scan_runs (source, started_at desc);

alter table public.holler_scan_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges. RLS decides which rows; these grants decide which columns.
-- Users must never be able to write billing fields (subscription_status,
-- trial_ends_at, stripe_*, last_notified_at) or draft/notified/signals directly.
-- Server-only writes use the service role (bypasses grants and RLS).
-- ---------------------------------------------------------------------------
revoke insert, update on table public.holler_profiles from anon, authenticated;
grant insert (user_id, business_name, categories, zip, city, state, lat, lon, radius_mi, alert_email)
  on table public.holler_profiles to authenticated;
grant update (business_name, categories, zip, city, state, lat, lon, radius_mi, alert_email, updated_at)
  on table public.holler_profiles to authenticated;

revoke insert, update, delete on table public.holler_matches from anon, authenticated;
grant update (status) on table public.holler_matches to authenticated;

revoke insert, update, delete on table public.holler_signals from anon, authenticated;
revoke insert, update, delete on table public.holler_scan_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public per-place signal counts (60 days). security_invoker so the caller's
-- RLS on holler_signals applies (public read policy).
-- ---------------------------------------------------------------------------
create or replace view public.holler_place_counts
  with (security_invoker = true) as
select place_slug, count(*)::int as signals_60d, max(occurred_at) as latest_at
from public.holler_signals
where place_slug is not null
  and occurred_at > now() - interval '60 days'
group by place_slug;

grant select on public.holler_place_counts to anon, authenticated;
