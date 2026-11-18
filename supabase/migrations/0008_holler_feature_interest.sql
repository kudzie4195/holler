-- Holler: "Coming next" feature interest. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_feature_interest records one row each time someone presses "I want this" on a feature the owner is thinking about building.
-- A signed-in member's pick carries their user id (one row per member per feature). A signed-out pick is a row with user_id null.
-- Nothing else about a visitor is stored: no IP address, no IP hash, no visitor id, no user agent. The column `page` says which
-- page the pick came from (for example 'pricing' or 'app'), at most 40 characters.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated. The route handler
-- POST /api/interest writes with the service role, and the feed reads a member's own picks with the service role.
--
-- Safe to apply before or after the code that writes it: old code never touches the table, and the new code answers with a soft
-- error (and the page shows "Could not save that. Try again later.") when the table is not there yet.

create table if not exists public.holler_feature_interest (
  id bigserial primary key,
  feature text not null,
  -- Null for a signed-out visitor. Cascades when the shared sign-in is deleted; the trigger below covers Settings > Delete account.
  user_id uuid references auth.users(id) on delete cascade,
  page text,
  created_at timestamptz not null default now(),
  constraint holler_feature_interest_feature_check check (feature in ('gov-bids', 'spanish', 'asking-online', 'city-weekly')),
  constraint holler_feature_interest_page_len check (page is null or char_length(page) <= 40)
);

-- One pick per member per feature. A plain unique index, not a partial one: Postgres treats nulls as distinct, so any number of
-- signed-out rows (user_id null) can exist for one feature, while a member's repeat is rejected. A plain index also lets the app
-- use INSERT ... ON CONFLICT (feature, user_id) DO NOTHING, which PostgREST cannot do against a partial index.
create unique index if not exists holler_feature_interest_user_feature_idx
  on public.holler_feature_interest (feature, user_id);
-- The feed reads a member's own picks by user id, and the cascade deletes by it.
create index if not exists holler_feature_interest_user_idx
  on public.holler_feature_interest (user_id) where user_id is not null;
-- The owner's report groups by feature and day.
create index if not exists holler_feature_interest_created_idx
  on public.holler_feature_interest (created_at);

alter table public.holler_feature_interest enable row level security;
revoke all on table public.holler_feature_interest from public, anon, authenticated;
revoke all on sequence public.holler_feature_interest_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_feature_interest to service_role;
grant usage, select on sequence public.holler_feature_interest_id_seq to service_role;

-- Account deletion: Settings > Delete account removes the Holler profile but keeps the shared sign-in (auth.users), so the cascade
-- above never fires. This trigger deletes the member's picks with the profile, the same way 0005 does for reply records.
create or replace function public.holler_profiles_delete_interest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_feature_interest where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_interest() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_interest on public.holler_profiles;
create trigger holler_profiles_delete_interest
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_interest();
