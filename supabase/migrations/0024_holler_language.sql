-- Holler 0024: member language preference (r17 ES, Spanish alerts, cards and drafts).
-- Additive and idempotent (safe to run twice); holler_* only. The owner applies this by hand.
--
-- What it adds:
--  1. holler_profiles.language: 'en' or 'es', default 'en'. Every existing row reads 'en', so nothing changes for anyone until a
--     member picks Espanol in Settings.
--  2. A check constraint that keeps the value to those two codes.
--  3. Column privileges in the model of 0001/0004/0020: RLS decides rows, column grants decide columns. A member may write their own
--     language (like alert_email and push_alerts). No other column grant changes.
--
-- Apply at or before the round 17 deploy (LAUNCH.md, "Round 17 order"): /es points readers to the Settings language control, which is
-- hidden until this runs. Nothing breaks without it: with this migration NOT applied, the profile row has no `language` key and the app
-- treats every member as English. The Settings language control is hidden, the alert email, the cards and the drafts render in English
-- exactly as before, and no save ever fails because of the missing column.

alter table public.holler_profiles add column if not exists language text not null default 'en';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_profiles_language_check' and conrelid = 'public.holler_profiles'::regclass
  ) then
    alter table public.holler_profiles
      add constraint holler_profiles_language_check check (language in ('en', 'es'));
  end if;
end
$$;

grant insert (language), update (language) on table public.holler_profiles to authenticated;
