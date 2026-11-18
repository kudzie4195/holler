// Static checks on 0009 (the behaviour is tested against a real Postgres in /home/claude/gates/pg/migtest_0009.mjs).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/0009_holler_signal_feedback.sql', 'utf8');

describe('0009_holler_signal_feedback.sql', () => {
  it('creates only holler_ objects, idempotently, with RLS on', () => {
    expect(sql).toMatch(/create table if not exists public\.holler_signal_feedback/);
    expect(sql).toMatch(/alter table public\.holler_signal_feedback enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.holler_signal_feedback from public, anon, authenticated/);
    for (const m of sql.matchAll(/create (?:or replace )?(?:table|function|trigger|policy|index)(?: if not exists)? ([\w.]+)/g)) {
      expect(m[1].replace('public.', '')).toMatch(/^holler_/);
    }
  });
  it('gives members select, insert and update on their own rows and no delete', () => {
    expect(sql).toMatch(/grant select, insert, update on table public\.holler_signal_feedback to authenticated/);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).not.toMatch(/delete on table public\.holler_signal_feedback to authenticated/);
    expect(sql).not.toMatch(/to anon/i);
    expect(sql.match(/auth\.uid\(\) = user_id/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it('cascades with the signal and the user, and the profile delete trigger removes feedback', () => {
    expect(sql).toMatch(/signal_id bigint not null references public\.holler_signals\(id\) on delete cascade/);
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(sql).toMatch(/delete from public\.holler_signal_feedback where user_id = old\.user_id/);
    expect(sql).toMatch(/after delete on public\.holler_profiles/);
  });
});
