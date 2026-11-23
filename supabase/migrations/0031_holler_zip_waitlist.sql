-- Holler: "Coming to your area" waitlist, plus a "More ZIP codes" card on the Coming next list.
-- Round 19 UNIFY: this is the other branch's 0021_holler_zip_waitlist.sql, renamed to 0031 because this base's 0021 is
-- holler_area_waitlist. The SQL statements are unchanged. ALREADY APPLIED on the live database (as 0021); running it again changes nothing.
-- In this merged code new sign-ups go to holler_area_waitlist (0021); holler_zip_waitlist keeps the rows the live site collected, its
-- confirm links keep working (app/waitlist/confirm) and the owner's counts read both tables (lib/waitlist/zip-confirm.ts, /api/admin/metros).
-- Purely additive and idempotent; every object is prefixed holler_. Shared Supabase project: never touch non-holler objects.
--
-- holler_zip_waitlist holds one row per (email, ZIP) for people who checked a ZIP code where Holler has no local permit or
-- city-request data yet and asked to hear when it arrives. A row only counts once confirmed_at is set (double opt-in: the visitor
-- clicks a link in a confirmation email). The launch email for an area is sent once and stamps notified_at. unsubscribed_at stops
-- every later email; the row is kept so the address is never mailed again.
--
-- Stored: the email, the ZIP and its rounded position (3 decimals, about one block of the ZIP centroid, never a street address),
-- the trade picked on the check page, and the consent wording version shown. Not stored: IP address, user agent, any visitor id.
-- Waitlist counts by ZIP are the expansion roadmap: add sources where the confirmed list is longest.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated. The route handler
-- POST /api/waitlist and the confirm handler write with the service role.
--
-- Safe to apply before or after the code that writes it: old code never touches the table, and the new code answers with a soft
-- error ("Could not save that. Try again later.") when the table is not there yet.

create table if not exists public.holler_zip_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  zip text not null,
  state text,
  lat double precision,
  lon double precision,
  trade text,
  consent_version text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  notified_at timestamptz,
  unsubscribed_at timestamptz,
  constraint holler_zip_waitlist_email_shape check (char_length(email) between 3 and 254 and email = lower(email) and email like '%_@_%'),
  constraint holler_zip_waitlist_zip_shape check (zip ~ '^[0-9]{5}$'),
  constraint holler_zip_waitlist_state_shape check (state is null or state ~ '^[A-Z]{2}$'),
  constraint holler_zip_waitlist_trade_shape check (trade is null or trade ~ '^[a-z0-9-]{1,40}$'),
  constraint holler_zip_waitlist_consent_len check (char_length(consent_version) <= 20)
);

create unique index if not exists holler_zip_waitlist_email_zip_idx on public.holler_zip_waitlist (email, zip);
-- The launch job reads confirmed, not-yet-notified, still-subscribed rows near a new source.
create index if not exists holler_zip_waitlist_pending_idx
  on public.holler_zip_waitlist (state, zip)
  where confirmed_at is not null and notified_at is null and unsubscribed_at is null;

alter table public.holler_zip_waitlist enable row level security;
revoke all on table public.holler_zip_waitlist from public, anon, authenticated;

-- "More ZIP codes" joins the Coming next list. Widen the feature check constraint (drop and re-add; same name, so re-running is safe).
alter table public.holler_feature_interest drop constraint if exists holler_feature_interest_feature_check;
alter table public.holler_feature_interest
  add constraint holler_feature_interest_feature_check
  check (feature in ('gov-bids', 'spanish', 'asking-online', 'city-weekly', 'more-areas'));
