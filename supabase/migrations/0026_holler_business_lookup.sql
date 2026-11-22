-- Holler: cache of business listing lookups (round 18, unit LOOKUP). Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_business_lookup  One row per business name + city + state that the alert run looked up on DataForSEO's Business Listings search
--                         (lib/enrich/business-lookup.ts). status 'found' stores the phone, website and listing name of the ONE listing
--                         that passed the name and place checks; status 'not_found' stores nothing but the marker (no listing, or any
--                         doubt); status 'retry' is written just before a call and stays when the call times out or fails, so the next
--                         runs do not repeat it at once. checked_at drives reuse: found rows are reused for 90 days, not_found rows for
--                         30 days, retry rows for 6 hours, then looked up again. The key is the normalised business name (lower case,
--                         accents folded, trailing legal suffixes dropped), the normalised city (plus the ZIP code when the place came
--                         from one) and the 2-letter state.
--
-- Businesses only: the app looks up a name only when the business classifier (lib/contacts/org.ts isOrganisationName) accepts it, so a
-- private person's name is never sent or stored. The phone and website are the business's own public listing.
--
-- Internal table, service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated. The app reads
-- it with the service role for members whose own match names the business (lib/outreach/loader.ts). Safe to apply before or after the
-- code: without this table the lookup is off (no DataForSEO call is made) and cards show exactly what they show today.

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
  constraint holler_business_lookup_status_check check (status in ('found', 'not_found', 'retry')),
  constraint holler_business_lookup_name_key_len check (char_length(name_key) between 1 and 120),
  constraint holler_business_lookup_city_key_len check (char_length(city_key) between 1 and 80),
  constraint holler_business_lookup_state_shape check (state ~ '^[A-Z]{2}$'),
  constraint holler_business_lookup_phone_len check (phone is null or char_length(phone) <= 20),
  constraint holler_business_lookup_website_len check (website is null or char_length(website) <= 300),
  constraint holler_business_lookup_listing_name_len check (listing_name is null or char_length(listing_name) <= 200),
  constraint holler_business_lookup_cost_nonneg check (cost_usd >= 0),
  -- A not_found or retry marker carries no contact detail; a found row carries at least one.
  constraint holler_business_lookup_shape check (
    (status in ('not_found', 'retry') and phone is null and website is null and listing_name is null)
    or (status = 'found' and (phone is not null or website is not null))
  )
);

-- Expiry sweeps and the owner's checks read by age.
create index if not exists holler_business_lookup_checked_idx on public.holler_business_lookup (checked_at);

alter table public.holler_business_lookup enable row level security;

revoke all on table public.holler_business_lookup from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_business_lookup to service_role;
