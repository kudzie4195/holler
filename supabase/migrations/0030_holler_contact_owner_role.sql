-- Holler: role 'owner' on a "who to contact" row (round 18, NAMES). Idempotent; holler_ objects only.
-- Shared Supabase project: never touch non-holler objects.
--
-- A code-violation record may name the institutional company that owns the property ("Owner on the public record: X"). Only a company
-- that passes the institutional-owner rule (lib/contacts/owner-company.ts: a final legal form such as LLC, INC, CORP, LP, a trust
-- company or a housing authority, and no person's name in it) is written, with its name only: no phone, email, address or id. The app
-- writes such rows only while HOLLER_VIOLATION_OWNERS_ENABLED is on (off by default).
--
-- holler_signal_contacts keeps RLS on with no policies and every privilege revoked from public, anon and authenticated (migration 0006);
-- this changes only the allowed role values and adds a name-only check for owner rows. Safe to apply before or after the code: until it
-- is applied the writer drops owner rows on the check violation and writes every other contact (lib/signals/store.ts ownerRoleRefused).
-- Run after 0006; before it (no table) the block does nothing.

do $$
declare
  c record;
  has_license boolean;
begin
  if to_regclass('public.holler_signal_contacts') is null then
    return;
  end if;
  -- The old role check, under its own name or any other (an auto-generated or renamed copy): a check that lists the five old roles and
  -- not 'owner' (review P3-2).
  for c in
    select conname from pg_constraint
    where conrelid = 'public.holler_signal_contacts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%''site''%''buyer''%'
      and pg_get_constraintdef(oid) not like '%owner%'
  loop
    execute format('alter table public.holler_signal_contacts drop constraint %I', c.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint where conname = 'holler_signal_contacts_role_check' and conrelid = 'public.holler_signal_contacts'::regclass
  ) then
    alter table public.holler_signal_contacts
      add constraint holler_signal_contacts_role_check check (role in ('site', 'business', 'contractor', 'awardee', 'buyer', 'owner'));
  end if;
  -- An owner row is the company name only (review P3-2; redo 2: also `license` when migration 0022 added that column). Convergent: a
  -- check written by an earlier run without `license` is replaced, and any owner row that already carries a detail (only possible by
  -- hand) is reduced to its name first, so adding the check never stops on an existing row (review 2, P3-8).
  has_license := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'holler_signal_contacts' and column_name = 'license'
  );
  if has_license and exists (
    select 1 from pg_constraint
    where conname = 'holler_signal_contacts_owner_name_only'
      and conrelid = 'public.holler_signal_contacts'::regclass
      and pg_get_constraintdef(oid) not like '%license%'
  ) then
    alter table public.holler_signal_contacts drop constraint holler_signal_contacts_owner_name_only;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'holler_signal_contacts_owner_name_only' and conrelid = 'public.holler_signal_contacts'::regclass
  ) then
    update public.holler_signal_contacts
      set phone = null, email = null, website = null, attn = null, address = '', city = null, state = null, zip = null
      where role = 'owner';
    if has_license then
      execute 'update public.holler_signal_contacts set license = null where role = ''owner''';
    end if;
    execute format(
      'alter table public.holler_signal_contacts add constraint holler_signal_contacts_owner_name_only check (role <> %L or (phone is null and email is null and website is null and attn is null and coalesce(btrim(address), %L) = %L and city is null and state is null and zip is null%s))',
      'owner', '', '', case when has_license then ' and license is null' else '' end
    );
  end if;
end $$;
