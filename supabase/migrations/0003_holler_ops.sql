-- Holler: ops. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.

-- ---------------------------------------------------------------------------
-- holler_place_counts gains latest_at (newest occurred_at per place, inside the same 60 day window).
-- CREATE OR REPLACE VIEW may append columns at the end, so existing readers of
-- (place_slug, signals_60d) keep working. security_invoker stays on so the caller's
-- RLS on holler_signals applies, and the grants are re-asserted so this file stands alone.
-- latest_at ignores rows that have not started yet (events and event permits are stored with a future occurred_at),
-- so a city with an upcoming event still gets a real last-modified time and never one in the future.
-- The count covers rows from the last 60 days up to 14 days ahead, so a mistyped far-future date is never counted.
-- 0001 defines the same view with the same text, so re-running 0001 never changes it.
-- ---------------------------------------------------------------------------
create or replace view public.holler_place_counts
  with (security_invoker = true) as
select place_slug,
       count(*)::int as signals_60d,
       max(occurred_at) filter (where occurred_at <= now()) as latest_at
from public.holler_signals
where place_slug is not null
  and occurred_at > now() - interval '60 days'
  and occurred_at <= now() + interval '14 days'
group by place_slug;

grant select on public.holler_place_counts to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes.
-- "Signals by categories + time" (the area checker, the first-login backfill, the matcher) is served by indexes
-- that 0001 already created: holler_signals_categories_idx (gin on categories) for the overlap test and
-- holler_signals_occurred_idx / holler_signals_place_occurred_idx (btree on occurred_at desc) for the time order.
-- A combined gin(categories, occurred_at) would need the btree_gin extension, which is not ours to install in a shared
-- project, so nothing is added for that query.
--
-- What was missing: the daily health report reads holler_scan_runs by started_at across every source,
-- and the existing index starts with source.
-- ---------------------------------------------------------------------------
create index if not exists holler_scan_runs_started_idx on public.holler_scan_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- The area checker reads holler_signals by a latitude/longitude bounding box around the ZIP (25 miles), so a ZIP with
-- no tracked city nearby still sees records that carry coordinates. A btree on (lat, lon) serves the lat range; the
-- partial predicate keeps rows without coordinates (state-level alerts) out of it.
-- ---------------------------------------------------------------------------
create index if not exists holler_signals_lat_lon_idx on public.holler_signals (lat, lon) where lat is not null;

-- ---------------------------------------------------------------------------
-- holler_signals_near: records with coordinates inside a radius, newest first, limited AFTER the distance test.
-- Why a function: a bounding box with a row limit (what the checker and the first-login backfill used) fills the limit with rows
-- that are in the box but outside the circle (a few hours of NYC 311 and heat complaints reach Morristown NJ, Stamford CT and
-- Trenton NJ), and the page then trims them to nothing. Here the great-circle distance is computed in SQL, so the limit applies to
-- rows that really are inside the radius.
--  - The lat/lon box is only a prefilter, so holler_signals_lat_lon_idx serves it. The box is slightly generous (68.9 mi per degree
--    of latitude, a little below the true 69.09) and spans the whole -180..180 range when it would cross the antimeridian.
--  - Rows without coordinates (state-level alerts) are never returned here. Read them with their own query so nothing crowds them out.
--  - p_limit is clamped to 1..500 and the radius to 0.1..150 miles inside the function, so no caller can ask for the table.
--  - p_soonest_first orders ascending, for "what starts next" reads (upcoming events); the default is newest first.
--  - p_min_severity (default 1) keeps only rows at that severity or higher, so a short severe-only read cannot be crowded out by a dense
--    feed of severity-1 rows (the checker and the first-login backfill each make one).
--  - p_before_id (default null) is a keyset cursor for newest-first paging: pass the oldest row's occurred_at as p_until and its id here and the
--    next page starts strictly after that row in (occurred_at desc, id desc) order, so a feed with many identical timestamps pages in full.
--  - The longitude test is a plain BETWEEN on values computed from the parameters (-180..180 when the box would cross the antimeridian), with
--    no OR, so holler_signals_lat_lon_idx can take both bounds even in a generic plan (a non-inlined SQL function is planned without parameter values).
--  - SECURITY INVOKER with a fixed search_path: it reads only public.holler_signals, under the caller's own RLS (anyone may select).
-- Upgrade: the earlier 8-argument version is dropped first, so PostgREST never sees two overloads (PGRST203). Re-runnable in any order with
-- 0001/0002: drop if exists on the old signature, create or replace on the new one, then grants.
-- ---------------------------------------------------------------------------
drop function if exists public.holler_signals_near(double precision, double precision, real, text[], timestamptz, timestamptz, int, boolean);

create or replace function public.holler_signals_near(
  p_lat double precision,
  p_lon double precision,
  p_radius_mi real,
  p_categories text[],
  p_since timestamptz,
  p_until timestamptz,
  p_limit int default 100,
  p_soonest_first boolean default false,
  p_min_severity int default 1,
  p_before_id bigint default null
)
returns table (
  id bigint,
  source text,
  external_id text,
  kind text,
  title text,
  summary text,
  url text,
  lat double precision,
  lon double precision,
  city text,
  state text,
  county text,
  zip text,
  place_slug text,
  categories text[],
  severity smallint,
  occurred_at timestamptz,
  expires_at timestamptz,
  data jsonb,
  distance_mi double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select
      least(greatest(coalesce(p_radius_mi, 25)::double precision, 0.1), 150) as r,
      p_lat as lat0,
      p_lon as lon0
  ),
  box as (
    select
      r, lat0, lon0,
      r / 68.9 as d_lat,
      r / (68.9 * greatest(0.05, cos(radians(least(89, abs(lat0) + r / 68.9))))) as d_lon
    from b
  ),
  bounds as (
    select
      r, lat0, lon0, d_lat,
      case when abs(lon0) + d_lon > 180 then -180::double precision else lon0 - d_lon end as lon_lo,
      case when abs(lon0) + d_lon > 180 then 180::double precision else lon0 + d_lon end as lon_hi
    from box
  )
  select
    s.id, s.source, s.external_id, s.kind, s.title, s.summary, s.url, s.lat, s.lon, s.city, s.state, s.county, s.zip,
    s.place_slug, s.categories, s.severity, s.occurred_at, s.expires_at, s.data, d.distance_mi
  from bounds box
  join public.holler_signals s
    on s.lat is not null
   and s.lon is not null
   and s.lat between box.lat0 - box.d_lat and box.lat0 + box.d_lat
   and s.lon between box.lon_lo and box.lon_hi
  cross join lateral (
    select 3958.8 * 2 * asin(least(1, sqrt(
      power(sin(radians(s.lat - box.lat0) / 2), 2)
      + cos(radians(box.lat0)) * cos(radians(s.lat)) * power(sin(radians(s.lon - box.lon0) / 2), 2)
    ))) as distance_mi
  ) d
  where s.categories && p_categories
    and (s.expires_at is null or s.expires_at > now())
    and s.occurred_at >= p_since
    and s.occurred_at <= p_until
    and d.distance_mi <= box.r
    and s.severity >= coalesce(p_min_severity, 1)
    and (p_before_id is null or s.occurred_at < p_until or s.id < p_before_id)
  order by
    case when p_soonest_first then s.occurred_at end asc,
    s.occurred_at desc,
    s.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

revoke all on function public.holler_signals_near(double precision, double precision, real, text[], timestamptz, timestamptz, int, boolean, int, bigint) from public;
grant execute on function public.holler_signals_near(double precision, double precision, real, text[], timestamptz, timestamptz, int, boolean, int, bigint) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The area checker now writes one holler_rate_limits row per visitor, and the daily prune deletes rows older than two days.
-- Without an index on window_start that delete is a sequential scan of the whole table.
-- ---------------------------------------------------------------------------
-- 0002 creates the table and the same index; this guarded copy covers a database where 0002 has not run yet (it then gets the index when 0002 does).
do $$
begin
  if to_regclass('public.holler_rate_limits') is not null then
    create index if not exists holler_rate_limits_window_idx on public.holler_rate_limits (window_start);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- One free trial per person, enforced where the row is written.
-- lib/auth/trial.ts stamps app_metadata.holler_trial_started_at (a returning user's first profile created_at, or the day they left).
-- It only ran in onboarding, so a returning user could get a fresh 7 days by saving settings (an upsert) or by inserting their own
-- profile with their own JWT. This BEFORE INSERT trigger reads the stamp and cuts trial_ends_at to stamp + 7 days.
--  - least(): never lengthens a trial, and a first-time user (no stamp) keeps the column default untouched.
--  - On first onboarding the stamp equals the profile's created_at, so stamp + 7 days equals the default: nothing is shortened.
--  - SECURITY DEFINER so it can read auth.users (authenticated users cannot); fixed search_path; an unparseable stamp is ignored.
--  - If the shared project has no auth.users with that column the exception handler lets the insert through unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.holler_profiles_trial_from_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v text;
  v_start timestamptz;
begin
  begin
    select raw_app_meta_data ->> 'holler_trial_started_at' into v from auth.users where id = new.user_id;
    if v is not null then
      v_start := v::timestamptz;
      new.trial_ends_at := least(new.trial_ends_at, v_start + interval '7 days');
    end if;
  exception when others then
    -- never block a signup because of a bad stamp
    null;
  end;
  return new;
end;
$$;

revoke all on function public.holler_profiles_trial_from_stamp() from public, anon, authenticated;

drop trigger if exists holler_profiles_trial_from_stamp on public.holler_profiles;
create trigger holler_profiles_trial_from_stamp
  before insert on public.holler_profiles
  for each row execute function public.holler_profiles_trial_from_stamp();
