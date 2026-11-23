-- Holler 0021: "Coming to your area" waitlist. Purely additive and idempotent (safe to run twice); every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_area_waitlist records one row when someone checks a ZIP code Holler does not serve yet (no local source within 25 miles) and
-- leaves an email to hear when it does. What is stored: the email (lower-cased), the ZIP, the trade picked on the check, when it was
-- saved and which page it came from (`page`, 'check'). Nothing else about the visitor: no IP address, no IP hash, no visitor id, no
-- user agent, no account id. One row per email and ZIP: a repeat is ignored by the server (INSERT ... ON CONFLICT DO NOTHING), so
-- pressing the button twice, or again next week, saves nothing new and shows the same confirmation.
--
-- Plain text with a lower-case check rather than citext: citext is an extension, and this project is shared with other products,
-- so no extension is created here.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated. The route handler
-- POST /api/waitlist writes with the service role, the same way POST /api/interest does (0008). There is no public select.
--
-- Safe to apply before or after the code that writes it: old code never touches the table, and the new code answers with a soft
-- error (the card says "Could not save that. Try again later.") when the table is not there yet.
--
-- Owner count (read only, run in the Supabase SQL editor):
--   select zip, count(*) as people from public.holler_area_waitlist group by zip order by people desc;

create table if not exists public.holler_area_waitlist (
  id bigserial primary key,
  email text not null,
  zip text not null,
  trade text not null,
  page text not null default 'check',
  created_at timestamptz not null default now(),
  constraint holler_area_waitlist_email_lower check (email = lower(email)),
  constraint holler_area_waitlist_email_len check (char_length(email) between 3 and 254),
  constraint holler_area_waitlist_zip_shape check (zip ~ '^[0-9]{5}$'),
  constraint holler_area_waitlist_trade_len check (char_length(trade) between 1 and 60),
  constraint holler_area_waitlist_page_check check (page in ('check')),
  -- One row per email and ZIP. A plain unique constraint (not a partial index) so the app can use INSERT ... ON CONFLICT (email, zip)
  -- DO NOTHING through PostgREST.
  constraint holler_area_waitlist_email_zip_key unique (email, zip)
);

-- The owner's count groups by ZIP, and the future "tell them it is live" job reads a ZIP's rows.
create index if not exists holler_area_waitlist_zip_idx
  on public.holler_area_waitlist (zip);
create index if not exists holler_area_waitlist_created_idx
  on public.holler_area_waitlist (created_at);

alter table public.holler_area_waitlist enable row level security;
revoke all on table public.holler_area_waitlist from public, anon, authenticated;
revoke all on sequence public.holler_area_waitlist_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_area_waitlist to service_role;
grant usage, select on sequence public.holler_area_waitlist_id_seq to service_role;
