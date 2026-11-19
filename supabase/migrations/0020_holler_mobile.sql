-- Holler 0020: mobile app (push tokens) and store billing (App Store and Google Play through RevenueCat).
-- Purely additive and idempotent (safe to run twice); every object is prefixed holler_. Shared Supabase project: never touch
-- non-holler objects.
--
-- What it adds:
--  1. holler_push_tokens: one row per device (FCM registration token). Service role only; the API (app/api/m/push/register) writes it.
--  1b. holler_matches.pushed_at: when this match was counted in a delivered push. Push keeps its own record, separate from the email
--      digest's `notified`, so a member with email alerts off or an unconfirmed address still gets pushes. Server only (members are
--      granted update on `status` alone since 0001, and nothing here changes that). When the column is first added, every existing
--      match is stamped with its created_at, so no match from before push can ever be pushed.
--  2. holler_profiles columns:
--       plan_source       'none' | 'stripe' | 'apple' | 'google': who bills this member. Server only.
--       store_product_id  store product id of a store plan (Play ':basePlanId' suffix removed). Server only.
--       store_expires_at  when the store plan ends unless renewed. Server only.
--       store_env         'sandbox' | 'production' of the last applied store event. Server only.
--       last_pushed_at    when the last push went out (one push per member per hour). Server only.
--       push_alerts       the member's own on/off switch for push alerts (default on). Member-writable, like alert_email.
--     Rows that already hold a Stripe subscription get plan_source 'stripe' (no paying member exists today; this states the rule).
--  3. holler_profiles_store_guard: BEFORE INSERT OR UPDATE trigger that keeps members from writing the five server-only columns,
--     whatever the grants say. A separate trigger, not an edit of holler_profiles_billing_guard: 0019 re-issues that function
--     with the 14-day trial window, and re-issuing it here again would make the two migrations fight over one body.
--     Named so it fires right after holler_profiles_billing_guard and before holler_profiles_plan_limits (same-kind triggers fire
--     in name order).
--  3b. holler_profiles_plan_limits_store: BEFORE INSERT OR UPDATE trigger that applies the Solo limits of 0004 to a Pro row whose
--     store plan has lapsed (no expiry, or more than 3 days past) while its status still says active, as the app already does.
--  4. holler_billing_events: the store event ledger, keyed by the store's event id. Service role only. `raw` holds a trimmed copy of
--     the event (ids, type, store, environment, product, dates); the webhook removes subscriber attributes, aliases and anything
--     personal before it gets here.
--  4b. holler_billing_shadow: one row per member who pays in two places (Stripe and a store, or both stores). It keeps what the
--     source that is NOT the live one last said (store product, plan, expiry, env; or the Stripe subscription id, status, plan), so
--     when the live source ends the plan moves to the other one in the same event instead of leaving a paying member locked.
--     Service role only; deleted with the profile.
--  5. holler_apply_store_event(...): SECURITY DEFINER, service role only, THE single writer of store billing state. Idempotent on
--     event id, refuses stale events, maps the product id to the plan, never grants without a future expiry, never lets a sandbox
--     event touch a production plan, and never overwrites a live plan billed by Stripe.
--     holler_stripe_state(...): SECURITY DEFINER, service role only. The Stripe webhook tells it what Stripe says when a Stripe event
--     is blocked by a live store plan, before Stripe takes over a live store plan, and after a Stripe plan ends.
--     holler_billing_fallback(user): internal. When the member's live plan has ended, switches to the other source if it is still paid.
--  6. Account deletion (Settings > Delete account deletes the profile, never the shared auth.users row): a trigger deletes the member's
--     push tokens and detaches their ledger rows (user_id set to null; the event ids stay so a re-delivered event is still a duplicate;
--     a TRANSFER event id carries a SHA-256 of the user id, never the id). The shadow row goes with the profile (on delete cascade).
--
-- Safe before or after the code: code that reads these columns or tables treats an error as "not there yet" (no push, plan_source
-- 'none', the register endpoint answers 503).

-- ---------------------------------------------------------------------------
-- 1. holler_push_tokens
-- ---------------------------------------------------------------------------
create table if not exists public.holler_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint holler_push_tokens_token_key unique (token),
  constraint holler_push_tokens_platform_check check (platform in ('ios', 'android')),
  constraint holler_push_tokens_token_len check (char_length(token) between 20 and 4096),
  constraint holler_push_tokens_app_version_len check (app_version is null or char_length(app_version) <= 32)
);

create index if not exists holler_push_tokens_user_idx on public.holler_push_tokens (user_id) where disabled_at is null;

alter table public.holler_push_tokens enable row level security;
revoke all on table public.holler_push_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_push_tokens to service_role;

-- ---------------------------------------------------------------------------
-- 1b. holler_matches.pushed_at: push delivery, separate from the email digest's `notified` (lib/push/notify.ts)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'holler_matches' and column_name = 'pushed_at') then
    alter table public.holler_matches add column pushed_at timestamptz;
    -- Every match that exists before push exists is history for push (verify-v1 decision 2): it is never pushed later.
    -- Runs only when the column is first added, so a re-run never stamps a newer match.
    update public.holler_matches set pushed_at = created_at;
  end if;
end $$;
-- No new index: the push read is by user_id and recent created_at, served by holler_matches_user_created_idx (0001). Members keep only
-- the 0001 grant (update of status); restated here so the column can never become member-writable through a broader grant.
revoke insert (pushed_at), update (pushed_at) on table public.holler_matches from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. holler_profiles columns
-- ---------------------------------------------------------------------------
alter table public.holler_profiles add column if not exists plan_source text not null default 'none';
alter table public.holler_profiles add column if not exists store_product_id text;
alter table public.holler_profiles add column if not exists store_expires_at timestamptz;
alter table public.holler_profiles add column if not exists store_env text;
alter table public.holler_profiles add column if not exists last_pushed_at timestamptz;
alter table public.holler_profiles add column if not exists push_alerts boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'holler_profiles_plan_source_check') then
    alter table public.holler_profiles
      add constraint holler_profiles_plan_source_check check (plan_source in ('none', 'stripe', 'apple', 'google'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'holler_profiles_store_env_check') then
    alter table public.holler_profiles
      add constraint holler_profiles_store_env_check check (store_env is null or store_env in ('sandbox', 'production'));
  end if;
end
$$;

-- A row that already holds a Stripe subscription is billed by Stripe. Runs once in effect: afterwards no row matches.
update public.holler_profiles
   set plan_source = 'stripe'
 where plan_source = 'none'
   and stripe_subscription_id is not null;

-- Column privileges (the model of 0001/0004: RLS decides rows, column grants decide columns). Members may read their own row (the web
-- reads it with select '*'), may write push_alerts, and are never granted the five server-only columns. The revokes are no-ops on a
-- correct database (0001 revoked table-level insert/update) and state the intent.
revoke insert (plan_source, store_product_id, store_expires_at, store_env, last_pushed_at),
       update (plan_source, store_product_id, store_expires_at, store_env, last_pushed_at)
  on table public.holler_profiles from anon, authenticated;
grant insert (push_alerts), update (push_alerts) on table public.holler_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Store columns are written by the server only, whatever the grants say. Same writer test as holler_profiles_billing_guard (0004).
-- ---------------------------------------------------------------------------
create or replace function public.holler_profiles_store_guard()
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
    return new; -- service role, database owner, or a SECURITY DEFINER function owned by it
  end if;

  if tg_op = 'INSERT' then
    if new.plan_source is distinct from 'none'
       or new.store_product_id is not null
       or new.store_expires_at is not null
       or new.store_env is not null
       or new.last_pushed_at is not null then
      raise exception 'holler_billing_guard: billing fields are set by the server only' using errcode = 'insufficient_privilege';
    end if;
  elsif new.plan_source is distinct from old.plan_source
     or new.store_product_id is distinct from old.store_product_id
     or new.store_expires_at is distinct from old.store_expires_at
     or new.store_env is distinct from old.store_env
     or new.last_pushed_at is distinct from old.last_pushed_at then
    raise exception 'holler_billing_guard: billing fields are set by the server only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.holler_profiles_store_guard() from public, anon, authenticated;

drop trigger if exists holler_profiles_billing_guard_store on public.holler_profiles;
create trigger holler_profiles_billing_guard_store
  before insert or update on public.holler_profiles
  for each row execute function public.holler_profiles_store_guard();

-- ---------------------------------------------------------------------------
-- 3b. Pro limits for a store plan that has lapsed (review r2 F7, in the database).
-- holler_profiles_plan_limits (0004, applied in production, so not re-issued here) judges Pro by plan and status alone. A store plan
-- whose EXPIRATION event was lost stays 'active', so that trigger would still let the member save Pro extras. This second trigger
-- applies the Solo rules of 0004 to such a row: plan 'pro', status active or past_due, plan_source apple or google, and a store expiry
-- that is missing or more than 3 days past (the same test and grace as lib/storebilling/source.ts isPaidNow, STORE_EXPIRY_GRACE_MS).
-- Like 0004 it checks only fields the write changes, so the server's own billing writes and a member's other edits pass. It only
-- refuses; 0004 still checks the shapes and the Pro maximums. Fires after holler_profiles_plan_limits (same-kind triggers fire in
-- name order); the order does not matter, because neither trigger changes the row.
-- ---------------------------------------------------------------------------
create or replace function public.holler_profiles_store_plan_limits()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (new.plan = 'pro'
          and new.subscription_status in ('active', 'past_due')
          and new.plan_source in ('apple', 'google')
          and (new.store_expires_at is null or new.store_expires_at + interval '3 days' < now())) then
    return new;
  end if;

  if (tg_op = 'INSERT' or new.extra_areas is distinct from old.extra_areas)
     and jsonb_typeof(new.extra_areas) = 'array' and jsonb_array_length(new.extra_areas) > 0 then
    raise exception 'holler_plan_limit: extra areas need Pro' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.keywords is distinct from old.keywords) and coalesce(cardinality(new.keywords), 0) > 0 then
    raise exception 'holler_plan_limit: keyword watches need Pro' using errcode = 'check_violation';
  end if;
  if (tg_op = 'INSERT' or new.categories is distinct from old.categories) and coalesce(cardinality(new.categories), 0) > 5 then
    raise exception 'holler_plan_limit: more than 5 trades needs Pro' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.holler_profiles_store_plan_limits() from public, anon, authenticated;

drop trigger if exists holler_profiles_plan_limits_store on public.holler_profiles;
create trigger holler_profiles_plan_limits_store
  before insert or update on public.holler_profiles
  for each row execute function public.holler_profiles_store_plan_limits();

-- ---------------------------------------------------------------------------
-- 4. holler_billing_events: the store event ledger
-- ---------------------------------------------------------------------------
create table if not exists public.holler_billing_events (
  event_id text primary key,
  user_id uuid,
  type text not null,
  store text not null,
  env text,
  product_id text,
  plan text,
  expires_at timestamptz,
  event_ts timestamptz not null,
  result text not null,
  received_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  constraint holler_billing_events_result_check check (
    result in ('applied', 'recorded', 'stale', 'other_store', 'no_profile', 'not_owner', 'unknown_product', 'no_expiry', 'expired',
               'sandbox', 'deferred')
  ),
  constraint holler_billing_events_plan_check check (plan is null or plan in ('starter', 'pro')),
  constraint holler_billing_events_raw_size check (octet_length(raw::text) <= 8000)
);

-- A database that ran an earlier draft of this file has the shorter result list: widen it (runs once; afterwards the check matches).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'holler_billing_events_result_check'
              and pg_get_constraintdef(oid) not like '%deferred%') then
    alter table public.holler_billing_events drop constraint holler_billing_events_result_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'holler_billing_events_result_check') then
    alter table public.holler_billing_events add constraint holler_billing_events_result_check check (
      result in ('applied', 'recorded', 'stale', 'other_store', 'no_profile', 'not_owner', 'unknown_product', 'no_expiry', 'expired',
                 'sandbox', 'deferred'));
  end if;
end
$$;

create index if not exists holler_billing_events_user_ts_idx on public.holler_billing_events (user_id, event_ts desc) where user_id is not null;
create index if not exists holler_billing_events_received_idx on public.holler_billing_events (received_at);

alter table public.holler_billing_events enable row level security;
revoke all on table public.holler_billing_events from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_billing_events to service_role;

-- ---------------------------------------------------------------------------
-- 4b. holler_billing_shadow: the paid source that is not the live one, for members who pay in two places
-- ---------------------------------------------------------------------------
create table if not exists public.holler_billing_shadow (
  user_id uuid primary key references public.holler_profiles(user_id) on delete cascade,
  store text,
  store_product_id text,
  store_plan text,
  store_expires_at timestamptz,
  store_env text,
  store_event_ts timestamptz,
  stripe_subscription_id text,
  stripe_status text,
  stripe_plan text,
  updated_at timestamptz not null default now(),
  constraint holler_billing_shadow_store_check check (store is null or store in ('apple', 'google')),
  constraint holler_billing_shadow_store_plan_check check (store_plan is null or store_plan in ('starter', 'pro')),
  constraint holler_billing_shadow_store_env_check check (store_env is null or store_env in ('sandbox', 'production')),
  constraint holler_billing_shadow_stripe_plan_check check (stripe_plan is null or stripe_plan in ('starter', 'pro'))
);

alter table public.holler_billing_shadow enable row level security;
revoke all on table public.holler_billing_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_billing_shadow to service_role;

-- ---------------------------------------------------------------------------
-- 5a. holler_billing_fallback: when the member's live plan has ended, move to the other source if that one is still paid.
-- Called inside holler_apply_store_event (after a store revoke) and holler_stripe_state (after a Stripe plan ends), in their
-- transaction, with the profile row already locked. Not granted to anyone: only those two SECURITY DEFINER functions call it.
-- Returns: kept (a live plan is still there), stripe / apple / google (switched to that source), none, no_profile.
-- ---------------------------------------------------------------------------
create or replace function public.holler_billing_fallback(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prof record;
  v_sh record;
begin
  select p.plan, p.subscription_status, p.plan_source, p.store_expires_at, p.stripe_subscription_id
    into v_prof
    from public.holler_profiles p
   where p.user_id = p_user_id
     for update;
  if not found then
    return 'no_profile';
  end if;
  if v_prof.subscription_status in ('active', 'past_due') and (
       v_prof.plan_source = 'stripe'
       or (v_prof.plan_source = 'none' and v_prof.stripe_subscription_id is not null)
       or (v_prof.plan_source in ('apple', 'google') and v_prof.store_expires_at is not null and v_prof.store_expires_at > now())) then
    return 'kept';
  end if;

  select s.* into v_sh from public.holler_billing_shadow s where s.user_id = p_user_id for update;
  if not found then
    return 'none';
  end if;

  if v_sh.stripe_subscription_id is not null and v_sh.stripe_status in ('active', 'past_due') and v_sh.stripe_plan in ('starter', 'pro') then
    update public.holler_profiles
       set plan = v_sh.stripe_plan,
           subscription_status = v_sh.stripe_status,
           plan_source = 'stripe',
           stripe_subscription_id = v_sh.stripe_subscription_id,
           updated_at = now()
     where user_id = p_user_id;
    update public.holler_billing_shadow
       set stripe_subscription_id = null, stripe_status = null, stripe_plan = null, updated_at = now()
     where user_id = p_user_id;
    return 'stripe';
  end if;

  if v_sh.store in ('apple', 'google') and v_sh.store_plan in ('starter', 'pro')
     and v_sh.store_expires_at is not null and v_sh.store_expires_at > now() then
    update public.holler_profiles
       set plan = v_sh.store_plan,
           subscription_status = 'active',
           plan_source = v_sh.store,
           store_product_id = v_sh.store_product_id,
           store_expires_at = v_sh.store_expires_at,
           store_env = v_sh.store_env,
           updated_at = now()
     where user_id = p_user_id;
    update public.holler_billing_shadow
       set store = null, store_product_id = null, store_plan = null, store_expires_at = null, store_env = null, store_event_ts = null,
           updated_at = now()
     where user_id = p_user_id;
    return v_sh.store;
  end if;
  return 'none';
end;
$$;

revoke all on function public.holler_billing_fallback(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5b. holler_apply_store_event: the single writer of store billing state
--
-- p_type is the RevenueCat event type. The webhook (lib/storebilling/revenuecat.ts) sends TRANSFER as TRANSFER_TO (the new owner,
-- with p_from_user_ids naming the old owners) and TRANSFER_FROM (each old owner), each with its own event id suffix, and a refund
-- (CANCELLATION with cancel_reason CUSTOMER_SUPPORT) as REFUND. What each type does:
--   INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, NON_RENEWING_PURCHASE
--       -> grant: plan from the product id, subscription_status 'active', plan_source = the store, store columns set.
--          Every RENEWAL sets the plan from the product it names, so a deferred downgrade lands with the RENEWAL of the new product
--          and a RENEWAL of the old product keeps the old plan.
--   PRODUCT_CHANGE
--       -> applied at once when the new product ranks HIGHER than the live plan from this store (an upgrade starts now), or the SAME
--          (monthly to yearly: product and expiry move at once, the expiry never moves back); a downgrade is 'deferred' and takes
--          effect with the RENEWAL that carries the new product.
--   EXPIRATION, SUBSCRIPTION_PAUSED, TRANSFER_FROM
--       -> revoke: subscription_status 'canceled' (the stored plan stays, like a Stripe cancel), only when this store owns the plan.
--   REFUND
--       -> revoke at once, expiry set to now at the latest; only for the product the member holds (or when the event names none).
--   BILLING_ISSUE
--       -> keeps access to the later of the expiry and the store's grace date (the webhook sends that later date).
--   SUBSCRIPTION_EXTENDED
--       -> only moves the expiry forward, and only on a plan from this store that is live right now (paid status, future expiry)
--          for the same plan the event names. Never re-activates a refunded, canceled or expired plan; never changes the plan.
--   TRANSFER_TO (review v2 P1)
--       -> in this one transaction: every old owner in p_from_user_ids is revoked (as TRANSFER_FROM, ledgered under the sibling
--          '<id>:from:<sha256 of the old id>' event id, so the webhook's own TRANSFER_FROM call that follows is a duplicate). When an
--          old owner's row holds a LIVE plan from this store right now (paid status, future expiry, a plan and a product), its plan,
--          product, env and expiry are granted to the new owner through the ordinary grant rules (stale, sandbox, the Stripe guard
--          and the shadow). When no old owner's row is live (lapsed, canceled, refunded, no expiry, past expiry), the new owner is
--          only recorded. A null expiry is never written. A new owner with no profile yet: 'no_profile', old owners untouched (the
--          TRANSFER_FROM calls still revoke them).
--   CANCELLATION, SUBSCRIBER_ALIAS and any other type
--       -> recorded only. A cancellation is a promise not to renew: the member paid through the period and EXPIRATION ends it.
-- A grant is never written without a future expiry: a store plan is never "paid forever".
-- Sandbox (TestFlight, license testers, App Review): a sandbox event never ends or changes a plan granted by a production event, and
-- a sandbox grant applies only when p_allow_sandbox is true (the webhook passes REVENUECAT_ALLOW_SANDBOX = '1') and the member has no
-- live production store plan. With p_allow_sandbox false a sandbox grant is ledgered as 'sandbox' and gives no plan. Every ledger row
-- records the env. A missing env is treated as production, null-safely (is distinct from), including in the shadow writes.
-- Two paid sources: an event blocked by the live one is kept in holler_billing_shadow; when the live one ends (a revoke applied here,
-- or a Stripe end through holler_stripe_state) holler_billing_fallback moves the plan to the surviving source in the same event.
-- Product id -> plan: the part before ':' (Play adds ':<basePlanId>'), lower-cased, must start with 'com.localholler.app.';
-- then '.pro.' -> 'pro', '.solo.' -> 'starter'. lib/storebilling/products.ts planForStoreProduct is the same rule in TypeScript.
-- Results (also the ledger's `result`):
--   applied          state changed
--   recorded         record-only type, or an extension that does not apply; nothing changed
--   deferred         a PRODUCT_CHANGE that is a downgrade; waits for the RENEWAL of the new product
--   duplicate        this event id is already in the ledger (nothing written)
--   stale            older than the last applied event for this member; ledgered, nothing changed
--   no_expiry        a grant with no expiry; nothing changed
--   expired          a grant whose expiry has already passed; nothing changed
--   sandbox          a sandbox event that would touch a production plan, or a sandbox grant while sandbox grants are off
--   other_store      a live plan billed elsewhere would be overwritten: never over a live Stripe plan; over a live plan from the
--                    other store only an upgrade applies (an expiry or a same-or-lower plan does not). Kept as shadow state.
--   not_owner        a revoke for a plan this store does not own (a trial member, or a lapsed plan from elsewhere); nothing changed
--   unknown_product  a grant for a product id that is not ours; nothing changed
--   no_profile       the member has no Holler profile (yet). Ledgered; a later delivery of the same event id may still apply.
-- Never raises for anything a store can send (a raise is a 500 and RevenueCat retries), except an empty event id.
-- FOR UPDATE on the profile row serialises two deliveries for one member, so the stale and guard checks cannot race. A TRANSFER_TO
-- locks the new and old owners' rows together in user id order, so two transfers between the same accounts cannot deadlock.
-- An earlier draft of this file had nine parameters; that overload is dropped so a call by name is never ambiguous.
-- ---------------------------------------------------------------------------
drop function if exists public.holler_apply_store_event(text, uuid, text, text, text, text, timestamptz, timestamptz, jsonb);

create or replace function public.holler_apply_store_event(
  p_event_id text,
  p_user_id uuid,
  p_type text,
  p_store text,
  p_env text,
  p_product_id text,
  p_expires_at timestamptz,
  p_event_ts timestamptz,
  p_raw jsonb,
  p_from_user_ids uuid[] default null,
  p_allow_sandbox boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_type text := upper(btrim(coalesce(p_type, '')));
  v_store text := lower(btrim(coalesce(p_store, '')));
  v_env text := nullif(lower(btrim(coalesce(p_env, ''))), '');
  v_ts timestamptz := coalesce(p_event_ts, now());
  v_pid text := nullif(btrim(split_part(coalesce(p_product_id, ''), ':', 1)), '');
  v_plan text;
  v_action text;
  v_result text;
  v_raw jsonb := coalesce(p_raw, '{}'::jsonb);
  v_prof record;
  v_sh record;
  v_last timestamptz;
  v_exp timestamptz;
  v_stripe_live boolean;
  v_store_live boolean;
  v_prod_live boolean;
  v_rank_new int;
  v_rank_old int;
  v_rank_sh int;
  v_in_exp timestamptz := p_expires_at;
  v_from uuid;
  v_from_id text;
  v_from_result text;
  v_old record;
  v_old_last timestamptz;
  v_src_found boolean := false;
  v_src_pid text;
  v_src_plan text;
  v_src_exp timestamptz;
  v_src_env text;
begin
  if v_event_id = '' then
    raise exception 'holler_apply_store_event: p_event_id is required';
  end if;
  if v_store not in ('apple', 'google') then
    v_store := 'google'; -- the webhook sends only apple or google; never raise on store input
  end if;
  if v_env is not null and v_env not in ('sandbox', 'production') then
    v_env := null;
  end if;
  if octet_length(v_raw::text) > 8000 then
    v_raw := jsonb_build_object('trimmed', true);
  end if;

  -- Only our own products (com.localholler.app.*) count; another app's '.pro.' product never grants anything.
  v_plan := case
    when lower(coalesce(v_pid, '')) not like 'com.localholler.app.%' then null
    when lower(coalesce(v_pid, '')) like '%.pro.%' then 'pro'
    when lower(coalesce(v_pid, '')) like '%.solo.%' then 'starter'
    else null
  end;

  v_action := case
    when v_type in ('INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE') then 'grant'
    when v_type = 'PRODUCT_CHANGE' then 'change'
    when v_type in ('EXPIRATION', 'SUBSCRIPTION_PAUSED', 'TRANSFER_FROM') then 'revoke'
    when v_type = 'REFUND' then 'refund'
    when v_type in ('BILLING_ISSUE', 'SUBSCRIPTION_EXTENDED') then 'extend'
    else 'record'
  end;

  -- (a) Seen it already? A 'no_profile' row does not count: that delivery wrote nothing, so a later one may apply.
  if exists (select 1 from public.holler_billing_events b where b.event_id = v_event_id and b.result <> 'no_profile') then
    return 'duplicate';
  end if;

  -- (b) The member's profile, locked for the rest of this transaction. A TRANSFER_TO locks the old owners' rows with it, in user id
  -- order (one lock order for every transfer, so two transfers between the same accounts wait for each other instead of deadlocking).
  if v_type = 'TRANSFER_TO' and coalesce(cardinality(p_from_user_ids), 0) > 0 then
    perform 1 from public.holler_profiles p
     where p.user_id = any (array_append(p_from_user_ids, p_user_id))
     order by p.user_id
       for update;
  end if;
  select p.plan, p.subscription_status, p.plan_source, p.store_expires_at, p.store_product_id, p.store_env, p.stripe_subscription_id
    into v_prof
    from public.holler_profiles p
   where p.user_id = p_user_id
     for update;

  if found and exists (select 1 from public.holler_billing_events b where b.event_id = v_event_id and b.result <> 'no_profile') then
    return 'duplicate'; -- a concurrent delivery of the same event committed while this one waited for the lock
  end if;

  -- (b2) TRANSFER_TO (review v2 P1): revoke every old owner here, in this transaction, and take over a plan that is live right now.
  if found and v_type = 'TRANSFER_TO' and coalesce(cardinality(p_from_user_ids), 0) > 0 then
    for v_from in
      select distinct u from unnest(p_from_user_ids) as u where u is not null and u <> p_user_id order by 1
    loop
      -- The same event id the webhook's own TRANSFER_FROM call carries (lib/storebilling/revenuecat.ts userIdHash).
      v_from_id := regexp_replace(v_event_id, ':to:[0-9a-f]{64}$', '')
                   || ':from:' || encode(sha256(convert_to(lower(v_from::text), 'UTF8')), 'hex');
      continue when exists (select 1 from public.holler_billing_events b where b.event_id = v_from_id and b.result <> 'no_profile');
      select p.plan, p.subscription_status, p.plan_source, p.store_expires_at, p.store_product_id, p.store_env
        into v_old
        from public.holler_profiles p
       where p.user_id = v_from;
      if not found then
        v_from_result := 'no_profile';
      else
        select max(b.event_ts) into v_old_last
          from public.holler_billing_events b
         where b.user_id = v_from and b.result = 'applied';
        if v_old_last is not null and v_ts < v_old_last then
          v_from_result := 'stale'; -- the old owner's state is newer than this transfer: neither revoked nor copied
        elsif v_old.plan_source is distinct from v_store then
          v_from_result := 'not_owner';
          update public.holler_billing_shadow
             set store = null, store_product_id = null, store_plan = null, store_expires_at = null, store_env = null,
                 store_event_ts = null, updated_at = now()
           where user_id = v_from and store = v_store
             and not (v_env is not distinct from 'sandbox' and store_env is not distinct from 'production');
        elsif v_env is not distinct from 'sandbox' and v_old.store_env is not distinct from 'production' then
          v_from_result := 'sandbox'; -- a sandbox transfer never moves or ends a production plan
        else
          if not v_src_found
             and v_old.subscription_status in ('active', 'past_due')
             and v_old.store_expires_at is not null and v_old.store_expires_at > now()
             and v_old.plan in ('starter', 'pro')
             and v_old.store_product_id is not null then
            v_src_found := true;
            v_src_pid := v_old.store_product_id;
            v_src_plan := v_old.plan;
            v_src_exp := v_old.store_expires_at;
            v_src_env := v_old.store_env;
          end if;
          update public.holler_profiles
             set subscription_status = 'canceled',
                 store_env = coalesce(v_env, store_env),
                 updated_at = now()
           where user_id = v_from;
          perform public.holler_billing_fallback(v_from);
          v_from_result := 'applied';
        end if;
      end if;
      insert into public.holler_billing_events
        (event_id, user_id, type, store, env, product_id, plan, expires_at, event_ts, result, raw)
      values
        (v_from_id, case when v_from_result = 'no_profile' then null else v_from end, 'TRANSFER_FROM', v_store, v_env,
         null, null, null, v_ts, v_from_result, v_raw)
      on conflict (event_id) do update
        set user_id = excluded.user_id, type = excluded.type, store = excluded.store, env = excluded.env,
            product_id = excluded.product_id, plan = excluded.plan, expires_at = excluded.expires_at, event_ts = excluded.event_ts,
            result = excluded.result, raw = excluded.raw, received_at = now()
        where public.holler_billing_events.result = 'no_profile';
    end loop;
    if v_src_found then
      -- The new owner gets exactly what the old owner had live, through the ordinary grant rules below. Never a null expiry.
      v_action := 'grant';
      v_pid := v_src_pid;
      v_in_exp := v_src_exp;
      v_env := v_src_env;
      v_plan := case
        when lower(coalesce(v_pid, '')) not like 'com.localholler.app.%' then null
        when lower(coalesce(v_pid, '')) like '%.pro.%' then 'pro'
        when lower(coalesce(v_pid, '')) like '%.solo.%' then 'starter'
        else null
      end;
      if v_plan is distinct from v_src_plan then
        v_plan := null; -- product and plan disagree on the old row: grant nothing ('unknown_product')
      end if;
    end if;
  end if;

  -- The profile lookup above decides 'no_profile'; (b2) used its own queries, so test the row itself.
  if v_prof is null or v_prof.plan_source is null then
    v_result := 'no_profile';
  elsif v_action = 'record' then
    v_result := 'recorded';
  elsif v_action in ('grant', 'change') and v_plan is null then
    v_result := 'unknown_product';
  else
    -- (c) Stale: older than the last event that changed this member's state.
    select max(b.event_ts) into v_last
      from public.holler_billing_events b
     where b.user_id = p_user_id and b.result = 'applied';
    v_stripe_live := v_prof.subscription_status in ('active', 'past_due')
      and (v_prof.plan_source = 'stripe' or (v_prof.plan_source = 'none' and v_prof.stripe_subscription_id is not null));
    -- A store plan with no expiry is never live.
    v_store_live := v_prof.subscription_status in ('active', 'past_due')
      and v_prof.plan_source in ('apple', 'google')
      and v_prof.store_expires_at is not null and v_prof.store_expires_at > now();
    v_prod_live := v_store_live and v_prof.store_env is not distinct from 'production';
    v_rank_new := case v_plan when 'pro' then 2 when 'starter' then 1 else 0 end;
    v_rank_old := case v_prof.plan when 'pro' then 2 when 'starter' then 1 else 0 end;
    -- The expiry a grant writes. A plan change from the store that owns the plan never moves it back.
    v_exp := case
      when v_action = 'change' and v_prof.plan_source = v_store
        then greatest(v_in_exp, v_prof.store_expires_at)
      else v_in_exp
    end;
    select s.* into v_sh from public.holler_billing_shadow s where s.user_id = p_user_id for update;
    v_rank_sh := case v_sh.store_plan when 'pro' then 2 when 'starter' then 1 else 0 end;

    if v_last is not null and v_ts < v_last then
      v_result := 'stale';
    elsif v_action in ('grant', 'change') and v_exp is null then
      v_result := 'no_expiry';
    elsif v_action in ('grant', 'change') and v_exp <= now() then
      v_result := 'expired';
    elsif v_env is not distinct from 'sandbox' and v_action in ('grant', 'change') and not coalesce(p_allow_sandbox, false) then
      -- (d0) Sandbox grants are off (REVENUECAT_ALLOW_SANDBOX is not '1'): ledgered, no plan, no shadow.
      v_result := 'sandbox';
    elsif v_env is not distinct from 'sandbox' and (
            (v_action in ('grant', 'change') and v_prod_live)
            or (v_action in ('revoke', 'refund', 'extend') and v_prof.plan_source = v_store
                and v_prof.store_env is not distinct from 'production')) then
      -- (d) A sandbox event never ends or changes a production plan; a sandbox grant waits until no production plan is live.
      v_result := 'sandbox';
    elsif v_stripe_live
          or (v_store_live and v_prof.plan_source <> v_store
              and (v_action in ('revoke', 'refund', 'extend') or v_rank_new <= v_rank_old)) then
      -- (e) Never overwrite a live web (Stripe) plan; over the other store's live plan only an upgrade takes over.
      -- What this store says is kept as shadow state, so the plan can move here when the live source ends.
      v_result := 'other_store';
      if v_action in ('grant', 'change') then
        if (v_sh.store is null or v_sh.store = v_store or v_sh.store_expires_at is null or v_sh.store_expires_at <= now())
           and (v_action = 'grant' or v_sh.store is distinct from v_store or v_rank_new > v_rank_sh)
           and not (v_env is not distinct from 'sandbox' and v_sh.store_env is not distinct from 'production'
                    and coalesce(v_sh.store_expires_at > now(), false))
           and (v_sh.store_event_ts is null or v_ts >= v_sh.store_event_ts) then
          insert into public.holler_billing_shadow as s
            (user_id, store, store_product_id, store_plan, store_expires_at, store_env, store_event_ts, updated_at)
          values (p_user_id, v_store, v_pid, v_plan,
                  case when v_sh.store = v_store then greatest(v_exp, v_sh.store_expires_at) else v_exp end, v_env, v_ts, now())
          on conflict (user_id) do update
            set store = excluded.store, store_product_id = excluded.store_product_id, store_plan = excluded.store_plan,
                store_expires_at = excluded.store_expires_at, store_env = excluded.store_env, store_event_ts = excluded.store_event_ts,
                updated_at = now();
        end if;
      elsif v_action in ('revoke', 'refund') then
        if v_sh.store is not distinct from v_store
           and not (v_env is not distinct from 'sandbox' and v_sh.store_env is not distinct from 'production') then
          update public.holler_billing_shadow
             set store = null, store_product_id = null, store_plan = null, store_expires_at = null, store_env = null,
                 store_event_ts = null, updated_at = now()
           where user_id = p_user_id;
        end if;
      elsif v_action = 'extend' and v_sh.store is not distinct from v_store and v_in_exp is not null
            and (v_type <> 'SUBSCRIPTION_EXTENDED'
                 or (v_sh.store_plan is not distinct from v_plan and coalesce(v_sh.store_expires_at > now(), false))) then
        update public.holler_billing_shadow
           set store_expires_at = greatest(store_expires_at, v_in_exp), updated_at = now()
         where user_id = p_user_id;
      end if;
    elsif v_action in ('revoke', 'refund') then
      if v_prof.plan_source = v_store
         and (v_action = 'revoke' or v_pid is null or v_prof.store_product_id is null
              or lower(v_pid) = lower(v_prof.store_product_id)) then
        update public.holler_profiles
           set subscription_status = 'canceled',
               store_expires_at = case
                 when v_action = 'refund' then least(coalesce(v_in_exp, now()), now())
                 else coalesce(v_in_exp, store_expires_at)
               end,
               store_env = coalesce(v_env, store_env),
               updated_at = now()
         where user_id = p_user_id;
        v_result := 'applied';
        -- The live plan ended: if the member still pays elsewhere (Stripe or the other store), the plan moves there now.
        perform public.holler_billing_fallback(p_user_id);
      else
        v_result := 'not_owner';
        if v_sh.store is not distinct from v_store
           and not (v_env is not distinct from 'sandbox' and v_sh.store_env is not distinct from 'production') then
          update public.holler_billing_shadow
             set store = null, store_product_id = null, store_plan = null, store_expires_at = null, store_env = null,
                 store_event_ts = null, updated_at = now()
           where user_id = p_user_id;
        end if;
      end if;
    elsif v_action = 'extend' then
      -- SUBSCRIPTION_EXTENDED (review v2 P2) also needs the plan to be live right now and the event to name the same plan.
      if v_prof.plan_source = v_store and v_prof.subscription_status in ('active', 'past_due')
         and v_in_exp is not null and v_in_exp > coalesce(v_prof.store_expires_at, '-infinity'::timestamptz)
         and (v_type <> 'SUBSCRIPTION_EXTENDED'
              or (v_store_live and v_plan is not distinct from v_prof.plan)) then
        update public.holler_profiles
           set store_expires_at = v_in_exp,
               store_env = coalesce(v_env, store_env),
               updated_at = now()
         where user_id = p_user_id;
        v_result := 'applied';
      else
        v_result := 'recorded';
      end if;
    elsif v_action = 'change' and not (v_store_live and v_prof.plan_source = v_store and v_rank_new >= v_rank_old) then
      -- A downgrade starts at the next renewal (the store bills the old plan until then). A same-rank change (monthly to yearly)
      -- from the owning store moves product and expiry now (the expiry never moves back, see v_exp).
      v_result := 'deferred';
    else
      if v_store_live and v_prof.plan_source in ('apple', 'google') and v_prof.plan_source <> v_store then
        -- An upgrade from this store takes over the other store's live plan: keep that plan so it can come back.
        insert into public.holler_billing_shadow as s
          (user_id, store, store_product_id, store_plan, store_expires_at, store_env, store_event_ts, updated_at)
        values (p_user_id, v_prof.plan_source, v_prof.store_product_id, v_prof.plan, v_prof.store_expires_at, v_prof.store_env, v_ts, now())
        on conflict (user_id) do update
          set store = excluded.store, store_product_id = excluded.store_product_id, store_plan = excluded.store_plan,
              store_expires_at = excluded.store_expires_at, store_env = excluded.store_env, store_event_ts = excluded.store_event_ts,
              updated_at = now();
      elsif v_sh.store = v_store then
        -- This store's plan is now the live one; its shadow copy is not needed any more.
        update public.holler_billing_shadow
           set store = null, store_product_id = null, store_plan = null, store_expires_at = null, store_env = null,
               store_event_ts = null, updated_at = now()
         where user_id = p_user_id;
      end if;
      update public.holler_profiles
         set plan = v_plan,
             subscription_status = 'active',
             plan_source = v_store,
             store_product_id = v_pid,
             store_expires_at = v_exp,
             store_env = v_env,
             updated_at = now()
       where user_id = p_user_id;
      v_result := 'applied';
    end if;
  end if;

  insert into public.holler_billing_events
    (event_id, user_id, type, store, env, product_id, plan, expires_at, event_ts, result, raw)
  values
    (v_event_id, case when v_result = 'no_profile' then null else p_user_id end, left(v_type, 40), v_store, v_env,
     left(v_pid, 200), v_plan, v_in_exp, v_ts, v_result, v_raw)
  on conflict (event_id) do update
    set user_id = excluded.user_id, type = excluded.type, store = excluded.store, env = excluded.env,
        product_id = excluded.product_id, plan = excluded.plan, expires_at = excluded.expires_at, event_ts = excluded.event_ts,
        result = excluded.result, raw = excluded.raw, received_at = now()
    where public.holler_billing_events.result = 'no_profile';

  return v_result;
end;
$$;

revoke all on function public.holler_apply_store_event(text, uuid, text, text, text, text, timestamptz, timestamptz, jsonb, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.holler_apply_store_event(text, uuid, text, text, text, text, timestamptz, timestamptz, jsonb, uuid[], boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5c. holler_stripe_state: the Stripe webhook's side of the shadow state (app/api/stripe/webhook/route.ts stripeState)
--   - A paid Stripe subscription (active, past_due) with a plan is remembered: id, status, plan.
--   - Any other status for the remembered subscription marks it unpaid (a stale "active" never comes back).
--   - A paid Stripe plan of a HIGHER rank about to take over a live store plan: that store plan is kept, so it comes back when
--     Stripe ends (the webhook calls this before its write). Returns 'store_kept'.
--   - Otherwise, when the member's live plan has ended, holler_billing_fallback moves the plan to the surviving source and its
--     answer is returned (kept, stripe, apple, google, none). Unknown member: 'no_profile'.
-- ---------------------------------------------------------------------------
create or replace function public.holler_stripe_state(p_user_id uuid, p_subscription_id text, p_status text, p_plan text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_plan text := case when p_plan in ('starter', 'pro') then p_plan else null end;
  v_paid boolean;
  v_prof record;
begin
  v_paid := v_status in ('active', 'past_due');
  select p.plan, p.subscription_status, p.plan_source, p.store_product_id, p.store_expires_at, p.store_env
    into v_prof
    from public.holler_profiles p
   where p.user_id = p_user_id
     for update;
  if not found then
    return 'no_profile';
  end if;

  insert into public.holler_billing_shadow (user_id) values (p_user_id) on conflict (user_id) do nothing;
  if v_sub is not null then
    if v_paid and v_plan is not null then
      update public.holler_billing_shadow
         set stripe_subscription_id = v_sub, stripe_status = v_status, stripe_plan = v_plan, updated_at = now()
       where user_id = p_user_id;
    else
      update public.holler_billing_shadow
         set stripe_status = nullif(v_status, ''), updated_at = now()
       where user_id = p_user_id and stripe_subscription_id = v_sub;
    end if;
  end if;

  if v_paid and v_plan is not null
     and v_prof.plan_source in ('apple', 'google') and v_prof.subscription_status in ('active', 'past_due')
     and v_prof.store_expires_at is not null and v_prof.store_expires_at > now()
     and (case v_plan when 'pro' then 2 else 1 end) > (case v_prof.plan when 'pro' then 2 when 'starter' then 1 else 0 end) then
    update public.holler_billing_shadow
       set store = v_prof.plan_source, store_product_id = v_prof.store_product_id, store_plan = v_prof.plan,
           store_expires_at = v_prof.store_expires_at, store_env = v_prof.store_env, store_event_ts = now(), updated_at = now()
     where user_id = p_user_id;
    return 'store_kept';
  end if;

  return public.holler_billing_fallback(p_user_id);
end;
$$;

revoke all on function public.holler_stripe_state(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.holler_stripe_state(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Account deletion: push tokens go with the profile; ledger rows are detached from the member.
-- ---------------------------------------------------------------------------
create or replace function public.holler_profiles_delete_mobile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_push_tokens where user_id = old.user_id;
  update public.holler_billing_events set user_id = null where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_mobile() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_mobile on public.holler_profiles;
create trigger holler_profiles_delete_mobile
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_mobile();
