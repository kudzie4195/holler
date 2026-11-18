-- Holler: DataForSEO tables. Purely additive and idempotent; every object is prefixed holler_.
-- Shared Supabase project: never touch non-holler objects.
--
-- holler_keyword_volume  Google search volume per keyword per month ("roofing atlanta"). Feeds sitemap priority (lib/seo/priority.ts).
--                        volume is null when Google returned no data for the keyword; the row still marks it as fetched this month.
-- holler_llm_mentions    One row per fixed AI-mention query per month: whether localholler.com was cited or mentioned.
--                        raw is a trimmed record (counts and at most 5 matching items), never full answer text. Internal only.
-- holler_dataforseo_spend One row per API call: a reservation for the estimated cost, settled to the real cost from the response.
--                        The monthly cap is enforced by summing cost_usd for the month.
--
-- Internal tables, service role only: RLS on with NO policies, every privilege revoked from public, anon and authenticated.
-- No personal data is stored. Safe to apply before or after the code: the code answers with a soft status when a table is missing
-- and never spends without a spend row.

create table if not exists public.holler_keyword_volume (
  keyword text not null,
  location_code integer not null default 2840,
  month date not null,
  volume integer,
  fetched_at timestamptz not null default now(),
  primary key (keyword, location_code, month),
  constraint holler_keyword_volume_keyword_len check (char_length(keyword) between 1 and 80),
  constraint holler_keyword_volume_month_first check (extract(day from month) = 1),
  constraint holler_keyword_volume_nonneg check (volume is null or volume >= 0)
);
create index if not exists holler_keyword_volume_month_idx on public.holler_keyword_volume (month, location_code, keyword);

create table if not exists public.holler_llm_mentions (
  id bigserial primary key,
  month date not null,
  query text not null,
  status text not null,
  cited boolean not null default false,
  mentioned boolean not null default false,
  total_count integer,
  items_checked integer not null default 0,
  raw jsonb,
  cost_usd numeric(10, 5) not null default 0,
  checked_at timestamptz not null default now(),
  constraint holler_llm_mentions_status_check check (status in ('cited', 'mentioned', 'not_found', 'no_data')),
  constraint holler_llm_mentions_query_len check (char_length(query) between 1 and 200),
  constraint holler_llm_mentions_month_first check (extract(day from month) = 1),
  constraint holler_llm_mentions_raw_size check (raw is null or octet_length(raw::text) <= 16000),
  constraint holler_llm_mentions_cost_nonneg check (cost_usd >= 0)
);
-- A plain unique index so INSERT ... ON CONFLICT (month, query) works through PostgREST.
create unique index if not exists holler_llm_mentions_month_query_idx on public.holler_llm_mentions (month, query);

create table if not exists public.holler_dataforseo_spend (
  id bigserial primary key,
  month date not null,
  endpoint text not null,
  units integer not null default 0,
  estimated_usd numeric(10, 5) not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  status text not null default 'reserved',
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holler_dataforseo_spend_status_check check (status in ('reserved', 'ok', 'error', 'unknown', 'refused')),
  constraint holler_dataforseo_spend_month_first check (extract(day from month) = 1),
  constraint holler_dataforseo_spend_nonneg check (estimated_usd >= 0 and cost_usd >= 0),
  constraint holler_dataforseo_spend_detail_len check (detail is null or char_length(detail) <= 300)
);
create index if not exists holler_dataforseo_spend_month_idx on public.holler_dataforseo_spend (month);

alter table public.holler_keyword_volume enable row level security;
alter table public.holler_llm_mentions enable row level security;
alter table public.holler_dataforseo_spend enable row level security;

revoke all on table public.holler_keyword_volume, public.holler_llm_mentions, public.holler_dataforseo_spend from public, anon, authenticated;
revoke all on sequence public.holler_llm_mentions_id_seq, public.holler_dataforseo_spend_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.holler_keyword_volume, public.holler_llm_mentions, public.holler_dataforseo_spend to service_role;
grant usage, select on sequence public.holler_llm_mentions_id_seq, public.holler_dataforseo_spend_id_seq to service_role;
