-- Holler: plans (Starter and Pro). Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.

-- ---------------------------------------------------------------------------
-- New columns.
--  plan         'starter' | 'pro'. Written only by the server (Stripe webhook, plan switch) with the service role.
--               Every existing row gets 'starter', which is what every existing subscription is.
--  extra_areas  Pro: up to 2 extra service areas, a jsonb array of {zip, city, state, lat, lon}. Main area stays in zip/lat/lon.
--  keywords     Pro: up to 5 keyword watches, 3 to 40 characters each.
-- ---------------------------------------------------------------------------
alter table public.holler_profiles add column if not exists plan text not null default 'starter';
alter table public.holler_profiles add column if not exists extra_areas jsonb not null default '[]'::jsonb;
alter table public.holler_profiles add column if not exists keywords text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'holler_profiles_plan_check') then
    alter table public.holler_profiles
      add constraint holler_profiles_plan_check check (plan in ('starter', 'pro'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Column privileges (the model from 0001/0002: RLS decides rows, column grants decide columns).
-- Members may write their own extra_areas and keywords. plan is never granted: a member cannot give themselves Pro.
-- The column-level revoke on plan is a no-op on a correct database (0001 revoked table-level insert/update) and states the intent.
-- ---------------------------------------------------------------------------
revoke insert (plan), update (plan) on table public.holler_profiles from anon, authenticated;
grant insert (extra_areas, keywords) on table public.holler_profiles to authenticated;
grant update (extra_areas, keywords) on table public.holler_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Plan limits, enforced where the row is written. Same numbers as lib/plan/limits.ts.
--  Any plan:  at most 2 extra areas, at most 5 keywords, at most 15 trades.
--             extra_areas: an array of objects with exactly the keys zip (5 digits), city (text, at most 80 characters),
--             state (2 letters), lat (-90 to 90) and lon (-180 to 180); at most 1000 bytes as JSON text in all.
--             keywords: each 3 to 40 characters of A-Z, a-z, 0-9, space and ' & - / (accents are folded away by the app before
--             saving), at least one letter or digit, no leading, trailing or double spaces, no two the same ignoring case.
--             Same rules as lib/plan/areas.ts storableExtraAreas and lib/plan/keywords.ts keywordProblem.
--  Starter:   no extra area, no keyword, at most 5 trades.
-- The plan that counts is the one in force: 'pro' only while subscription_status is active or past_due (the same rule as
-- lib/plan effectiveTier). The free trial, a canceled subscription and an expired trial get Starter limits.
-- Checks run only for the columns a write CHANGES (on INSERT: every non-empty value). So:
--  - saved extras stay saved after a downgrade, and the service role can set plan = 'starter' on a row that has them;
--  - a Starter member can still edit their name or ZIP, and can clear extras, but cannot add or change them.
-- INSERT ... ON CONFLICT DO UPDATE (the PostgREST upsert the app uses) fires BEFORE INSERT on the proposed row first, with the
-- column defaults (plan 'starter'). When a row for that user already exists, the insert half is skipped here and the UPDATE half,
-- which sees the stored plan and the old values, does the checking. SECURITY DEFINER only to read that existing row; fixed search_path.
-- ---------------------------------------------------------------------------
create or replace function public.holler_profiles_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pro boolean;
  v_areas_changed boolean;
  v_keywords_changed boolean;
  v_trades_changed boolean;
  v_area jsonb;
  v_kw text;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.holler_profiles p where p.user_id = new.user_id) then
      return new; -- upsert of an existing row: the BEFORE UPDATE run of this trigger checks it
    end if;
    v_areas_changed := coalesce(jsonb_typeof(new.extra_areas) <> 'array' or jsonb_array_length(new.extra_areas) > 0, true);
    v_keywords_changed := coalesce(cardinality(new.keywords), 0) > 0;
    v_trades_changed := true;
  else
    v_areas_changed := new.extra_areas is distinct from old.extra_areas;
    v_keywords_changed := new.keywords is distinct from old.keywords;
    v_trades_changed := new.categories is distinct from old.categories;
  end if;

  if not (v_areas_changed or v_keywords_changed or v_trades_changed) then
    return new;
  end if;

  v_pro := new.plan = 'pro' and new.subscription_status in ('active', 'past_due');

  if v_areas_changed then
    if new.extra_areas is null or jsonb_typeof(new.extra_areas) <> 'array' then
      raise exception 'holler_plan_limit: extra_areas must be a list' using errcode = 'check_violation';
    end if;
    if jsonb_array_length(new.extra_areas) > 2 then
      raise exception 'holler_plan_limit: at most 2 extra areas' using errcode = 'check_violation';
    end if;
    if not v_pro and jsonb_array_length(new.extra_areas) > 0 then
      raise exception 'holler_plan_limit: extra areas need Pro' using errcode = 'check_violation';
    end if;
    if octet_length(new.extra_areas::text) > 1000 then
      raise exception 'holler_plan_limit: extra areas are too large' using errcode = 'check_violation';
    end if;
    for v_area in select value from jsonb_array_elements(new.extra_areas) loop
      if jsonb_typeof(v_area) <> 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_area) k) is distinct from array['city', 'lat', 'lon', 'state', 'zip']
         or jsonb_typeof(v_area -> 'zip') is distinct from 'string'
         or (v_area ->> 'zip') !~ '^[0-9]{5}$'
         or jsonb_typeof(v_area -> 'city') is distinct from 'string'
         or char_length(v_area ->> 'city') > 80
         or jsonb_typeof(v_area -> 'state') is distinct from 'string'
         or (v_area ->> 'state') !~ '^[A-Za-z]{2}$'
         or jsonb_typeof(v_area -> 'lat') is distinct from 'number'
         or jsonb_typeof(v_area -> 'lon') is distinct from 'number'
         or (v_area ->> 'lat')::numeric not between -90 and 90
         or (v_area ->> 'lon')::numeric not between -180 and 180 then
        raise exception 'holler_plan_limit: each extra area needs exactly zip, city, state, lat and lon' using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  if v_keywords_changed then
    if new.keywords is null then
      raise exception 'holler_plan_limit: keywords must be a list' using errcode = 'check_violation';
    end if;
    if cardinality(new.keywords) > 5 then
      raise exception 'holler_plan_limit: at most 5 keywords' using errcode = 'check_violation';
    end if;
    if not v_pro and cardinality(new.keywords) > 0 then
      raise exception 'holler_plan_limit: keyword watches need Pro' using errcode = 'check_violation';
    end if;
    foreach v_kw in array new.keywords loop
      if v_kw is null or char_length(v_kw) < 3 or char_length(v_kw) > 40 then
        raise exception 'holler_plan_limit: each keyword must be 3 to 40 characters' using errcode = 'check_violation';
      end if;
      if v_kw !~ '^[A-Za-z0-9 ''&/-]+$' or v_kw !~ '[A-Za-z0-9]' or v_kw <> btrim(v_kw) or v_kw like '%  %' then
        raise exception 'holler_plan_limit: keywords use letters, digits, spaces and '' & - / only' using errcode = 'check_violation';
      end if;
    end loop;
    if (select count(distinct lower(k)) from unnest(new.keywords) k) <> cardinality(new.keywords) then
      raise exception 'holler_plan_limit: the same keyword twice' using errcode = 'check_violation';
    end if;
  end if;

  if v_trades_changed then
    if coalesce(cardinality(new.categories), 0) > 15 then
      raise exception 'holler_plan_limit: at most 15 trades' using errcode = 'check_violation';
    end if;
    if not v_pro and coalesce(cardinality(new.categories), 0) > 5 then
      raise exception 'holler_plan_limit: more than 5 trades needs Pro' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.holler_profiles_plan_limits() from public, anon, authenticated;

drop trigger if exists holler_profiles_plan_limits on public.holler_profiles;
create trigger holler_profiles_plan_limits
  before insert or update on public.holler_profiles
  for each row execute function public.holler_profiles_plan_limits();

-- ---------------------------------------------------------------------------
-- Billing fields are written by the server only, whatever the grants say (review P2-5).
-- 0001/0002 keep these columns out of the member's column grants. That rule fails silently if a table-level grant comes back
-- (for example a "grant all on all tables in schema public to authenticated" run for another product on this shared database).
-- This trigger repeats the rule where the row is written:
--  - Who is the writer? SECURITY INVOKER, so current_user is the role the request runs as. Under PostgREST that is the JWT role
--    (anon, authenticated or service_role); the JWT role claim is read too (request.jwt.claims / request.jwt.claim.role, the same
--    settings auth.role() reads, read directly so this works where auth.role() does not exist). A writer is a member when either says
--    anon or authenticated. The service role, the SQL editor and SECURITY DEFINER functions owned by the database owner are not members
--    unless the request carries a member's JWT.
--  - A member's UPDATE may not change plan, subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id,
--    email_verified_at or last_notified_at.
--  - A member's INSERT must leave them at their defaults (plan starter, status trialing, Stripe ids, verification and notify stamps
--    empty, trial no longer than the default 7 days; 0003 may shorten it afterwards) and must be for their own user id. An insert for
--    another user id fails here with the same error whether or not that user has a profile, so the plan-limit trigger cannot be used
--    to learn which ids have one (review P2-7).
-- Named so it fires before holler_profiles_plan_limits (triggers of the same kind fire in name order).
-- ---------------------------------------------------------------------------
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
       or new.trial_ends_at > now() + interval '7 days 5 minutes' then
      raise exception 'holler_billing_guard: billing fields are set by the server only' using errcode = 'insufficient_privilege';
    end if;
  elsif new.plan is distinct from old.plan
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
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

drop trigger if exists holler_profiles_billing_guard on public.holler_profiles;
create trigger holler_profiles_billing_guard
  before insert or update on public.holler_profiles
  for each row execute function public.holler_profiles_billing_guard();
