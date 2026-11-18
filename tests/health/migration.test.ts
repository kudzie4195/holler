import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/0010_holler_source_health.sql'), 'utf8');

describe('migration 0010 text (the PGlite run is migtest_0010.mjs)', () => {
  it('is idempotent, prefixed, RLS on, service role only', () => {
    expect(sql).toMatch(/create table if not exists public\.holler_source_health/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.holler_source_health from public, anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant [^;]*to (anon|authenticated)/i);
  });
  it('lists the four statuses and the 300 character cap', () => {
    for (const s of ['healthy', 'delayed', 'degraded', 'unavailable']) expect(sql).toContain(`'${s}'`);
    expect(sql).toMatch(/char_length\(last_error\) <= 300/);
  });
});
