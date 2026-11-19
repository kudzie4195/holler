-- Holler MOAT (round 7): long-run history without personal data, and outcome data. Purely additive and idempotent; every object is
-- prefixed holler_. Shared Supabase project: never touch non-holler objects.
--
-- 1. holler_signal_archive: a coarse copy of every signal, written before the 120-day prune deletes it. It holds ONLY source, kind,
--    subtype, categories, zip, county, city, state, date and severity. No title, summary, url, coordinates, street address, place slug
--    or data. Every text column is checked on the way in (see holler_archive_signals) and again by CHECK constraints, so a hostile
--    value in any other column of holler_signals cannot reach the archive.
--    zip is kept only when it is exactly 5 digits. county and city are kept only when they pass holler_plain_place(), which is the
--    same rule as cleanPlace() in lib/storms/report.ts (tests/moat/place-parity.test.ts keeps the two in step).
--    Resident requests (source 'holler-request') are never archived.
-- 2. holler_prune_signals(): archive then delete in one call (one transaction). The scan's prune calls it.
-- 3. holler_outcome_asks: "Did you get work from this?" asked once, seven days after a member marked an alert Useful.
-- 4. holler_alert_log: one row per match with the coarse facts, for the conversion view. No titles, addresses or free text.
-- 5. holler_conversion_by_source: alerts, emailed, answered, useful and led to work by source, kind, intent and trade for the last 30
--    and 90 days (service role only).
--
-- Safe to apply before or after the code: old code never touches these objects, and the new code treats a missing table or function as
-- "nothing to do".

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A plain place name or null. Same rule as cleanPlace() in lib/storms/report.ts:
--   squeeze white space, drop a leading "2 ESE " (distance and direction), at most 40 characters, letters, spaces and . ' - only,
--   starting with a letter, no road words, and title-case a name that is all capitals.
-- Postgres regular expressions use \y for a word boundary (\b means backspace there).
create or replace function public.holler_plain_place(raw text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  s text;
begin
  if raw is null then
    return null;
  end if;
  s := btrim(regexp_replace(raw, '\s+', ' ', 'g'));
  s := btrim(regexp_replace(s, '^\d+(\.\d+)?\s+[NSEW]{1,3}\s+', '', 'i'));
  if s = '' or char_length(s) > 40 then
    return null;
  end if;
  if s !~ '^[A-Za-z][A-Za-z .''-]*$' then
    return null;
  end if;
  if s ~* '\y(street|rd|road|ave|avenue|blvd|boulevard|hwy|highway|fwy|freeway|interstate|pkwy|parkway|mile|mm|exit|apt|suite|po box)\y|\yI-\d|\yUS-?\d|\ySR-?\d' then
    return null;
  end if;
  if s = upper(s) then
    s := initcap(lower(s));
  end if;
  return s;
end;
$$;

-- A short machine token (source, kind, subtype, category id): lower case letters, digits, _ . - only.
create or replace function public.holler_plain_token(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when raw ~ '^[a-z0-9][a-z0-9_.-]{0,39}$' then raw else null end;
$$;

-- Exactly five digits or null.
create or replace function public.holler_plain_zip(raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when raw ~ '^[0-9]{5}$' then raw else null end;
$$;

-- ---------------------------------------------------------------------------
-- 1. holler_signal_archive
-- ---------------------------------------------------------------------------
create table if not exists public.holler_signal_archive (
  id bigserial primary key,
  -- No foreign key: the archive outlives the signal on purpose.
  signal_id bigint not null,
  source text not null,
  kind text not null,
  subtype text,
  categories text[] not null default '{}',
  zip text,
  county text,
  city text,
  state text,
  occurred_on date not null,
  severity int,
  archived_at timestamptz not null default now(),
  constraint holler_signal_archive_signal_key unique (signal_id),
  constraint holler_signal_archive_source_check check (source ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'),
  constraint holler_signal_archive_kind_check check (kind ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'),
  constraint holler_signal_archive_subtype_check check (subtype is null or subtype ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'),
  constraint holler_signal_archive_zip_check check (zip is null or zip ~ '^[0-9]{5}$'),
  constraint holler_signal_archive_state_check check (state is null or state ~ '^[A-Z]{2}$'),
  constraint holler_signal_archive_county_check check (county is null or coalesce(public.holler_plain_place(county) = county, false)),
  constraint holler_signal_archive_city_check check (city is null or coalesce(public.holler_plain_place(city) = city, false)),
  constraint holler_signal_archive_severity_check check (severity is null or severity between 1 and 3)
);

create index if not exists holler_signal_archive_state_county_day_idx on public.holler_signal_archive (state, county, occurred_on);
create index if not exists holler_signal_archive_zip_day_idx on public.holler_signal_archive (zip, occurred_on);

alter table public.holler_signal_archive enable row level security;
revoke all on table public.holler_signal_archive from public, anon, authenticated;
revoke all on sequence public.holler_signal_archive_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_signal_archive to service_role;
grant usage, select on sequence public.holler_signal_archive_id_seq to service_role;

-- Copies the coarse columns of every signal that occurred before `before` (resident requests excluded). Idempotent: a signal already
-- archived is skipped (unique on signal_id). Returns the number of rows added.
create or replace function public.holler_archive_signals(before timestamptz)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  insert into public.holler_signal_archive (signal_id, source, kind, subtype, categories, zip, county, city, state, occurred_on, severity)
  select s.id,
         coalesce(public.holler_plain_token(s.source), 'unknown'),
         coalesce(public.holler_plain_token(s.kind), 'unknown'),
         public.holler_plain_token(s.data ->> 'subtype'),
         coalesce(array(select c from unnest(s.categories) as c where public.holler_plain_token(c) is not null), '{}'::text[]),
         public.holler_plain_zip(s.zip),
         public.holler_plain_place(s.county),
         public.holler_plain_place(s.city),
         case when s.state ~ '^[A-Z]{2}$' then s.state else null end,
         (s.occurred_at at time zone 'UTC')::date,
         s.severity
  from public.holler_signals s
  where s.occurred_at < before
    and s.source <> 'holler-request'
  on conflict on constraint holler_signal_archive_signal_key do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Archive then delete, one transaction
-- ---------------------------------------------------------------------------
-- Replaces the two plain deletes in pruneOldSignals. Old rows are archived and then deleted; the delete only touches a row that is
-- archived (or a resident request, which is never archived), so a row that could not be archived is kept. Rows dated far in the future
-- are garbage, not history: they are deleted without an archive copy.
-- A plpgsql function body is one transaction: if the archive insert fails, nothing is deleted.
create or replace function public.holler_prune_signals(cutoff timestamptz, future_cutoff timestamptz)
returns table (archived int, deleted_old int, deleted_future int)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a int;
  d int;
  f int;
begin
  a := public.holler_archive_signals(cutoff);
  delete from public.holler_signals s
  where s.occurred_at < cutoff
    and (s.source = 'holler-request' or exists (select 1 from public.holler_signal_archive x where x.signal_id = s.id));
  get diagnostics d = row_count;
  delete from public.holler_signals where occurred_at > future_cutoff;
  get diagnostics f = row_count;
  return query select a, d, f;
end;
$$;

revoke all on function public.holler_plain_place(text) from public, anon, authenticated;
revoke all on function public.holler_plain_token(text) from public, anon, authenticated;
revoke all on function public.holler_plain_zip(text) from public, anon, authenticated;
revoke all on function public.holler_archive_signals(timestamptz) from public, anon, authenticated;
revoke all on function public.holler_prune_signals(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.holler_plain_place(text) to service_role;
grant execute on function public.holler_plain_token(text) to service_role;
grant execute on function public.holler_plain_zip(text) to service_role;
grant execute on function public.holler_archive_signals(timestamptz) to service_role;
grant execute on function public.holler_prune_signals(timestamptz, timestamptz) to service_role;

-- One-time backfill: a coarse copy of every current row, so trend counts start today. Idempotent (unique on signal_id).
select public.holler_archive_signals('infinity'::timestamptz);

-- ---------------------------------------------------------------------------
-- 3. holler_outcome_asks
-- ---------------------------------------------------------------------------
-- One row per member per alert, written by the daily moat cron (service role). The row is the claim: it exists before any email goes
-- out, so an alert is asked once. channel is where the ask went first ('email' or 'feed'); the feed shows the prompt on any
-- unanswered row. Members read their own rows. They never write: answers go through the server.
create table if not exists public.holler_outcome_asks (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id bigint not null references public.holler_signals(id) on delete cascade,
  asked_at timestamptz not null default now(),
  channel text not null,
  answer text,
  answered_at timestamptz,
  constraint holler_outcome_asks_user_signal_key unique (user_id, signal_id),
  constraint holler_outcome_asks_channel_check check (channel in ('email', 'feed')),
  constraint holler_outcome_asks_answer_check check (answer is null or answer in ('yes', 'no', 'not_yet')),
  constraint holler_outcome_asks_answered_pair check ((answer is null) = (answered_at is null))
);

create index if not exists holler_outcome_asks_user_asked_idx on public.holler_outcome_asks (user_id, asked_at desc);
create index if not exists holler_outcome_asks_signal_idx on public.holler_outcome_asks (signal_id);

alter table public.holler_outcome_asks enable row level security;
revoke all on table public.holler_outcome_asks from public, anon, authenticated;
revoke all on sequence public.holler_outcome_asks_id_seq from public, anon, authenticated;
grant select on table public.holler_outcome_asks to authenticated;
grant select, insert, update, delete on table public.holler_outcome_asks to service_role;
grant usage, select on sequence public.holler_outcome_asks_id_seq to service_role;

drop policy if exists holler_outcome_asks_select_own on public.holler_outcome_asks;
create policy holler_outcome_asks_select_own on public.holler_outcome_asks
  for select to authenticated using (auth.uid() = user_id);

-- Records an answer once, and for "yes" sets the member's feedback verdict to led_to_work, in one transaction.
-- Returns 'recorded', 'already' (answered before), 'none' (never asked) or 'invalid'. An existing job value is kept.
create or replace function public.holler_record_outcome(p_user uuid, p_signal bigint, p_answer text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if p_user is null or p_signal is null or p_answer is null or p_answer not in ('yes', 'no', 'not_yet') then
    return 'invalid';
  end if;
  update public.holler_outcome_asks
     set answer = p_answer, answered_at = now()
   where user_id = p_user and signal_id = p_signal and answer is null;
  get diagnostics n = row_count;
  if n = 0 then
    if exists (select 1 from public.holler_outcome_asks where user_id = p_user and signal_id = p_signal) then
      return 'already';
    end if;
    return 'none';
  end if;
  if p_answer = 'yes' then
    insert into public.holler_signal_feedback (user_id, signal_id, verdict, job_value_usd)
    values (p_user, p_signal, 'led_to_work', null)
    on conflict on constraint holler_signal_feedback_user_signal_key do update set verdict = 'led_to_work';
  end if;
  return 'recorded';
end;
$$;

revoke all on function public.holler_record_outcome(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.holler_record_outcome(uuid, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. holler_alert_log (service role only)
-- ---------------------------------------------------------------------------
-- One row per match, written when the match is created and stamped when the alert is emailed. No titles, addresses or free text.
-- The row outlives the signal (signal_id is set null), and goes with the member (cascade, and the profile trigger below).
create table if not exists public.holler_alert_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id bigint references public.holler_signals(id) on delete set null,
  source text,
  kind text,
  subtype text,
  intent text,
  trade text,
  distance_bucket text,
  severity smallint,
  plan text,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  constraint holler_alert_log_user_signal_key unique (user_id, signal_id),
  constraint holler_alert_log_intent_check check (intent is null or intent in ('demand', 'spending', 'asking')),
  constraint holler_alert_log_bucket_check check (distance_bucket is null or distance_bucket in ('0-5', '5-15', '15-30', '30+')),
  constraint holler_alert_log_plan_check check (plan is null or plan in ('starter', 'pro')),
  constraint holler_alert_log_severity_check check (severity is null or severity between 1 and 3),
  constraint holler_alert_log_len_check check (
    coalesce(char_length(source), 0) <= 40 and coalesce(char_length(kind), 0) <= 40
    and coalesce(char_length(subtype), 0) <= 40 and coalesce(char_length(trade), 0) <= 40
  )
);

create index if not exists holler_alert_log_created_idx on public.holler_alert_log (created_at);
create index if not exists holler_alert_log_user_idx on public.holler_alert_log (user_id);
create index if not exists holler_alert_log_signal_idx on public.holler_alert_log (signal_id);
create index if not exists holler_alert_log_source_created_idx on public.holler_alert_log (source, created_at);

alter table public.holler_alert_log enable row level security;
revoke all on table public.holler_alert_log from public, anon, authenticated;
revoke all on sequence public.holler_alert_log_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_alert_log to service_role;
grant usage, select on sequence public.holler_alert_log_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 5. Conversion view (service role only)
-- ---------------------------------------------------------------------------
-- One row per window (30 and 90 days), source, kind, intent and trade. Counts the member's single answer per alert:
--   alerts        every logged match in the window
--   emailed       alerts that went out in an alert email (holler_alert_log.emailed_at is set)
--   answered      alerts the member gave any verdict (useful, not relevant or led to work)
--   useful        useful OR led to work. A "yes" to the follow-up moves the verdict from useful to led_to_work, so counting only
--                 'useful' would make this number shrink as answers arrive; this way it never does.
--   not_relevant, led_to_work, total_job_value_usd (job values on led_to_work answers)
-- No member identity (no user_id or signal_id). security_invoker: the caller's own privileges apply, and only service_role has any
-- on the log. Dropped and re-created (not "create or replace") so the column list can change while 0015 is unapplied; nothing
-- depends on the view.
drop view if exists public.holler_conversion_by_source;
create view public.holler_conversion_by_source
  with (security_invoker = true) as
select w.window_days,
       l.source,
       l.kind,
       l.intent,
       l.trade,
       count(*)::int as alerts,
       (count(*) filter (where l.emailed_at is not null))::int as emailed,
       count(f.user_id)::int as answered,
       (count(*) filter (where f.verdict in ('useful', 'led_to_work')))::int as useful,
       (count(*) filter (where f.verdict = 'not_relevant'))::int as not_relevant,
       (count(*) filter (where f.verdict = 'led_to_work'))::int as led_to_work,
       coalesce(sum(f.job_value_usd) filter (where f.verdict = 'led_to_work'), 0)::bigint as total_job_value_usd
from public.holler_alert_log l
cross join (values (30), (90)) as w(window_days)
left join public.holler_signal_feedback f on f.user_id = l.user_id and f.signal_id = l.signal_id
where l.created_at >= now() - make_interval(days => w.window_days)
group by w.window_days, l.source, l.kind, l.intent, l.trade;

revoke all on table public.holler_conversion_by_source from public, anon, authenticated;
grant select on table public.holler_conversion_by_source to service_role;

-- ---------------------------------------------------------------------------
-- Account deletion: Settings > Delete account removes the Holler profile but keeps auth.users, so the cascades above never fire.
-- Same pattern as 0008 and 0009.
-- ---------------------------------------------------------------------------
create or replace function public.holler_profiles_delete_moat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.holler_outcome_asks where user_id = old.user_id;
  delete from public.holler_alert_log where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.holler_profiles_delete_moat() from public, anon, authenticated;

drop trigger if exists holler_profiles_delete_moat on public.holler_profiles;
create trigger holler_profiles_delete_moat
  after delete on public.holler_profiles
  for each row execute function public.holler_profiles_delete_moat();
