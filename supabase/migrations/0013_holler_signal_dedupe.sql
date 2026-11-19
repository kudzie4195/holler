-- Holler 0013 (round 7, MATCH): signal de-duplication. NO-DELETE migration: it changes no row and no schema.
--
-- An earlier draft of this file deleted rows that shared source, subtype, UTC day, place and title under different external ids.
-- Review r1 showed those are different records (three DeKalb HVAC permits at one address on one day, three Johns Creek permits in
-- different suites), and the delete cascaded a member's only match away. The rule is now:
--   two rows are the same record only when every public field (title, summary, url, occurred_at, location) is identical AND the
--   source's adapter is known to re-issue ids for the same record (lib/signals/store.ts REISSUED_ID_SOURCES).
-- No source is known to do that, so nothing stored is safe to remove, and the insert-time check (lib/signals/store.ts
-- dropDuplicateRecords) reads nothing for any source today, so it needs no index. This file therefore only reports, as NOTICEs:
--   - that it removed 0 rows, and
--   - how many stored rows share source, subtype, day, place and title with another row under a different external id (they are
--     kept as separate records; the count is for the record only).
-- Read only, safe to run any number of times, and a no-op when public.holler_signals does not exist.

do $$
declare
  groups bigint := 0;
  shared bigint := 0;
begin
  if to_regclass('public.holler_signals') is null then
    raise notice 'holler 0013: public.holler_signals does not exist, nothing to do';
    return;
  end if;

  select count(*), coalesce(sum(n), 0)
    into groups, shared
  from (
    select count(*) as n
    from public.holler_signals s
    where nullif(btrim(coalesce(s.data->>'subtype', '')), '') is not null
      and s.title is not null
      and (s.lat is not null and s.lon is not null)
    group by
      s.source,
      btrim(s.data->>'subtype'),
      ((s.occurred_at at time zone 'UTC')::date),
      round(s.lat::numeric, 5),
      round(s.lon::numeric, 5),
      btrim(s.title)
    having count(distinct s.external_id) > 1
  ) g;

  raise notice 'holler 0013: removed 0 signal rows and moved 0 matches (no source is known to re-issue ids)';
  raise notice 'holler 0013: % rows in % groups share source, subtype, day, place and title under different external ids; they are different records and are kept', shared, groups;
end
$$;
