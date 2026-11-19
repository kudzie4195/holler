import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(__dirname, '../../../supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// Statement shapes whose object name must start with holler_. The captured group is the (possibly schema-qualified) name.
const NAME = String.raw`((?:"?public"?\.)?"?[a-zA-Z0-9_]+"?)`;
const PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?${NAME}`, 'gi'),
  new RegExp(String.raw`\b(?:create|drop)\s+(?:or\s+replace\s+)?function\s+(?:if\s+exists\s+)?${NAME}`, 'gi'),
  new RegExp(String.raw`\b(?:create|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+(?:not\s+)?exists\s+)?${NAME}`, 'gi'),
  new RegExp(String.raw`\b(?:create|drop)\s+(?:or\s+replace\s+)?trigger\s+(?:if\s+exists\s+)?${NAME}`, 'gi'),
  new RegExp(String.raw`\b(?:create|alter|drop)\s+policy\s+(?:if\s+exists\s+)?${NAME}`, 'gi'),
  new RegExp(String.raw`\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+(?:not\s+)?exists\s+)?${NAME}`, 'gi'),
  new RegExp(String.raw`\b(?:create|alter|drop)\s+(?:sequence|type|schema|extension|role|publication)\s+(?:if\s+(?:not\s+)?exists\s+)?${NAME}`, 'gi'),
  // targets of ON <table> in policies/triggers, and ALTER TABLE targets
  new RegExp(String.raw`\bon\s+${NAME}\s+(?:for|using|with|before|after|instead)\b`, 'gi'),
  new RegExp(String.raw`\bon\s+${NAME}\s*\(`, 'gi'),
  new RegExp(String.raw`\bon\s+${NAME}\s+using\b`, 'gi'),
  new RegExp(String.raw`\binsert\s+into\s+${NAME}`, 'gi'),
  new RegExp(String.raw`\bupdate\s+${NAME}\s+set\b`, 'gi'),
  new RegExp(String.raw`\bdelete\s+from\s+${NAME}`, 'gi'),
  new RegExp(String.raw`\btruncate\s+(?:table\s+)?${NAME}`, 'gi'),
];

function bare(name: string): string {
  return name.replace(/"/g, '').replace(/^public\./i, '');
}

function violations(sql: string): string[] {
  const clean = stripComments(sql);
  const bad: string[] = [];
  for (const re of PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const name = bare(m[1]);
      // `insert ... on conflict (cols)` is an upsert clause, not an object named "conflict" (round 7: 0014 and 0015 use it).
      if (name.toLowerCase() === 'conflict' && /^on\s+conflict\s*\($/i.test(m[0].trim())) continue;
      if (!name.startsWith('holler_')) bad.push(m[0].trim());
    }
  }
  return bad;
}

describe('migrations are holler-only and additive', () => {
  it('finds the migration', () => {
    expect(files).toContain('0001_holler.sql');
  });

  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), 'utf8');

    it(`${f}: no DROP/ALTER/CREATE/DML on a name not starting with holler_`, () => {
      expect(violations(sql)).toEqual([]);
    });

    it(`${f}: never drops a table, column, schema or function`, () => {
      // The one allowed drop: a superseded holler_ function signature (`drop function if exists public.holler_...`), so an upgrade never leaves two overloads.
      // Also allowed: `drop view if exists public.holler_...;` immediately re-created. A view holds no rows, so nothing is lost; round 7
      // 0015 re-creates holler_conversion_by_source this way because its column list changed (review r4).
      const clean = stripComments(sql)
        .replace(/\bdrop\s+function\s+if\s+exists\s+(?:public\.)?holler_[a-z_]+\s*\([^)]*\)\s*;/gi, '')
        .replace(/\bdrop\s+view\s+if\s+exists\s+(?:public\.)?(holler_[a-z_]+)\s*;(?=\s*create\s+view\s+(?:public\.)?\1\b)/gi, '');
      expect(clean).not.toMatch(/\bdrop\s+(table|column|schema|function|type|extension|view|index)\b/i);
      expect(clean).not.toMatch(/\btruncate\b/i);
    });

    it(`${f}: only references auth.users as a foreign key target`, () => {
      const clean = stripComments(sql);
      for (const m of clean.matchAll(/auth\.[a-z_]+/gi)) expect(['auth.users', 'auth.uid']).toContain(m[0].toLowerCase());
      expect(clean).not.toMatch(/\balter\s+table\s+auth\./i);
    });

    it(`${f}: idempotent creates`, () => {
      const clean = stripComments(sql);
      for (const m of clean.matchAll(/\bcreate\s+table\s+(?!if not exists)/gi)) throw new Error(`create table without if not exists: ${m[0]}`);
      for (const m of clean.matchAll(/\bcreate\s+(?:unique\s+)?index\s+(?!if not exists)/gi)) throw new Error(`create index without if not exists: ${m[0]}`);
    });
  }

  it('contains the four contract tables with RLS enabled', () => {
    const sql = stripComments(readFileSync(path.join(dir, '0001_holler.sql'), 'utf8'));
    for (const t of ['holler_profiles', 'holler_signals', 'holler_matches', 'holler_scan_runs']) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}\\b`));
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} enable row level security`));
    }
  });

  it('the checker itself catches a violation (self-test)', () => {
    expect(violations('create table if not exists public.users (id int);')).toEqual([expect.stringContaining('users')]);
    expect(violations('drop policy if exists "x" on public.clovermap_things;').length).toBeGreaterThan(0);
    expect(violations('alter table public.profiles add column x int;').length).toBeGreaterThan(0);
    expect(violations('create index if not exists foo_idx on public.holler_profiles (state);').length).toBeGreaterThan(0); // index name foo_idx
    expect(violations('create table if not exists public.holler_x (id int);')).toEqual([]);
  });
});
