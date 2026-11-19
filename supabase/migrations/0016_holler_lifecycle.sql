-- Holler: trial lifecycle emails (welcome, trial-ending, trial-ended). Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_lifecycle_sends is the send ledger and the opt-out list for these three emails, one row per member per kind:
--   welcome, trial_ending, trial_ended  the member was sent that email (or a send is in flight: the cron inserts the row first, sends second, and deletes
--                     the row again if the send fails, so two overlapping runs can never both send)
--   optout            the member used the unsubscribe link in a lifecycle email. This is its own preference, separate from
--                     holler_profiles.alert_email (alert emails). It is stored here so no profile column is needed.
--
-- Service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.
-- Safe to apply before or after the code: old code never touches the table; the new code skips the run (cron) or answers with a soft
-- error (unsubscribe page) when the table is not there yet.

create table if not exists public.holler_lifecycle_sends (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  constraint holler_lifecycle_sends_pkey primary key (user_id, kind),
  constraint holler_lifecycle_sends_kind_check check (kind in ('welcome', 'trial_ending', 'trial_ended', 'optout'))
);

alter table public.holler_lifecycle_sends enable row level security;
revoke all on table public.holler_lifecycle_sends from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_lifecycle_sends to service_role;

-- Account deletion: Settings > Delete account removes the Holler profile but keeps the shared sign-in (auth.users), so the cascade above
-- never fires. This trigger deletes the member's rows (sends and opt-out) with the profile, the same way 0008 and 0009 do.
create or replace function public.holler_profiles_delete_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_lifecycle_sends where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_lifecycle() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_lifecycle on public.holler_profiles;
create trigger holler_profiles_delete_lifecycle
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_lifecycle();
