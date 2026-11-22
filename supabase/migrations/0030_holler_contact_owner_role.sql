-- Holler: role 'owner' on a "who to contact" row (round 18, NAMES). Idempotent; holler_ objects only.
-- Shared Supabase project: never touch non-holler objects.
--
-- A code-violation record may name the registered company that owns the property ("Owner on the public record: X"). Only a company that
-- passes the strict registered-company rule (lib/contacts/owner-company.ts: a final legal form such as LLC, INC, CORP, LP, a trust
-- company or a housing authority, and nothing that reads as a person) is written, with its name only: no phone, email, address or id.
--
-- holler_signal_contacts keeps RLS on with no policies and every privilege revoked from public, anon and authenticated (migration 0006);
-- this changes only the allowed role values. Safe to apply before or after the code: until it is applied the writer drops owner rows
-- on the check violation and writes every other contact (lib/signals/store.ts ownerRoleRefused).

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'holler_signal_contacts_role_check'
      and conrelid = 'public.holler_signal_contacts'::regclass
      and pg_get_constraintdef(oid) not like '%owner%'
  ) then
    alter table public.holler_signal_contacts drop constraint holler_signal_contacts_role_check;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'holler_signal_contacts_role_check' and conrelid = 'public.holler_signal_contacts'::regclass
  ) then
    alter table public.holler_signal_contacts
      add constraint holler_signal_contacts_role_check check (role in ('site', 'business', 'contractor', 'awardee', 'buyer', 'owner'));
  end if;
end $$;
