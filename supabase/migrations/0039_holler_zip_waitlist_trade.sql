-- Holler 0039: the ZIP waitlist keeps one row per (email, ZIP, trade), not one per (email, ZIP). Round 24 FIX2 (review D8).
-- NOT APPLIED by the branch: the owner runs it. Purely additive on data (no row is read, changed or deleted) and safe to run twice.
-- Shared Supabase project: only holler_ objects are touched.
--
-- Before this, holler_zip_waitlist_email_zip_idx (0031) made a second sign-up for the same email and ZIP with another trade a no-op.
-- After it, each trade is its own row (and its own double opt-in). A row with no trade (rows the live site collected before trades were
-- asked) stays unique per (email, ZIP): NULLS NOT DISTINCT (Postgres 15+, which Supabase runs) treats the null trades as equal.
--
-- The code works before and after (lib/waitlist/service.ts): it asks ON CONFLICT (email, zip, trade); while this index is missing
-- Postgres answers 42P10 and the code retries ON CONFLICT (email, zip), and a sign-up for a second trade then gets an email saying the
-- address is already on the list for that ZIP (renderWaitlistAlready), never a confirmation that names the trade that was not stored.
--
-- The existing rows are unique on (email, zip), so they are unique on (email, zip, trade) and the new index always builds.
-- Order: the new index first, then the old one goes, so there is never a moment with no unique key.
-- Check after running:
--   select indexname from pg_indexes where tablename = 'holler_zip_waitlist' order by 1;
--   -- holler_zip_waitlist_email_zip_trade_idx and holler_zip_waitlist_pending_idx (and the primary key); no holler_zip_waitlist_email_zip_idx
-- Rollback (only while no email has two rows): create unique index holler_zip_waitlist_email_zip_idx on public.holler_zip_waitlist (email, zip);
--   drop index public.holler_zip_waitlist_email_zip_trade_idx;

set lock_timeout = '5s';

create unique index if not exists holler_zip_waitlist_email_zip_trade_idx
  on public.holler_zip_waitlist (email, zip, trade) nulls not distinct;

drop index if exists public.holler_zip_waitlist_email_zip_idx;
