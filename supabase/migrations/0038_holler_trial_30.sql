-- Holler 0038: the free trial is 30 days (was 60 since 0028, 14 since 0019, 7 before that). Owner decision, round 23 (website-only
-- launch): 30 days, no card. Purely additive and idempotent (safe to run twice); every object is holler_. Shared Supabase project:
-- nothing else is touched. Number 0038 was reserved and unused (LAUNCH.md, round 21 order); it is the first free number after 0037, so
-- on a fresh database it runs last and wins.
--
-- The code's single source is TRIAL_DAYS = 30 in lib/auth/membership.ts. This migration brings the three database places that carry the
-- trial length to the same 30 days and nothing else:
--   1. holler_profiles.trial_ends_at column default (0001, 0019, 0028): now() + 30 days.
--   2. holler_profiles_trial_from_stamp() (0003, 0019, 0028; BEFORE INSERT): a returning person's new row is cut to stamp + 30 days
--      (one trial per person, unchanged rule, new length). Replaced in place; the trigger already points at it.
--   3. holler_profiles_billing_guard() (0004, 0019, 0028; BEFORE INSERT OR UPDATE): a member's own insert may carry a trial of at most
--      30 days and 5 minutes (was 60). Body copied from 0028 with ONLY that interval changed. Without this, a member's own insert with
--      the new 30-day column default would still be allowed by the old 60-day guard, but a later tightening would not be, so 1 and 3
--      ship together (they do, in this file).
--   4. holler_trial_db_check() (0028) is left exactly as 0028 wrote it: it reads the three places above out of the catalog, so after this
--      migration it returns {"default_days": 30, "stamp_cap_days": 30, "guard_cap_days": 30} with no change to its own body, and
--      /api/cron/health compares that with TRIAL_DAYS. It is re-created here anyway so this file alone brings a fresh database up.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: there is no `do $$ ... update holler_profiles ... $$` block.
-- 0028 had one, because it LENGTHENED trials. A mirror of it at 30 days would SHORTEN every trial a member already holds (a 60-day trial
-- started 1 November would jump back from 31 December to 1 December), and the owner's decision for round 23 is that every existing trial
-- keeps its current end date. So:
--   * the column default is read only when a row is INSERTED, so it reaches profiles created from this migration forward and no others;
--   * holler_profiles_trial_from_stamp() is a BEFORE INSERT trigger, so the same is true of it;
--   * holler_profiles_billing_guard() on INSERT caps only the row being inserted, and on UPDATE it only continues to REFUSE a member's
--     own write to trial_ends_at (that list is unchanged), so it never moves an existing end either.
-- No row that exists when this runs is read or written. tests/ops/migration-0038.test.ts proves it: it loads profiles holding 60-day,
-- 14-day and 7-day trials (running, ended, paying, store-billed, returning), runs this file, and asserts every single trial_ends_at and
-- every holler_lifecycle_sends row is byte-identical afterwards, while a row inserted after it gets 30 days.
--
-- The app side of the same promise is lib/auth/membership.ts TRIAL_MAX_DAYS (60) and lib/auth/trial.ts: the "cut back" branch there now
-- measures against start + TRIAL_MAX_DAYS, so a member holding a 60-day trial who opens /app, Settings or Checkout is not cut to 30 either.
--
-- Order (LAUNCH.md): run this BEFORE the code deploy. Until it runs, the database default is still 60 days, so a brand-new member gets up
-- to 60 days while the site says 30: more than promised, never less. Running it after the deploy is also safe.
-- Checks after running:
--   select public.holler_trial_db_check();   -- {"default_days": 30, "guard_cap_days": 30, "stamp_cap_days": 30}
--   -- nobody was shortened: no never-paid trialing row ends before its own start + 30 days
--   select count(*) from holler_profiles
--    where subscription_status = 'trialing' and stripe_subscription_id is null and trial_ends_at < created_at + interval '29 days';
-- Rollback: run 0028 again (it puts 60 days back in all three places and re-extends never-paid members).

alter table public.holler_profiles alter column trial_ends_at set default now() + interval '30 days';

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
      new.trial_ends_at := least(new.trial_ends_at, v_start + interval '30 days');
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
       or new.trial_ends_at > now() + interval '30 days 5 minutes'
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

-- Unchanged from 0028, re-created so this file alone brings a fresh database up. Read-only; null for a place that cannot be read.
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
