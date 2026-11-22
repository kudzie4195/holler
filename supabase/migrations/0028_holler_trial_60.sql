-- Holler 0028: the free trial is 60 days (2 months; was 14 since 0019). Owner decision, round 18: no card, more time while the product
-- improves. Purely additive and idempotent (safe to run twice); every object is holler_. Shared Supabase project: nothing else is touched.
-- The code's single source is TRIAL_DAYS = 60 in lib/auth/membership.ts. This migration brings the three database places that carry the
-- trial length to the same 60 days, adds a read-only check the health email uses, then extends the trials of members who never paid.
--  1. holler_profiles.trial_ends_at column default (0001, 0019): now() + 60 days.
--  2. holler_profiles_trial_from_stamp() (0003, 0019; BEFORE INSERT): a returning person's new row is cut to stamp + 60 days (one trial
--     per person, unchanged rule, new length). Replaced in place; the trigger already points at it.
--  3. holler_profiles_billing_guard() (0004, 0019; BEFORE INSERT OR UPDATE): a member's own insert may carry a trial of at most
--     60 days and 5 minutes (was 14). Body copied from 0019 with ONLY that interval changed. Without this, a member's own insert with the
--     new 60-day column default would be refused by the old 14-day guard, so 1 and 3 must ship together (they do, in this file).
--  4. holler_trial_db_check(): SECURITY INVOKER, service role only, read-only. Returns the trial length the database actually uses in
--     each of the three places above ({"default_days", "stamp_cap_days", "guard_cap_days"}), read from the catalog (the column default
--     expression and the two function bodies). /api/cron/health (Bearer only) compares them with TRIAL_DAYS and reports a mismatch.
--  5. Extension of members who NEVER PAID and whose original start is less than 60 days ago (for a 14-day trial: still running or ended
--     in the last 46 days; a 7-day-era row from 0001 is judged by its start the same way, as the app does, review r2 R5). Each gets
--     trial_ends_at = trial start + 60 days, the remainder of 60 days from their ORIGINAL start, never a fresh 60. Trial start = the earlier of the row's created_at and the
--     person's app_metadata.holler_trial_started_at stamp, so a person who deleted their account and came back does NOT get a new trial.
--     A stamp that cannot be read skips that row (never lengthens on a guess). Never shortens a trial. Never touches a row with a
--     subscription status other than 'trialing', a Stripe subscription id, a store plan (plan_source other than 'none', migration 0020) or
--     a store grant that was ever applied (holler_billing_events.result = 'applied', migration 0020): those people paid. Subscription
--     state columns (plan, subscription_status, stripe_*, plan_source, store_*) are never written. An ENDED trial is revived only when
--     the new end is more than 72 hours away, so the 3-day reminder always comes before the next "trial ended" email (review F1); a
--     member whose start is 57 to 60 days back stays ended. For every row it extends, the member's trial_ending and trial_ended rows
--     in holler_lifecycle_sends (0016) are deleted, so the reminder and the ended email can be sent again for the new end (their
--     opt-out and welcome rows stay). A row the app already moved to start + 60 (whole milliseconds) is left alone, ledger included
--     (one-second tolerance, review F4). Running it again changes nothing: an extended row already sits at start + 60 days.
--     Run it again after the code deploy too (LAUNCH.md, Round 18 order): it repairs any row the old code cut back in between.
--     Exact rule (per row r, v_start = least(r.created_at, stamp), v_end = v_start + interval '60 days'):
--       r.subscription_status = 'trialing'
--       and r.stripe_subscription_id is null
--       and coalesce(r.plan_source, 'none') = 'none'                      (only when the column exists)
--       and no holler_billing_events row with result 'applied' for r.user_id (only when the table exists)
--       and r.created_at > now() - interval '60 days'                      (prefilter: the start is at most created_at)
--       and r.trial_ends_at + interval '1 second' < v_end                   (only ever later; the app writes whole milliseconds)
--       and v_end > now()                                                   (the new end is still ahead)
--       and (r.trial_ends_at > now() or v_end > now() + interval '72 hours') (an ENDED trial is revived only when the 3-day reminder
--                                                                            can still come before the new end; otherwise the member
--                                                                            would get a second "Your alerts are paused" and no reminder)

alter table public.holler_profiles alter column trial_ends_at set default now() + interval '60 days';

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
      new.trial_ends_at := least(new.trial_ends_at, v_start + interval '60 days');
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
       or new.trial_ends_at > now() + interval '60 days 5 minutes'
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

-- 4. What the database actually uses, read from the catalog. Read-only; null for a place that cannot be read.
create or replace function public.holler_trial_db_check()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'default_days', (
      select substring(pg_get_expr(d.adbin, d.adrelid) from '''(\d+) days''')::int
        from pg_attrdef d
        join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       where d.adrelid = 'public.holler_profiles'::regclass and a.attname = 'trial_ends_at'
    ),
    'stamp_cap_days', (
      select substring(pg_get_functiondef(p.oid) from 'v_start \+ interval ''(\d+) days''')::int
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'holler_profiles_trial_from_stamp'
       limit 1
    ),
    'guard_cap_days', (
      select substring(pg_get_functiondef(p.oid) from 'now\(\) \+ interval ''(\d+) days 5 minutes''')::int
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'holler_profiles_billing_guard'
       limit 1
    )
  );
$$;

revoke all on function public.holler_trial_db_check() from public, anon, authenticated;
grant execute on function public.holler_trial_db_check() to service_role;

-- 5. Extend members who never paid (see the header for the exact rule).
do $$
declare
  r record;
  v_stamp timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_has_auth boolean := to_regclass('auth.users') is not null;
  v_has_sends boolean := to_regclass('public.holler_lifecycle_sends') is not null;
  v_has_events boolean := to_regclass('public.holler_billing_events') is not null;
  v_has_source boolean := exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'holler_profiles' and column_name = 'plan_source'
  );
  v_skip boolean;
  v_n int;
begin
  for r in execute
    'select p.user_id, p.created_at, p.trial_ends_at
       from public.holler_profiles p
      where p.subscription_status = ''trialing''
        and p.stripe_subscription_id is null
        and p.created_at > now() - interval ''60 days''
        and p.trial_ends_at < p.created_at + interval ''60 days'''
    || case when v_has_source then ' and coalesce(p.plan_source, ''none'') = ''none''' else '' end
    || case when v_has_events then ' and not exists (select 1 from public.holler_billing_events e where e.user_id = p.user_id and e.result = ''applied'')' else '' end
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
    v_end := v_start + interval '60 days';
    -- Already there, to within a second: the app (lib/auth/trial.ts) writes whole milliseconds, Postgres keeps microseconds (review F4).
    continue when v_end <= now() or v_end <= r.trial_ends_at + interval '1 second';
    -- An ENDED trial is revived only if the new end is more than 72 hours away, so the 3-day reminder (60 to 84 hours before the end,
    -- lib/lifecycle/select.ts) always comes before a second "Your alerts are paused" email (review F1). Running trials are always extended.
    continue when r.trial_ends_at <= now() and v_end <= now() + interval '72 hours';
    execute
      'update public.holler_profiles
          set trial_ends_at = $2
        where user_id = $1
          and subscription_status = ''trialing''
          and stripe_subscription_id is null
          and trial_ends_at < $2 - interval ''1 second'''
      || case when v_has_source then ' and coalesce(plan_source, ''none'') = ''none''' else '' end
      using r.user_id, v_end;
    get diagnostics v_n = row_count;
    if v_n > 0 and v_has_sends then
      delete from public.holler_lifecycle_sends where user_id = r.user_id and kind in ('trial_ending', 'trial_ended');
    end if;
  end loop;
end
$$;
