-- Holler: contractor licence number on a "who to contact" row (PLAN-2.0 item 1.2). Purely additive and idempotent; holler_ objects only.
-- Shared Supabase project: never touch non-holler objects.
--
-- A permit that publishes the licence number of the contractor company (Raleigh, NYC DOB NOW) carries it next to the company name, so a
-- member can check the licence on the state or city registry. It is a public registry id of the BUSINESS. A person's id, an owner's
-- phone or a homeowner's data is never written here (the app classifies names before writing, lib/contacts/sanitize.ts cleanLicense).
--
-- holler_signal_contacts keeps RLS on with no policies and every privilege revoked from public, anon and authenticated (migration 0006);
-- adding a column changes none of that. Safe to apply before or after the code: the writer and the loader both retry without the column
-- when it is missing.

alter table public.holler_signal_contacts add column if not exists license text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holler_signal_contacts_license_len' and conrelid = 'public.holler_signal_contacts'::regclass
  ) then
    alter table public.holler_signal_contacts
      add constraint holler_signal_contacts_license_len check (license is null or char_length(license) <= 40);
  end if;
end $$;
