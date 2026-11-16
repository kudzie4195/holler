-- Holler: hardening. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.

-- ---------------------------------------------------------------------------
-- P0-1: PostgREST upsert sets every payload column, including the conflict
-- column user_id, in DO UPDATE SET. Postgres checks UPDATE privilege on every
-- SET column even on the first insert, so user_id must be updatable.
-- Safe: the RLS update policy has WITH CHECK (auth.uid() = user_id), so a user
-- can never point a row at another user. Re-asserted here so this migration
-- stands on its own.
-- ---------------------------------------------------------------------------
grant update (user_id) on table public.holler_profiles to authenticated;

drop policy if exists holler_profiles_update_own on public.holler_profiles;
create policy holler_profiles_update_own on public.holler_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Email verification. Deliberately NOT in any user grant: only the service role
-- (server code after an HMAC-checked link) may set it.
-- ---------------------------------------------------------------------------
alter table public.holler_profiles add column if not exists email_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window per key). RLS on, no policies, no grants.
-- ---------------------------------------------------------------------------
create table if not exists public.holler_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.holler_rate_limits enable row level security;
revoke all on table public.holler_rate_limits from public, anon, authenticated;

-- Returns true when the hit is allowed (count within p_max for the current window).
create or replace function public.holler_rate_hit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.holler_rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict on constraint holler_rate_limits_pkey do update
    set window_start = case
          when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
          else r.window_start end,
        count = case
          when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
          else r.count + 1 end
  returning r.count into v_count;

  -- Opportunistic cleanup so the table stays small.
  if random() < 0.01 then
    delete from public.holler_rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_count <= p_max;
end;
$$;

revoke all on function public.holler_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.holler_rate_hit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Membership lookup for the shared auth.users table. Read-only, no side effects
-- on the user (unlike generateLink, which rewrites recovery tokens). Returns the
-- user id only when app_metadata.products contains 'holler'.
-- ---------------------------------------------------------------------------
create or replace function public.holler_member_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and coalesce(u.raw_app_meta_data -> 'products', '[]'::jsonb) ? 'holler'
  limit 1
$$;

revoke all on function public.holler_member_id(text) from public, anon, authenticated;
grant execute on function public.holler_member_id(text) to service_role;

-- ---------------------------------------------------------------------------
-- P2 cleanups: fixed search_path on the trigger function, and a CHECK on match status.
-- ---------------------------------------------------------------------------
create or replace function public.holler_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_matches_status_check'
  ) then
    alter table public.holler_matches
      add constraint holler_matches_status_check
      check (status in ('new', 'saved', 'done', 'dismissed')) not valid;
  end if;
end
$$;
