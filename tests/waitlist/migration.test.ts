// Migration 0021 file checks (the parser run and a scratch-Postgres apply are in gates/r13/logs/B-migration-*.log).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WAITLIST_PAGES } from '../../lib/waitlist/copy';

const dir = 'supabase/migrations';
const FILE = '0021_holler_area_waitlist.sql';
const sql = readFileSync(`${dir}/${FILE}`, 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

describe('0021_holler_area_waitlist.sql', () => {
  it('takes the next free number: no other 0021, and 0020 is the one before', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(files.filter((f) => f.startsWith('0021_'))).toEqual([FILE]);
    expect(files).toContain('0020_holler_mobile.sql');
  });
  it('creates only holler_ objects in public, with if not exists (idempotent, as 0020)', () => {
    expect(code).toContain('create table if not exists public.holler_area_waitlist');
    for (const m of code.matchAll(/create (?:unique )?index if not exists (\w+)/g)) expect(m[1]).toMatch(/^holler_/);
    expect(code.match(/create (table|index|unique index)/g)).toHaveLength(3);
    for (const m of code.matchAll(/\bcreate (?:table|index|unique index)(?! if not exists)/g)) throw new Error(`not idempotent: ${m[0]}`);
    expect(code).not.toMatch(/create extension|citext/);
    expect(code).not.toMatch(/\b(auth|storage)\./);
  });
  it('has RLS on, no policy, nothing for public/anon/authenticated, everything for service_role', () => {
    expect(code).toContain('alter table public.holler_area_waitlist enable row level security');
    expect(code).not.toContain('create policy');
    expect(code).toContain('revoke all on table public.holler_area_waitlist from public, anon, authenticated');
    expect(code).toContain('grant select, insert, update, delete on table public.holler_area_waitlist to service_role');
    expect(code).not.toMatch(/grant [^;]*to (anon|authenticated|public)/);
  });
  it('has the columns the route writes and one row per (email, zip)', () => {
    for (const col of ['id bigserial primary key', 'email text not null', 'zip text not null', 'trade text not null', "page text not null default 'check'", 'created_at timestamptz not null default now()']) {
      expect(code).toContain(col);
    }
    expect(code).toMatch(/unique \(email, zip\)/);
    expect(code).toContain('check (email = lower(email))');
  });
  it('stores no visitor identifier: no ip, user agent or account column', () => {
    const cols = code.slice(code.indexOf('create table'), code.indexOf(');'));
    expect(cols).not.toMatch(/\b(ip|ip_hash|user_agent|ua|visitor|user_id)\b/);
  });
  it('the page check constraint lists the same tags as the code', () => {
    const m = code.match(/check \(page in \(([^)]*)\)\)/)!;
    expect(m[1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...WAITLIST_PAGES]);
  });
  it('LAUNCH.md lists it with a check and a rollback', () => {
    const launch = readFileSync('LAUNCH.md', 'utf8');
    expect(launch).toContain('supabase/migrations/0021_holler_area_waitlist.sql');
    expect(launch).toContain('drop table if exists public.holler_area_waitlist');
  });
});
