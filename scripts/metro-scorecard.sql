-- metro-scorecard.sql
-- Read-only. Run by an operator in the Supabase SQL editor (service role / postgres). Writes nothing.
-- Keeps the 10 metros of lib/geo/metros.ts (METROS); tests/geo/metro-scorecard.test.ts fails if the VALUES lists drift from it.
--
-- QUERY 1 of 2: per-metro scorecard.
-- One row per metro (all 10 always appear, zero counts included), over the last 14 days of holler_signals.occurred_at (up to now).
-- Resident requests (source 'holler-request') are left out of every column.
--
-- Which metro a signal belongs to:
--   * with coordinates: its state is one of the metro's states AND it is within radius_mi miles (haversine) of the metro center;
--   * without coordinates (lat or lon null): its state is one of the metro's states AND its city is one of the metro's core cities
--     (metro_cities below, case-insensitive);
--   * a signal that qualifies for more than one metro counts once, for the nearest center (rows without coordinates: first metro by list order).
--
-- Columns:
--   metro               metro id (same ids as METROS)
--   total_signals       every signal in the metro
--   permits             kind = 'permit'
--   permits_w_contractor  permits that have at least one holler_signal_contacts row with role = 'contractor' and name <> ''
--   violations_311      data->>'subtype' in ('violation', '311')  (code violations and 311 requests; they never get contacts)
--   new_businesses      data->>'subtype' = 'business'  (new business licenses)
--   bids                kind = 'contract' and source <> 'usaspending'  (local bids and solicitations, federal awards left out)
--   contact_share       of the signals that are NOT weather (kind not in alert, report, disaster, quake), the share that
--                       has any company contact row (holler_signal_contacts with name <> '', any role; a bare 'site' address row has no
--                       name and does not count). 0 to 1, 3 decimals; null when the metro has no such signals

with metros(metro, states, lat, lon, radius_mi) as (
  values
    ('new-york', ARRAY['NY','NJ'], 40.7143, -74.006, 35),
    ('los-angeles', ARRAY['CA'], 34.0522, -118.2437, 45),
    ('chicago', ARRAY['IL'], 41.85, -87.65, 40),
    ('dallas-fort-worth', ARRAY['TX'], 32.7831, -96.8067, 40),
    ('houston', ARRAY['TX'], 29.7633, -95.3633, 40),
    ('atlanta', ARRAY['GA'], 33.749, -84.388, 40),
    ('washington-dc', ARRAY['DC','MD','VA'], 38.8951, -77.0364, 30),
    ('philadelphia', ARRAY['PA','NJ','DE'], 39.9523, -75.1638, 40),
    ('miami', ARRAY['FL'], 25.7743, -80.1937, 40),
    ('phoenix', ARRAY['AZ'], 33.4484, -112.074, 40)
),
metro_cities(metro, city, state) as (
  values
    ('new-york', 'New York City', 'NY'),
    ('new-york', 'Brooklyn', 'NY'),
    ('new-york', 'Manhattan', 'NY'),
    ('new-york', 'Queens', 'NY'),
    ('new-york', 'The Bronx', 'NY'),
    ('new-york', 'Staten Island', 'NY'),
    ('new-york', 'Newark', 'NJ'),
    ('new-york', 'Jersey City', 'NJ'),
    ('new-york', 'Bronx', 'NY'),
    ('new-york', 'New York', 'NY'),
    ('los-angeles', 'Los Angeles', 'CA'),
    ('los-angeles', 'Long Beach', 'CA'),
    ('los-angeles', 'Anaheim', 'CA'),
    ('los-angeles', 'Santa Ana', 'CA'),
    ('chicago', 'Chicago', 'IL'),
    ('chicago', 'Aurora', 'IL'),
    ('chicago', 'Naperville', 'IL'),
    ('dallas-fort-worth', 'Dallas', 'TX'),
    ('dallas-fort-worth', 'Fort Worth', 'TX'),
    ('dallas-fort-worth', 'Arlington', 'TX'),
    ('dallas-fort-worth', 'Plano', 'TX'),
    ('dallas-fort-worth', 'Irving', 'TX'),
    ('houston', 'Houston', 'TX'),
    ('houston', 'Pasadena', 'TX'),
    ('houston', 'Sugar Land', 'TX'),
    ('atlanta', 'Atlanta', 'GA'),
    ('atlanta', 'Marietta', 'GA'),
    ('atlanta', 'Sandy Springs', 'GA'),
    ('atlanta', 'Roswell', 'GA'),
    ('atlanta', 'Smyrna', 'GA'),
    ('washington-dc', 'Washington', 'DC'),
    ('washington-dc', 'Arlington', 'VA'),
    ('washington-dc', 'Alexandria', 'VA'),
    ('washington-dc', 'Silver Spring', 'MD'),
    ('philadelphia', 'Philadelphia', 'PA'),
    ('philadelphia', 'Camden', 'NJ'),
    ('philadelphia', 'Wilmington', 'DE'),
    ('miami', 'Miami', 'FL'),
    ('miami', 'Miami Beach', 'FL'),
    ('miami', 'Hialeah', 'FL'),
    ('miami', 'Fort Lauderdale', 'FL'),
    ('phoenix', 'Phoenix', 'AZ'),
    ('phoenix', 'Tempe', 'AZ'),
    ('phoenix', 'Mesa', 'AZ'),
    ('phoenix', 'Scottsdale', 'AZ'),
    ('phoenix', 'Chandler', 'AZ'),
    ('phoenix', 'Glendale', 'AZ')
),
recent as (
  select s.id, s.kind, s.source, s.lat, s.lon, s.state, s.city,
         s.data->>'subtype' as subtype,
         exists (select 1 from public.holler_signal_contacts c where c.signal_id = s.id and c.role = 'contractor' and c.name <> '') as has_contractor,
         exists (select 1 from public.holler_signal_contacts c where c.signal_id = s.id and c.name <> '') as has_company
  from public.holler_signals s
  where s.occurred_at >= now() - interval '14 days'
    and s.occurred_at <= now()
    and s.source <> 'holler-request'
),
candidates as (
  select r.*, m.metro,
         m.ord,
         case when r.lat is not null and r.lon is not null then
           2 * 3958.76 * asin(least(1, sqrt(
             power(sin(radians(r.lat - m.lat) / 2), 2) +
             cos(radians(m.lat)) * cos(radians(r.lat)) * power(sin(radians(r.lon - m.lon) / 2), 2)
           )))
         end as dist_mi
  from recent r
  join (select metros.*, row_number() over () as ord from metros) m on r.state = any (m.states)
  where (
    r.lat is not null and r.lon is not null
    and 2 * 3958.76 * asin(least(1, sqrt(
          power(sin(radians(r.lat - m.lat) / 2), 2) +
          cos(radians(m.lat)) * cos(radians(r.lat)) * power(sin(radians(r.lon - m.lon) / 2), 2)
        ))) <= m.radius_mi
  ) or (
    (r.lat is null or r.lon is null)
    and exists (select 1 from metro_cities mc where mc.metro = m.metro and mc.state = r.state and lower(mc.city) = lower(r.city))
  )
),
placed as (
  select distinct on (id) *
  from candidates
  order by id, dist_mi nulls last, ord
)
select m.metro,
       count(p.id)                                                              as total_signals,
       count(*) filter (where p.kind = 'permit')                                as permits,
       count(*) filter (where p.kind = 'permit' and p.has_contractor)           as permits_w_contractor,
       count(*) filter (where p.subtype in ('violation', '311'))                as violations_311,
       count(*) filter (where p.subtype = 'business')                           as new_businesses,
       count(*) filter (where p.kind = 'contract' and p.source <> 'usaspending') as bids,
       round(
         (count(*) filter (where p.kind not in ('alert', 'report', 'disaster', 'quake') and p.has_company))::numeric
         / nullif(count(*) filter (where p.kind not in ('alert', 'report', 'disaster', 'quake')), 0),
         3
       )                                                                        as contact_share
from (select metros.*, row_number() over () as ord from metros) m
left join placed p on p.metro = m.metro
group by m.metro, m.ord
order by m.ord;

-- QUERY 2 of 2: sources on probation (Adapter.probation). Their rows are never in holler_signals; they are kept in holler_source_samples
-- (service role only, 14 days). Per source: how many rows were sampled in the last 14 days, and 3 of them to eyeball before flipping it live
-- (remove `probation: true` from the adapter). Needs migration 0022. Read-only.
with recent as (
  select source, external_id, fetched_at, "row",
         row_number() over (partition by source order by fetched_at desc, id desc) as rn,
         count(*) over (partition by source) as sample_rows
  from public.holler_source_samples
  where fetched_at >= now() - interval '14 days'
)
select source, sample_rows, external_id, "row"->>'title' as title, "row"->>'city' as city
from recent
where rn <= 3
order by source, rn;
