-- Holler: member feedback on alerts. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_signal_feedback holds one answer per member per alert: 'useful', 'not_relevant' or 'led_to_work', and for 'led_to_work'
-- an optional job value in whole US dollars (0 to 1,000,000). A second answer replaces the first (unique on user_id, signal_id).
--
-- Members read, insert and update only their own rows, and only for a signal they have a holler_matches row for. There is no delete
-- policy and no delete privilege for members, and anon has no access at all. The service role keeps full access for the owner report.
--
-- Lifetime: rows cascade with the signal (the 120-day prune) and with the sign-in. Settings > Delete account keeps the shared sign-in
-- and deletes only the Holler profile, so the trigger at the bottom removes the member's feedback with the profile (same pattern as
-- 0008 for holler_feature_interest).
--
-- Safe to apply before or after the code that writes it: old code never touches the table, and the new code treats a missing table as
-- "no answers yet" and shows a soft error on save.

create table if not exists public.holler_signal_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id bigint not null references public.holler_signals(id) on delete cascade,
  verdict text not null,
  job_value_usd int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holler_signal_feedback_user_signal_key unique (user_id, signal_id),
  constraint holler_signal_feedback_verdict_check check (verdict in ('useful', 'not_relevant', 'led_to_work')),
  constraint holler_signal_feedback_job_value_check check (job_value_usd is null or (job_value_usd between 0 and 1000000)),
  -- A dollar amount only belongs to "Led to work".
  constraint holler_signal_feedback_job_value_verdict check (job_value_usd is null or verdict = 'led_to_work')
);

-- The cascade from holler_signals deletes by signal_id; the owner report groups by day.
create index if not exists holler_signal_feedback_signal_idx on public.holler_signal_feedback (signal_id);
create index if not exists holler_signal_feedback_created_idx on public.holler_signal_feedback (created_at);

drop trigger if exists holler_signal_feedback_set_updated_at on public.holler_signal_feedback;
create trigger holler_signal_feedback_set_updated_at
  before update on public.holler_signal_feedback
  for each row execute function public.holler_set_updated_at();

alter table public.holler_signal_feedback enable row level security;

revoke all on table public.holler_signal_feedback from public, anon, authenticated;
grant select, insert, update on table public.holler_signal_feedback to authenticated;
grant select, insert, update, delete on table public.holler_signal_feedback to service_role;

drop policy if exists holler_signal_feedback_select_own on public.holler_signal_feedback;
create policy holler_signal_feedback_select_own on public.holler_signal_feedback
  for select to authenticated using (auth.uid() = user_id);

-- Insert and update both require that the member has a match row for the signal, so a row cannot be written for, or moved to, an
-- alert the member was never sent. The subquery runs under the member's own RLS on holler_matches (select own).
drop policy if exists holler_signal_feedback_insert_own on public.holler_signal_feedback;
create policy holler_signal_feedback_insert_own on public.holler_signal_feedback
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.holler_matches m where m.user_id = auth.uid() and m.signal_id = holler_signal_feedback.signal_id)
  );

drop policy if exists holler_signal_feedback_update_own on public.holler_signal_feedback;
create policy holler_signal_feedback_update_own on public.holler_signal_feedback
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.holler_matches m where m.user_id = auth.uid() and m.signal_id = holler_signal_feedback.signal_id)
  );

-- Account deletion: removes the Holler profile but keeps auth.users, so the cascade above never fires. Same pattern as 0008.
create or replace function public.holler_profiles_delete_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_signal_feedback where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_feedback() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_feedback on public.holler_profiles;
create trigger holler_profiles_delete_feedback
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_feedback();
