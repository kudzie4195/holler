-- Holler: resident service requests (/request). Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_requests holds the private side of a request (the resident's email, the raw description, the filtered description that
-- matched businesses see, hashed link tokens). The public side is one holler_signals row (source 'holler-request', kind 'ask') written
-- by the app when the request is confirmed. It carries NO free text: the title is built from the trade list and the ZIP lookup, and
-- summary is always null (constraint holler_signals_request_no_text below).
-- holler_request_replies records which business replied to which request and when. The reply text is never stored.
--
-- Both tables are service-role only: RLS is on with NO policies, and every privilege is revoked from anon and authenticated.

-- ---------------------------------------------------------------------------
-- holler_requests
-- Tokens: only sha256 hashes are stored, each hashed with its own domain prefix ('holler-request:confirm:' / ':close:' / ':remove:'),
-- so a confirm token can never act as a close or remove token. Lookups are by hash (unique indexes below).
-- email, description and public_summary are set to null at once when the request is closed or removed, and by the housekeeping job
-- 30 days after a request that simply ran out. What stays is the trade, the ZIP code, the city and state, and the dates.
-- ---------------------------------------------------------------------------
create table if not exists public.holler_requests (
  id uuid primary key default gen_random_uuid(),
  public_id text not null,
  status text not null default 'pending',
  trade text not null,
  zip text not null,
  city text,
  state text,
  place_slug text,
  lat double precision,
  lon double precision,
  description text,
  public_summary text,
  email text,
  confirm_token_hash text not null,
  close_token_hash text not null,
  remove_token_hash text not null,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  removed_at timestamptz,
  purged_at timestamptz,
  signal_id bigint references public.holler_signals(id) on delete set null,
  constraint holler_requests_public_id_key unique (public_id),
  constraint holler_requests_confirm_token_key unique (confirm_token_hash),
  constraint holler_requests_close_token_key unique (close_token_hash),
  constraint holler_requests_remove_token_key unique (remove_token_hash),
  constraint holler_requests_status_check check (status in ('pending', 'open', 'closed', 'removed')),
  constraint holler_requests_tokens_distinct check (
    confirm_token_hash <> close_token_hash and confirm_token_hash <> remove_token_hash and close_token_hash <> remove_token_hash
  ),
  constraint holler_requests_description_len check (description is null or char_length(description) between 20 and 500),
  constraint holler_requests_open_has_expiry check (status <> 'open' or expires_at is not null)
);

-- Expiry sweeps and "is it still open" checks.
create index if not exists holler_requests_status_expires_idx on public.holler_requests (status, expires_at);
-- Housekeeping: closed rows by close time, unconfirmed rows by age.
create index if not exists holler_requests_status_closed_idx on public.holler_requests (status, closed_at);
create index if not exists holler_requests_status_created_idx on public.holler_requests (status, created_at);
create index if not exists holler_requests_signal_idx on public.holler_requests (signal_id);

-- A request that has ended never keeps an email address. Added NOT VALID then validated, so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_requests_ended_no_email' and conrelid = 'public.holler_requests'::regclass
  ) then
    alter table public.holler_requests
      add constraint holler_requests_ended_no_email check (status in ('pending', 'open') or email is null) not valid;
  end if;
end $$;
alter table public.holler_requests validate constraint holler_requests_ended_no_email;

-- The public record of a request never holds free text. holler_signals is a holler_ table (migration 0001); this only adds a check
-- that applies to source 'holler-request' rows, NOT VALID first (no lock-heavy scan on add), then validated (no such rows carry text).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_signals_request_no_text' and conrelid = 'public.holler_signals'::regclass
  ) then
    alter table public.holler_signals
      add constraint holler_signals_request_no_text check (source <> 'holler-request' or summary is null) not valid;
  end if;
end $$;
alter table public.holler_signals validate constraint holler_signals_request_no_text;

alter table public.holler_requests enable row level security;
revoke all on table public.holler_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_requests to service_role;

-- ---------------------------------------------------------------------------
-- holler_request_replies: one row per (request, business). No message text, no resident email.
-- ---------------------------------------------------------------------------
create table if not exists public.holler_request_replies (
  id bigserial primary key,
  request_id uuid not null references public.holler_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id bigint references public.holler_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint holler_request_replies_request_user_key unique (request_id, user_id)
);

-- The per-business daily cap counts this user's rows in the last 24 hours.
create index if not exists holler_request_replies_user_created_idx on public.holler_request_replies (user_id, created_at desc);
-- match_id is a foreign key (ON DELETE SET NULL): without an index every cascade delete of holler_matches rows scans this table.
create index if not exists holler_request_replies_match_idx on public.holler_request_replies (match_id);

alter table public.holler_request_replies enable row level security;
revoke all on table public.holler_request_replies from public, anon, authenticated;
revoke all on sequence public.holler_request_replies_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_request_replies to service_role;
grant usage, select on sequence public.holler_request_replies_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Server-side guard for the reply rules the app also checks: the request must be open and unexpired, at most 5 replies per request,
-- and at most 10 replies per business in any 24 hours.
-- The parent row is locked (FOR UPDATE) so two businesses replying at the same moment cannot make a sixth reply, and a transaction-level
-- advisory lock per business serialises that business's own inserts, so parallel replies cannot pass the daily cap either.
-- One reply per business is the unique constraint above.
-- ---------------------------------------------------------------------------
create or replace function public.holler_request_replies_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_expires timestamptz;
  v_count int;
  v_day int;
begin
  select r.status, r.expires_at into v_status, v_expires
  from public.holler_requests r
  where r.id = new.request_id
  for update;

  if v_status is distinct from 'open' or v_expires is null or v_expires <= now() then
    raise exception 'holler_request_not_open' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.holler_request_replies x where x.request_id = new.request_id;
  if v_count >= 5 then
    raise exception 'holler_request_reply_cap' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('holler-reply:' || new.user_id::text));
  select count(*) into v_day
  from public.holler_request_replies x
  where x.user_id = new.user_id and x.created_at > now() - interval '24 hours';
  if v_day >= 10 then
    raise exception 'holler_request_daily_cap' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.holler_request_replies_guard() from public, anon, authenticated;

drop trigger if exists holler_request_replies_guard on public.holler_request_replies;
create trigger holler_request_replies_guard
  before insert on public.holler_request_replies
  for each row execute function public.holler_request_replies_guard();

-- ---------------------------------------------------------------------------
-- Account deletion: when a business deletes its Holler profile (Settings > Delete account), its reply records go too.
-- The shared sign-in (auth.users) is kept on purpose, so the ON DELETE CASCADE from auth.users alone would never fire.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER with a fixed search_path: whoever deletes the profile row, the reply records always go with it.
create or replace function public.holler_profiles_delete_replies()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_request_replies where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_replies() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_replies on public.holler_profiles;
create trigger holler_profiles_delete_replies
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_replies();
