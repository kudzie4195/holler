-- Holler round 35: two optional columns on holler_keyword_volume for location mode (lib/dataforseo/location-volume.ts).
-- Purely additive and idempotent. Safe before or after the deploy: the code works WITHOUT this migration. It stores location mode rows with the
-- location inside the keyword text ("lawn care @ marietta,georgia,united states") and drops these two columns when the database lacks them.
-- Applying it adds Google's own last 12 months per city, so the owner view (/api/admin/keyword-volume) shows a 12 point trend from the first run
-- instead of one point a month.
--
--   location_name     The DataForSEO location_name the request used, for example "Marietta,Georgia,United States". Null on national rows.
--   monthly_searches  Google's last 12 months: [{ "year": 2026, "month": 10, "search_volume": 480 }, ...], oldest first. Null when absent.
--
-- No policy or grant changes: the table is service role only (0011) and stays so.

alter table public.holler_keyword_volume add column if not exists location_name text;
alter table public.holler_keyword_volume add column if not exists monthly_searches jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'holler_keyword_volume_location_name_len') then
    alter table public.holler_keyword_volume add constraint holler_keyword_volume_location_name_len check (location_name is null or char_length(location_name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'holler_keyword_volume_monthly_shape') then
    alter table public.holler_keyword_volume add constraint holler_keyword_volume_monthly_shape check (monthly_searches is null or (jsonb_typeof(monthly_searches) = 'array' and jsonb_array_length(monthly_searches) <= 12));
  end if;
end
$$;

create index if not exists holler_keyword_volume_location_idx on public.holler_keyword_volume (location_name, month) where location_name is not null;
