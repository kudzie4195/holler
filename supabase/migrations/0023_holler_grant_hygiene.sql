-- 0023 holler grant hygiene (security pass r16, SEC-2). Additive, holler_* only, revokes only: nothing is created or dropped and
-- no row is touched. Safe to run twice (REVOKE of a privilege that is not held is a no-op).
--
-- Why: Supabase's default privileges give anon and authenticated ALL on new public tables. Earlier migrations revoked INSERT/UPDATE
-- (and granted the column lists the app needs), but TRUNCATE, TRIGGER, REFERENCES and (on holler_profiles) DELETE stayed. Read
-- live with information_schema.role_table_grants on 2026-11-22:
--   holler_matches, holler_profiles, holler_scan_runs, holler_signals: anon + authenticated hold TRUNCATE, TRIGGER, REFERENCES
--   holler_profiles: anon + authenticated also hold DELETE (no DELETE policy, so RLS answers 0 rows today)
--   holler_place_counts (view, not updatable): anon + authenticated hold INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
--   holler_set_updated_at(): EXECUTE for anon + authenticated (PUBLIC default)
-- TRUNCATE ignores row level security. PostgREST has no TRUNCATE verb, so none of this is reachable from the API today; but the
-- project is shared with other products, and one SQL-executing function anywhere in it would turn the grant into "empty Holler's
-- tables". The app never needs any of these: account deletion runs as service_role, and the member/anon clients only SELECT
-- (plus the column UPDATE/INSERT grants from 0001-0020, which are left exactly as they are).
--
-- Kept on purpose: SELECT on holler_signals, holler_place_counts (public pages read them with the anon key), the RLS-scoped SELECT
-- on holler_profiles/holler_matches for authenticated, and every column-level INSERT/UPDATE grant.

revoke truncate, trigger, references on table public.holler_matches from public, anon, authenticated;
revoke truncate, trigger, references on table public.holler_profiles from public, anon, authenticated;
revoke truncate, trigger, references on table public.holler_scan_runs from public, anon, authenticated;
revoke truncate, trigger, references on table public.holler_signals from public, anon, authenticated;

-- No member ever deletes their own profile with their own client (lib/mobile/account.ts uses the service role).
revoke delete on table public.holler_profiles from public, anon, authenticated;

-- anon has no SELECT policy on these, so the grant returns nothing; drop it so the grant matches what RLS allows.
revoke select on table public.holler_matches from anon;
revoke select on table public.holler_scan_runs from anon, authenticated;

-- The view is read-only for everyone but the owner.
revoke insert, update, delete, truncate, trigger, references on table public.holler_place_counts from public, anon, authenticated;

-- Trigger function: only ever called by its trigger.
revoke all on function public.holler_set_updated_at() from public, anon, authenticated;
