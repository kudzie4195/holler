-- Holler 0019: the free trial is 14 days (was 7). Purely additive and idempotent (safe to run twice); every object is holler_.
-- The code's single source is TRIAL_DAYS = 14 in lib/auth/membership.ts. This migration brings the three database places that
-- carry the trial length to the same 14 days, then extends the trials that are still running.
--  1. holler_profiles.trial_ends_at column default (0001): now() + 14 days.
--  2. holler_profiles_trial_from_stamp() (0003, BEFORE INSERT): a returning person's new row is cut to stamp + 14 days (one trial
--     per person, unchanged rule, new length). Replaced in place; the trigger already points at it.
--  3. holler_profiles_billing_guard() (0004, BEFORE INSERT OR UPDATE): a member's own insert may carry a trial of at most
--     14 days and 5 minutes (was 7). Body copied from 0004 with that interval changed, and one addition: a member can no longer
--     write created_at (the trial start the server stamps into app_metadata), on insert (must be within 5 minutes of now) or update.
--     Replaced in place.
--  4. Extension of RUNNING trials only: a profile still 'trialing' with no Stripe subscription whose trial_ends_at is still in the
--     future gets trial_ends_at = trial start + 14 days when that is later than its current value (it gets the difference between
--     its 7 days and 14 days from its start). Trial start = the earlier of the row's created_at and the person's
--     app_metadata.holler_trial_started_at stamp, so a person who deleted their account and came back does NOT get a new trial
--     (their stamp is older than the new row). A stamp that cannot be read skips that row (never lengthens on a guess).
--     A trial that already ended is NOT revived, even when start + 14 days is still ahead: that member was already told the
--     trial ended and their alerts paused. Never shortens a trial, never touches a subscribed, past_due or canceled profile.
--     Running it again changes nothing.

alter table public.holler_profiles alter column trial_ends_at set default now() + interval '14 days';

create or replace function public.holler_profiles_trial_from_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v text;
  v_start timestamptz;
begin
  begin
    select raw_app_meta_data ->> 'holler_trial_started_at' into v from auth.users where id = new.user_id;
    if v is not null then
      v_start := v::timestamptz;
      new.trial_ends_at := least(new.trial_ends_at, v_start + interval '14 days');
    end if;
  exception when others then
    -- never block a signup because of a bad stamp
    null;
  end;
  return new;
end;
$$;

revoke all on function public.holler_profiles_trial_from_stamp() from public, anon, authenticated;

create or replace function public.holler_profiles_billing_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text;
begin
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    );
  exception when others then
    v_role := 'authenticated'; -- unreadable claims: treat the writer as a member (fail closed)
  end;

  if current_user::text not in ('anon', 'authenticated') and coalesce(v_role, '') not in ('anon', 'authenticated') then
    return new; -- service role or database owner
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid() then
      raise exception 'new row violates row-level security policy for table "holler_profiles"' using errcode = 'insufficient_privilege';
    end if;
    if new.plan is distinct from 'starter'
       or new.subscription_status is distinct from 'trialing'
       or new.stripe_customer_id is not null
       or new.stripe_subscription_id is not null
       or new.email_verified_at is not null
       or new.last_notified_at is not null
       or new.trial_ends_at is null
       or new.trial_ends_at > now() + interval '14 days 5 minutes'
       or new.created_at is null
       or new.created_at > now() + interval '5 minutes'
       or new.created_at < now() - interval '5 minutes' then
      raise exception 'holler_billing_guard: billing fields are set by the server only' using errcode = 'insufficient_privilege';
    end if;
  elsif new.plan is distinct from old.plan
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.created_at is distinct from old.created_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.email_verified_at is distinct from old.email_verified_at
     or new.last_notified_at is distinct from old.last_notified_at then
    raise exception 'holler_billing_guard: billing fields are set by the server only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.holler_profiles_billing_guard() from public, anon, authenticated;

do $$
declare
  r record;
  v_stamp timestamptz;
  v_start timestamptz;
  v_has_auth boolean := to_regclass('auth.users') is not null;
  v_skip boolean;
begin
  for r in
    select user_id, created_at, trial_ends_at
      from public.holler_profiles
     where subscription_status = 'trialing'
       and stripe_subscription_id is null
       and trial_ends_at > now()
       and created_at + interval '14 days' > trial_ends_at
       and created_at + interval '14 days' > now()
  loop
    v_stamp := null;
    v_skip := false;
    if v_has_auth then
      begin
        execute 'select (raw_app_meta_data ->> ''holler_trial_started_at'')::timestamptz from auth.users where id = $1'
          into v_stamp using r.user_id;
      exception when others then
        v_skip := true; -- unreadable stamp: leave this row as it is
      end;
    end if;
    continue when v_skip;
    v_start := least(r.created_at, coalesce(v_stamp, r.created_at));
    -- Only a trial that is still running, and only when the new end is later: an ended trial is never revived (review r2 F3).
    if v_start + interval '14 days' > r.trial_ends_at and v_start + interval '14 days' > now() and r.trial_ends_at > now() then
      update public.holler_profiles
         set trial_ends_at = v_start + interval '14 days'
       where user_id = r.user_id
         and subscription_status = 'trialing'
         and stripe_subscription_id is null
         and trial_ends_at > now()
         and trial_ends_at < v_start + interval '14 days';
    end if;
  end loop;
end
$$;
