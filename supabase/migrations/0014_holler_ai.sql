-- Holler: AI classification layer (round 7, unit AI). Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_signal_ai   One row per signal the cron AI step has looked at (lib/ai/classify.ts). trades is an object of
--                    trade id -> confidence 0..1 (only ids from lib/signals/categories.ts, checked in code before the write);
--                    notes is an object of trade id -> one "why this matters" line (at most 2, at most 140 characters each, checked
--                    in code). When the AI result replaced the signal's categories, applied is true and prev_categories keeps the
--                    rule-based categories it replaced. rematched_at is set once lib/signals/rematch.ts ran for the change, so a
--                    failed rematch is retried by the next run. Built only from public signal fields: no member data, no contacts.
-- holler_ai_spend    One row per model call, from the cron classification step (kind classify) and from member reply drafts (kind
--                    draft): a reservation for the worst-case cost, settled to the real token usage. The monthly cap is enforced by
--                    summing cost_usd for the month (holler_ai_month_spend). Rows with kind alert_80 / alert_100 (cost 0) record that
--                    the admin was emailed for that threshold that month; a unique index makes that once per month per threshold.
--                    alert_price (a model with no price) is once per day: unique on (day, kind). usd_per_1k is cost per 1,000
--                    signals for the call.
-- holler_ai_cache    Result cache keyed by a SHA-256 of exactly what the model sees for a record (kind, subtype, source, title,
--                    summary, city, state, rule trades), with only case and whitespace normalized, plus key version, prompt version
--                    and model id (lib/ai/classify.ts cacheKey). A hit is written to holler_signal_ai with no model call. hits counts reuses.
--                    Holds only trade confidences and generic notes; a cached note is re-checked against each signal's own input.
-- holler_ai_month_spend  The month's total cost_usd, summed in SQL so the cap never depends on how many rows one read returns.
-- holler_ai_apply    Writes one batch in a single transaction: the holler_signal_ai rows and, for rows that carry an "apply" list,
--                    the new holler_signals.categories plus data.cat_src = 'ai'. A row for a signal that was already classified
--                    (an overlapping run) or deleted meanwhile is skipped. Returns the ids of signals whose categories changed.
--
-- Internal tables, service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated; the
-- function is executable by service_role only. Safe to apply before or after the code: the code reports "not_migrated" and changes
-- nothing when these objects are missing.

create table if not exists public.holler_signal_ai (
  signal_id bigint primary key references public.holler_signals(id) on delete cascade,
  trades jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  model text not null,
  prompt_v int not null,
  prev_categories text[],
  applied boolean not null default false,
  origin text not null default 'model',
  rematched_at timestamptz,
  created_at timestamptz not null default now(),
  constraint holler_signal_ai_trades_object check (jsonb_typeof(trades) = 'object' and octet_length(trades::text) <= 1000),
  constraint holler_signal_ai_notes_object check (jsonb_typeof(notes) = 'object' and octet_length(notes::text) <= 1000),
  constraint holler_signal_ai_model_len check (char_length(model) between 1 and 100),
  constraint holler_signal_ai_prompt_v check (prompt_v between 1 and 1000),
  constraint holler_signal_ai_origin_check check (origin in ('model', 'cache', 'skip'))
);
create index if not exists holler_signal_ai_created_idx on public.holler_signal_ai (created_at desc);
create index if not exists holler_signal_ai_pending_rematch_idx on public.holler_signal_ai (created_at) where applied and rematched_at is null;

create table if not exists public.holler_ai_spend (
  id bigserial primary key,
  month date not null,
  kind text not null,
  signals int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now(),
  cache_hits int not null default 0,
  cache_misses int not null default 0,
  skipped int not null default 0,
  constraint holler_ai_spend_kind_check
    check (kind in ('reserved', 'classify', 'draft', 'error', 'unknown', 'refused', 'run', 'alert_80', 'alert_100', 'alert_price')),
  constraint holler_ai_spend_month_first check (extract(day from month) = 1),
  constraint holler_ai_spend_nonneg check (cost_usd >= 0 and signals >= 0 and input_tokens >= 0 and output_tokens >= 0
    and cache_hits >= 0 and cache_misses >= 0 and skipped >= 0)
);
-- Added separately so a table created by an earlier copy of this file still gets it.
alter table public.holler_ai_spend
  add column if not exists usd_per_1k numeric(12, 6) generated always as (case when signals > 0 then round(cost_usd * 1000 / signals, 6) end) stored;
-- The UTC day of a once-a-day alert row (alert_price). Null on every other row.
alter table public.holler_ai_spend add column if not exists day date;
-- Kinds, replaced so a table created by an earlier copy of this file gets 'draft' and 'alert_price' too.
alter table public.holler_ai_spend drop constraint if exists holler_ai_spend_kind_check;
alter table public.holler_ai_spend add constraint holler_ai_spend_kind_check
  check (kind in ('reserved', 'classify', 'draft', 'error', 'unknown', 'refused', 'run', 'alert_80', 'alert_100', 'alert_price'));
alter table public.holler_ai_spend drop constraint if exists holler_ai_spend_day_check;
alter table public.holler_ai_spend add constraint holler_ai_spend_day_check check ((kind = 'alert_price') = (day is not null));
create index if not exists holler_ai_spend_month_idx on public.holler_ai_spend (month);

create table if not exists public.holler_ai_cache (
  key text primary key,
  trades jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  model text not null,
  prompt_v int not null,
  created_at timestamptz not null default now(),
  hits int not null default 0,
  constraint holler_ai_cache_key_sha256 check (key ~ '^[0-9a-f]{64}$'),
  constraint holler_ai_cache_trades_object check (jsonb_typeof(trades) = 'object' and octet_length(trades::text) <= 1000),
  constraint holler_ai_cache_notes_object check (jsonb_typeof(notes) = 'object' and octet_length(notes::text) <= 1000),
  constraint holler_ai_cache_model_len check (char_length(model) between 1 and 100),
  constraint holler_ai_cache_prompt_v check (prompt_v between 1 and 1000),
  constraint holler_ai_cache_hits_nonneg check (hits >= 0)
);
create index if not exists holler_ai_cache_created_idx on public.holler_ai_cache (created_at);
create unique index if not exists holler_ai_spend_alert_once_idx on public.holler_ai_spend (month, kind) where kind in ('alert_80', 'alert_100');
create unique index if not exists holler_ai_spend_alert_day_idx on public.holler_ai_spend (day, kind) where kind = 'alert_price';

alter table public.holler_signal_ai enable row level security;
alter table public.holler_ai_spend enable row level security;
alter table public.holler_ai_cache enable row level security;

revoke all on table public.holler_signal_ai, public.holler_ai_spend, public.holler_ai_cache from public, anon, authenticated;
revoke all on sequence public.holler_ai_spend_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_signal_ai, public.holler_ai_spend, public.holler_ai_cache to service_role;
grant usage, select on sequence public.holler_ai_spend_id_seq to service_role;

-- p_rows: [{ "signal_id": 1, "trades": {...}, "notes": {...}, "model": "...", "prompt_v": 1, "origin": "model|cache|skip",
--            "apply": ["roofing", ...], "cache_key": "<sha256 hex>", "cache_put": true }, ...]
-- "apply" is present only when the code decided the AI categories should replace the rule-based ones. For a row that was written:
-- origin 'model' with cache_put stores the result in holler_ai_cache (first writer wins); origin 'cache' with cache_key adds 1 to hits.
create or replace function public.holler_ai_apply(p_rows jsonb)
returns setof bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_id bigint;
  v_new text[];
  v_old text[];
  v_inserted int;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'holler_ai_apply: p_rows must be a json array';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_id := (r->>'signal_id')::bigint;
    select s.categories into v_old from public.holler_signals s where s.id = v_id for update;
    if not found then
      continue; -- deleted by the prune meanwhile
    end if;
    insert into public.holler_signal_ai (signal_id, trades, notes, model, prompt_v, origin)
    values (v_id, coalesce(r->'trades', '{}'::jsonb), coalesce(r->'notes', '{}'::jsonb), r->>'model', (r->>'prompt_v')::int,
            coalesce(r->>'origin', 'model'))
    on conflict (signal_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      continue; -- an overlapping run classified it first
    end if;
    if r->>'cache_key' is not null then
      if coalesce(r->>'origin', 'model') = 'model' and (r->>'cache_put')::boolean is true then
        insert into public.holler_ai_cache (key, trades, notes, model, prompt_v)
        values (r->>'cache_key', coalesce(r->'trades', '{}'::jsonb), coalesce(r->'notes', '{}'::jsonb), r->>'model', (r->>'prompt_v')::int)
        on conflict (key) do nothing;
      elsif r->>'origin' = 'cache' then
        update public.holler_ai_cache set hits = hits + 1 where key = r->>'cache_key';
      end if;
    end if;
    if jsonb_typeof(r->'apply') = 'array' and jsonb_array_length(r->'apply') > 0 then
      select array_agg(x order by ord) into v_new from jsonb_array_elements_text(r->'apply') with ordinality as t(x, ord);
      if (select array_agg(x order by x) from unnest(v_old) x) is distinct from (select array_agg(x order by x) from unnest(v_new) x) then
        update public.holler_signals
          set categories = v_new, data = coalesce(data, '{}'::jsonb) || jsonb_build_object('cat_src', 'ai')
          where id = v_id;
        update public.holler_signal_ai set prev_categories = v_old, applied = true where signal_id = v_id;
        return next v_id;
      end if;
    end if;
  end loop;
  return;
end;
$$;

revoke all on function public.holler_ai_apply(jsonb) from public, anon, authenticated;
grant execute on function public.holler_ai_apply(jsonb) to service_role;

-- The month's total spend in one call (lib/ai/budget.ts monthSpendUsd). Security invoker: it reads only what the caller may read, and
-- only service_role may call it.
create or replace function public.holler_ai_month_spend(p_month date)
returns numeric
language sql
set search_path = public, pg_temp
as $$
  select coalesce(sum(cost_usd), 0) from public.holler_ai_spend where month = p_month;
$$;

revoke all on function public.holler_ai_month_spend(date) from public, anon, authenticated;
grant execute on function public.holler_ai_month_spend(date) to service_role;
