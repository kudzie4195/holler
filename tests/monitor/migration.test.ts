import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/0018_holler_ops_alerts.sql'), 'utf8');
const body = sql.replace(/^--.*$/gm, '');

describe('migration 0018 text (the PGlite run is /home/claude/gates/pg/migtest_0018.mjs)', () => {
  it('has the columns the contract names', () => {
    expect(body).toMatch(/create table if not exists public\.holler_ops_alerts/);
    for (const c of ['key text primary key', 'first_seen_at timestamptz', 'last_sent_at timestamptz', 'last_state text', 'count integer']) expect(body).toContain(c);
  });
  it('is service role only and idempotent', () => {
    expect(body).toMatch(/enable row level security/);
    expect(body).toMatch(/revoke all on table public\.holler_ops_alerts from public, anon, authenticated/);
    expect(body).not.toMatch(/create policy/i);
    expect(body).not.toMatch(/grant [^;]*to (anon|authenticated|public)/i);
    expect(body.match(/add column if not exists/g)).toHaveLength(3);
  });
  it('touches only holler_ objects', () => {
    const names = [...body.matchAll(/(?:table(?: if not exists)?|update)\s+(public\.\S+)/gi)].map((m) => m[1]);
    expect(names.every((n) => n.startsWith('public.holler_'))).toBe(true);
  });
  it('the code reads the table name and columns the migration creates', () => {
    const run = fs.readFileSync(path.join(__dirname, '../../lib/monitor/run.ts'), 'utf8');
    expect(run).toContain("'holler_ops_alerts'");
    for (const c of ['key', 'first_seen_at', 'last_sent_at', 'last_state', 'count']) expect(run).toContain(c);
  });
});
