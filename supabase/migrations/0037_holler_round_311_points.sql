-- Holler: round the stored map point of every 311 row to 3 decimals (about 100 m, a block), final review P2-1 of round 20. One-time data fix,
-- idempotent, holler_ objects only (shared Supabase project: never touch non-holler objects). No schema change, no grant change.
--
-- Why: holler_signals is readable with the public key, and a 311 row (a NYC heat complaint, a sewer back-up) is often about a home. Since
-- the round 20 final-fix deploy the scan stores every NEW 311 row rounded, like violation and inspection rows (lib/signals/adapters/socrata.ts
-- privatePosition). This file rounds the rows stored BEFORE that deploy. The code does not need it: with it unapplied, old rows keep their
-- exact point and nothing breaks.
--
-- What it touches: only rows of holler_signals whose source is one of the 311 sources below (and whose data.subtype is '311'), and only
-- their lat and lon columns. Rounding is half up, exactly as the app's Math.round(x * 1000) / 1000, so a row the app already rounded is
-- never changed. Running it again changes nothing (rows already on the 3-decimal grid are skipped).
--
-- When: any time after the deploy. Best 9 days after it: the NYC per-building heat count (lib/signals/repeat-marks.ts) joins a stored
-- complaint written before the deploy by its exact point; once rounded, such a complaint no longer counts toward its building's 3 in 48 h.
-- After 9 days (7 quiet days + the 48 h window) no pre-deploy complaint is read by the count, so running it then changes no card.
--
-- Check afterwards (must return 0):
--   select count(*) from public.holler_signals
--   where source in ('arcgis-dc-311','arcgis-houston-311','socrata-austin-311','socrata-batonrouge-311','socrata-cambridge-311',
--     'socrata-chicago-311','socrata-cincinnati-311','socrata-dallas-311','socrata-kansascity-311','socrata-nola-311','socrata-nyc-311',
--     'socrata-oakland-311','socrata-seattle-311','socrata-sf-311')
--     and lat is not null and lon is not null
--     and (lat <> (floor(lat::numeric * 1000 + 0.5) / 1000)::double precision or lon <> (floor(lon::numeric * 1000 + 0.5) / 1000)::double precision);

do $$
declare
  n bigint;
begin
  if to_regclass('public.holler_signals') is null then
    raise notice 'holler 0037: public.holler_signals does not exist, nothing to do';
    return;
  end if;

  update public.holler_signals s
     set lat = (floor(s.lat::numeric * 1000 + 0.5) / 1000)::double precision,
         lon = (floor(s.lon::numeric * 1000 + 0.5) / 1000)::double precision
   where s.source in (
           'arcgis-dc-311', 'arcgis-houston-311', 'socrata-austin-311', 'socrata-batonrouge-311', 'socrata-cambridge-311',
           'socrata-chicago-311', 'socrata-cincinnati-311', 'socrata-dallas-311', 'socrata-kansascity-311', 'socrata-nola-311',
           'socrata-nyc-311', 'socrata-oakland-311', 'socrata-seattle-311', 'socrata-sf-311'
         )
     and s.data->>'subtype' = '311'
     and s.lat is not null
     and s.lon is not null
     and (s.lat <> (floor(s.lat::numeric * 1000 + 0.5) / 1000)::double precision
       or s.lon <> (floor(s.lon::numeric * 1000 + 0.5) / 1000)::double precision);
  get diagnostics n = row_count;
  raise notice 'holler 0037: rounded the point of % 311 rows to 3 decimals', n;
end
$$;
