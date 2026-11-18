-- Holler: ONE-TIME DATA FIX for the PUBLIC holler_signals text and positions written by scans before round 5.
-- No schema change. Touches public.holler_signals only; never any non-holler object. Needs no name classifier: it rewrites every row
-- of the two affected kinds.
--
-- What it removes:
-- 1. Food inspection signals (source ends in '-inspections'): the WHOLE title becomes
--    'Failed inspection in ' || coalesce(nullif(city, ''), 'this city') || ': food establishment' (the title the round 5 parser writes
--    for the same row, from the same city column; round 5 FIX-F, review4 P2-1), the whole summary (it held the establishment name or the
--    street address), exact coordinates (lat and lon are rounded to 3 decimals, about one block), and a zip that is not exactly 5 digits
--    (set to null). A home daycare or a one-person shop is registered under a person's name.
-- 2. Federal contract signals (source = 'usaspending'): the "Awarded to <recipient>" clause at the start of the summary, up to
--    ", by " or ", NAICS ". When neither follows, the summary is cleared. The recipient can be a person.
-- 3. Federal contract titles (source = 'usaspending', review3 P1-2): every title tail after the first ': ' (the award description, free
--    text that can name a person in any shape) becomes 'NAICS ' || data->>'naics' when that value is 2 to 6 digits (review4 P2-2), else
--    'federal award'. No pattern matching on names. Tails the round 5 parser writes ("<trade label> (NAICS <code>)") and tails that already
--    equal the fallback are skipped (review4 P2-3).
--
-- Idempotent and safe to re-run at any time, also after scans have resumed (review4 P2-3): each statement only touches rows that still
-- differ from its result. A re-run after new scans does two things to rows the new code wrote: it clears the summary of new inspection
-- rows (fixed values and a block-level address; the title, position and zip of those rows already match), and it shortens a new federal
-- award title that has a trade label but no NAICS code to "federal award". Nothing personal is involved either way. Run it once after
-- the code deploy.

update public.holler_signals
   set title = 'Failed inspection in ' || coalesce(nullif(city, ''), 'this city') || ': food establishment',
       summary = null,
       lat = case when lat is null then null else round(lat::numeric, 3)::double precision end,
       lon = case when lon is null then null else round(lon::numeric, 3)::double precision end,
       zip = case when zip ~ '^[0-9]{5}$' then zip else null end
 where right(source, 12) = '-inspections'
   and (
     summary is not null
     or title is distinct from 'Failed inspection in ' || coalesce(nullif(city, ''), 'this city') || ': food establishment'
     or (lat is not null and lat <> round(lat::numeric, 3)::double precision)
     or (lon is not null and lon <> round(lon::numeric, 3)::double precision)
     or (zip is not null and zip !~ '^[0-9]{5}$')
   );

update public.holler_signals
   set summary = case
                   when summary ~ '^Awarded to .*?, (by |NAICS )' then regexp_replace(summary, '^Awarded to .*?, (by |NAICS )', '\1')
                   else null
                 end
 where source = 'usaspending'
   and summary like 'Awarded to %';

with t as (
  select id,
         substr(title, 1, position(': ' in title) + 1) as head,
         substr(title, position(': ' in title) + 2) as tail,
         case when coalesce(data->>'naics', '') ~ '^[0-9]{2,6}$' then 'NAICS ' || (data->>'naics') else 'federal award' end as fallback
    from public.holler_signals
   where source = 'usaspending'
     and position(': ' in title) > 0
)
update public.holler_signals s
   set title = t.head || t.fallback
  from t
 where s.id = t.id
   and t.tail <> t.fallback
   and t.tail !~ '^.+ \(NAICS [0-9]{2,6}\)$';
