-- Holler: cache of business listing lookups (round 18, unit LOOKUP). Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- APPLY ONLY AFTER the owner probe (/api/admin/lookup-probe, which needs only migration 0011) has returned `found` for two businesses the
-- owner knows. Until this table exists the alert run makes no lookup call at all.
--
-- holler_business_lookup  One row per business name + place + state that the alert run looked up on DataForSEO's Business Listings search
--                         (lib/enrich/business-lookup.ts). status 'found' stores the phone, website and listing name of the ONE listing
--                         that passed the name, place and address checks; 'not_found' stores nothing but the marker (no listing, or any
--                         doubt); 'truncated' marks an answer cut by the page limit (more results than were read, so nothing can be
--                         trusted); 'retry' is written just before a call and stays when the call times out or fails, so the next runs do
--                         not repeat it at once. checked_at drives reuse: found rows for 90 days, not_found for 30 days, truncated for
--                         7 days, retry for 6 hours, then looked up again. The answers recorded today also drive the daily circuit
--                         breaker (no lookups for the rest of the UTC day when the first 5 answers hold no found listing). The key is the
--                         normalised business name (lower case, accents folded, trailing legal suffixes dropped), the normalised city
--                         (plus the ZIP code when the place came from one, plus the site's street address for a business at its site)
--                         and the 2-letter state.
--
-- Businesses only: the app looks up a name only when the business classifier (lib/contacts/org.ts isOrganisationName) accepts it, so a
-- private person's name is never sent or stored. The phone and website are the business's own public listing.
--
-- Internal table, service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated. The app reads
-- it with the service role for members whose own match names the business (lib/outreach/loader.ts).
--
-- Convergent: an earlier version of this file (statuses found / not_found only) may have been applied. Every column is added with
-- `add column if not exists`, and the two check constraints are dropped and re-added, so running this file brings any earlier version to
-- this one. Running it twice changes nothing.

create table if not exists public.holler_business_lookup (
  name_key text not null,
  city_key text not null,
  state text not null,
  status text not null,
  phone text,
  website text,
  listing_name text,
  cost_usd numeric(10, 5) not null default 0,
  checked_at timestamptz not null default now(),
  primary key (name_key, city_key, state),
  constraint holler_business_lookup_name_key_len check (char_length(name_key) between 1 and 120),
  constraint holler_business_lookup_city_key_len check (char_length(city_key) between 1 and 80),
  constraint holler_business_lookup_state_shape check (state ~ '^[A-Z]{2}$'),
  constraint holler_business_lookup_phone_len check (phone is null or char_length(phone) <= 20),
  constraint holler_business_lookup_website_len check (website is null or char_length(website) <= 300),
  constraint holler_business_lookup_listing_name_len check (listing_name is null or char_length(listing_name) <= 200),
  constraint holler_business_lookup_cost_nonneg check (cost_usd >= 0)
);

-- Columns an earlier version might lack (all of them exist in every version so far; kept so a future column follows the same pattern).
alter table public.holler_business_lookup add column if not exists phone text;
alter table public.holler_business_lookup add column if not exists website text;
alter table public.holler_business_lookup add column if not exists listing_name text;
alter table public.holler_business_lookup add column if not exists cost_usd numeric(10, 5) not null default 0;
alter table public.holler_business_lookup add column if not exists checked_at timestamptz not null default now();

-- The status set and the row shape, re-created every time so an earlier version converges.
alter table public.holler_business_lookup drop constraint if exists holler_business_lookup_status_check;
alter table public.holler_business_lookup
  add constraint holler_business_lookup_status_check check (status in ('found', 'not_found', 'retry', 'truncated'));
alter table public.holler_business_lookup drop constraint if exists holler_business_lookup_shape;
-- A not_found, truncated or retry marker carries no contact detail; a found row carries at least one.
alter table public.holler_business_lookup
  add constraint holler_business_lookup_shape check (
    (status in ('not_found', 'retry', 'truncated') and phone is null and website is null and listing_name is null)
    or (status = 'found' and (phone is not null or website is not null))
  );

-- Expiry sweeps, the owner's checks and the daily circuit breaker read by age.
create index if not exists holler_business_lookup_checked_idx on public.holler_business_lookup (checked_at);

alter table public.holler_business_lookup enable row level security;

revoke all on table public.holler_business_lookup from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_business_lookup to service_role;
