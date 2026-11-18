-- Holler: "who to contact" for a record. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_signal_contacts holds the organisations and public offices a public record names (a business on a licence or inspection, a
-- contractor company on a permit, the company that won a federal award, a public buyer) and the address the record is about
-- (role 'site'). It is the private side of a holler_signals row: holler_signals stays exactly as public as it is, and nothing here is
-- ever copied into it. A private individual's name, phone or email is never written here (the app classifies names before writing).
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated. The app reads it with the
-- service role for a signed-in member whose own match points at the record (lib/contacts/load.ts).
--
-- Safe to apply before or after the code that writes it: old code never reads or writes the table, and the new code logs and carries
-- on when the table is not there yet.

create table if not exists public.holler_signal_contacts (
  id bigserial primary key,
  signal_id bigint not null references public.holler_signals(id) on delete cascade,
  role text not null,
  -- Organisation or office name; empty for role 'site'. Never a private person.
  name text not null default '',
  -- Named public official or office, role 'buyer' only (the procurement contact a solicitation publishes).
  attn text,
  -- Empty when unknown, so the unique index below treats "no address" as one value.
  address text not null default '',
  city text,
  state text,
  zip text,
  phone text,
  email text,
  website text,
  created_at timestamptz not null default now(),
  constraint holler_signal_contacts_role_check check (role in ('site', 'business', 'contractor', 'awardee', 'buyer')),
  constraint holler_signal_contacts_name_len check (char_length(name) <= 120),
  constraint holler_signal_contacts_attn_len check (attn is null or char_length(attn) <= 120),
  constraint holler_signal_contacts_address_len check (char_length(address) <= 200),
  constraint holler_signal_contacts_city_len check (city is null or char_length(city) <= 80),
  constraint holler_signal_contacts_state_len check (state is null or char_length(state) <= 30),
  constraint holler_signal_contacts_zip_len check (zip is null or char_length(zip) <= 10),
  constraint holler_signal_contacts_phone_len check (phone is null or char_length(phone) <= 20),
  constraint holler_signal_contacts_email_len check (email is null or char_length(email) <= 254),
  constraint holler_signal_contacts_website_len check (website is null or char_length(website) <= 300),
  -- A site is an address with no name; every other role names an organisation.
  constraint holler_signal_contacts_shape check (
    (role = 'site' and name = '' and btrim(address) <> '') or (role <> 'site' and btrim(name) <> '')
  ),
  -- Only a public buyer carries a named official.
  constraint holler_signal_contacts_attn_role check (attn is null or role = 'buyer')
);

-- The loader reads by signal id; the cascade from holler_signals deletes by it.
create index if not exists holler_signal_contacts_signal_idx on public.holler_signal_contacts (signal_id);
-- One row per signal, role, name and address (the writer upserts with ignoreDuplicates on these columns).
create unique index if not exists holler_signal_contacts_dedupe_idx
  on public.holler_signal_contacts (signal_id, role, name, address);

alter table public.holler_signal_contacts enable row level security;
revoke all on table public.holler_signal_contacts from public, anon, authenticated;
revoke all on sequence public.holler_signal_contacts_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_signal_contacts to service_role;
grant usage, select on sequence public.holler_signal_contacts_id_seq to service_role;
