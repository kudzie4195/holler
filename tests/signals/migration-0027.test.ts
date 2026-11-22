// Round 18 ROUTES: migration 0027 (holler_work_profiles and holler_matches.alert_hold) is a new, idempotent, holler_-only file with RLS on,
// nothing for anon, members limited to their own row, and no member write of alert_hold.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const FILE = '0027_holler_work_profile.sql';
const code = () =>
  readFileSync(`${dir}/${FILE}`, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');

describe(FILE, () => {
  it('exists, alone at number 0027', () => {
    expect(existsSync(`${dir}/${FILE}`)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.startsWith('0027_'))).toEqual([FILE]);
  });
  it('creates the table and adds the column idempotently, with guarded check constraints', () => {
    const c = code();
    expect(c).toContain('create table if not exists public.holler_work_profiles ( user_id uuid primary key references public.holler_profiles(user_id) on delete cascade');
    expect(c).toContain('alter table public.holler_matches add column if not exists alert_hold text');
    for (const k of ['holler_work_profiles_property_check', 'holler_work_profiles_min_value_check', 'holler_work_profiles_type_check', 'holler_matches_alert_hold_check']) {
      expect(c).toContain(`select 1 from pg_constraint where conname = '${k}'`);
    }
    expect(c).toContain("check (alert_hold is null or alert_hold in ('background', 'below_min', 'held'))");
    expect(c).toContain('drop policy if exists holler_work_profiles_select_own');
    expect(c).toContain('drop trigger if exists holler_work_profiles_set_updated_at');
  });
  it('RLS on, own-row policies only, nothing to anon, no member delete, no member write of alert_hold', () => {
    const c = code();
    expect(c).toContain('alter table public.holler_work_profiles enable row level security;');
    for (const p of ['for select to authenticated using (auth.uid() = user_id)', 'for insert to authenticated with check (auth.uid() = user_id)', 'for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)']) expect(c).toContain(p);
    expect(c).toContain('revoke all on table public.holler_work_profiles from public, anon, authenticated;');
    expect(c).not.toMatch(/grant [^;]* to [^;]*\banon\b/);
    expect(c).not.toMatch(/grant [^;]*delete[^;]* to authenticated/);
    expect(c).not.toMatch(/grant [^;]*alert_hold/);
    expect(c).toContain('revoke insert (alert_hold), update (alert_hold) on table public.holler_matches from anon, authenticated;');
    for (const m of c.matchAll(/public\.(\w+)/g)) expect(m[1]).toMatch(/^holler_/);
    expect(c).not.toMatch(/\b(drop table|drop column|delete from|truncate)\b/);
  });
});
