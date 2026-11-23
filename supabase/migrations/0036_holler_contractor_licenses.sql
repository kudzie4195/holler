-- Holler: holler_contractor_licenses, state contractor licence files (round 20, unit LIC). Purely additive and idempotent; every object is
-- prefixed holler_. Shared Supabase project: never touch non-holler objects.
--
-- What it holds: COMPANY licensees only, loaded by /api/cron/license-sync (off unless HOLLER_LICENSE_SYNC_ENABLED is set) from a state's
-- licence file (lib/licenses/sources.ts). A permit that carries a contractor licence number is looked up here, and the business name and
-- business phone are attached to the permit's contacts (lib/licenses/attach.ts).
-- Privacy: a licence file mixes sole proprietors with companies. The app drops every row whose licence HOLDER does not pass the company
-- rules (lib/licenses/company-row.ts) BEFORE it writes, so no person-licensee row is ever stored here. A personal or mailing address is
-- never stored; business_address is filled only for a source whose file marks the address as the business address.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.
-- Safe to apply before or after the code: until it exists the sync reports "table missing" and writes nothing, and the permit lookup
-- attaches nothing (no error; PGRST205 / 42P01 are handled).

create table if not exists public.holler_contractor_licenses (
  id bigserial primary key,
  state text not null check (state ~ '^[A-Z]{2}$'),
  license_number text not null check (char_length(license_number) between 3 and 40 and license_number ~ '^[A-Z0-9][A-Z0-9./#-]*$'),
  source text not null check (char_length(source) <= 60),
  business_name text not null check (char_length(business_name) between 3 and 120),
  business_phone text check (business_phone is null or char_length(business_phone) <= 20),
  business_address text check (business_address is null or char_length(business_address) <= 200),
  business_city text check (business_city is null or char_length(business_city) <= 80),
  business_zip text check (business_zip is null or char_length(business_zip) <= 10),
  license_type text check (license_type is null or char_length(license_type) <= 120),
  fetched_at timestamptz not null default now(),
  unique (state, license_number)
);

create index if not exists holler_contractor_licenses_source_fetched_idx
  on public.holler_contractor_licenses (source, fetched_at desc);

alter table public.holler_contractor_licenses enable row level security;

revoke all on table public.holler_contractor_licenses from public, anon, authenticated;
revoke all on sequence public.holler_contractor_licenses_id_seq from public, anon, authenticated;

comment on table public.holler_contractor_licenses is
  'Company contractor licensees from state licence files (no person licensee rows). Service role only.';
