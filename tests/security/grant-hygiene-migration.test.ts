// Security pass r16 SEC-2: migration 0023 revokes the default TRUNCATE/TRIGGER/REFERENCES (and stray DELETE/write) grants that
// anon and authenticated still hold on holler_* objects (read live from information_schema.role_table_grants, see the report).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const FILE = '0023_holler_grant_hygiene.sql';
const read = () => readFileSync(`${dir}/${FILE}`, 'utf8');
const code = () =>
  read()
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ');

describe(FILE, () => {
  it('exists and takes the next free number after 0022', () => {
    expect(existsSync(`${dir}/${FILE}`)).toBe(true);
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(files.filter((f) => f.startsWith('0023_'))).toEqual([FILE]);
    expect(files.indexOf(FILE)).toBe(files.indexOf('0022_holler_contact_license.sql') + 1);
  });

  it('revokes TRUNCATE (which bypasses RLS), TRIGGER and REFERENCES on every holler table that still had them', () => {
    const c = code();
    for (const t of ['holler_matches', 'holler_profiles', 'holler_scan_runs', 'holler_signals']) {
      expect(c).toContain(`revoke truncate, trigger, references on table public.${t} from public, anon, authenticated;`);
    }
  });

  it('revokes DELETE on holler_profiles and every write on the read-only view holler_place_counts', () => {
    const c = code();
    expect(c).toContain('revoke delete on table public.holler_profiles from public, anon, authenticated;');
    expect(c).toContain('revoke insert, update, delete, truncate, trigger, references on table public.holler_place_counts from public, anon, authenticated;');
    expect(c).toContain('revoke all on function public.holler_set_updated_at() from public, anon, authenticated;');
  });

  it('keeps what the public pages and members need: no SELECT revoked on signals, place counts or profiles; no grants, no DDL', () => {
    const c = code();
    expect(c).not.toMatch(/revoke [^;]*select[^;]*public\.(holler_signals|holler_place_counts|holler_profiles)\b/);
    expect(c).not.toMatch(/revoke select on table public\.holler_matches from [^;]*authenticated/);
    expect(c).not.toMatch(/\bgrant\b/);
    expect(c).not.toMatch(/\b(create|drop|alter|insert into|update public|delete from|truncate table)\b/);
    for (const m of c.matchAll(/public\.(\w+)/g)) expect(m[1]).toMatch(/^holler_/);
  });
});
