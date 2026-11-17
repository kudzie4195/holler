-- Holler: ops. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.

-- ---------------------------------------------------------------------------
-- holler_place_counts gains latest_at (newest occurred_at per place, inside the same 60 day window).
-- CREATE OR REPLACE VIEW may append columns at the end, so existing readers of
-- (place_slug, signals_60d) keep working. security_invoker stays on so the caller's
-- RLS on holler_signals applies, and the grants are re-asserted so this file stands alone.
-- ---------------------------------------------------------------------------
create or replace view public.holler_place_counts
  with (security_invoker = true) as
select place_slug,
       count(*)::int as signals_60d,
       max(occurred_at) as latest_at
from public.holler_signals
where place_slug is not null
  and occurred_at > now() - interval '60 days'
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
