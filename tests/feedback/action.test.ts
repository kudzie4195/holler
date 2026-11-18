// submitFeedback: unauthenticated and unmatched calls are refused; one row per member per signal; validation.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  matches: [] as Array<{ user_id: string; signal_id: number }>,
  rows: [] as Array<Record<string, any>>,
  writes: [] as Array<Record<string, any>>,
  reads: 0,
  matchError: false,
  writeError: false,
}));

vi.mock('@/lib/auth/session', () => ({ getUser: async () => h.user }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      if (table === 'holler_matches') {
        const f: Record<string, any> = {};
        const q: Record<string, any> = {
          select: () => q,
          eq: (c: string, v: unknown) => ((f[c] = v), q),
          limit: async () => {
            h.reads++;
            if (h.matchError) return { data: null, error: { message: 'x' } };
            return { data: h.matches.filter((m) => m.user_id === f.user_id && m.signal_id === f.signal_id).map(() => ({ id: 1 })), error: null };
          },
        };
        return q;
      }
      if (table === 'holler_signal_feedback') {
        return {
          upsert: async (row: Record<string, any>, opts: { onConflict: string }) => {
            h.writes.push({ row, opts });
            if (h.writeError) return { error: { message: 'x' } };
            const i = h.rows.findIndex((r) => r.user_id === row.user_id && r.signal_id === row.signal_id);
            if (i >= 0) h.rows[i] = { ...h.rows[i], ...row };
            else h.rows.push({ ...row });
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { submitFeedback } from '@/app/app/actions';

beforeEach(() => {
  h.user = { id: 'u1' };
  h.matches = [{ user_id: 'u1', signal_id: 10 }, { user_id: 'u1', signal_id: 11 }, { user_id: 'u2', signal_id: 10 }, { user_id: 'u2', signal_id: 99 }];
  h.rows = [];
  h.writes = [];
  h.reads = 0;
  h.matchError = false;
  h.writeError = false;
});
afterEach(() => vi.clearAllMocks());

describe('submitFeedback: access', () => {
  it('refuses an unauthenticated call before touching the database', async () => {
    h.user = null;
    const r = await submitFeedback(10, 'useful');
    expect(r.ok).toBe(false);
    expect(h.reads).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it('refuses a signal the member has no match row for (another member has one)', async () => {
    const r = await submitFeedback(99, 'useful');
    expect(r).toMatchObject({ ok: false, error: 'That alert is not in your feed.' });
    expect(h.writes).toHaveLength(0);
  });

  it('refuses a signal nobody was matched to', async () => {
    expect((await submitFeedback(12345, 'led_to_work', 500)).ok).toBe(false);
    expect(h.rows).toHaveLength(0);
  });

  it('writes the signed-in member id, never one from the caller', async () => {
    const r = await submitFeedback(10, 'useful');
    expect(r).toMatchObject({ ok: true, verdict: 'useful', jobValueUsd: null });
    expect(h.rows).toEqual([{ user_id: 'u1', signal_id: 10, verdict: 'useful', job_value_usd: null }]);
    expect(h.writes[0].opts).toEqual({ onConflict: 'user_id,signal_id' });
  });

  it('reports a database failure without claiming success', async () => {
    h.writeError = true;
    expect((await submitFeedback(10, 'useful')).ok).toBe(false);
    h.writeError = false;
    h.matchError = true;
    expect((await submitFeedback(10, 'useful')).ok).toBe(false);
    expect(h.rows).toHaveLength(0);
  });
});

describe('submitFeedback: one row per member per signal', () => {
  it('a second answer replaces the first', async () => {
    await submitFeedback(10, 'useful');
    await submitFeedback(10, 'not_relevant');
    await submitFeedback(10, 'led_to_work', 1200);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ verdict: 'led_to_work', job_value_usd: 1200 });
  });

  it('switching away from "led_to_work" clears the dollar amount', async () => {
    await submitFeedback(10, 'led_to_work', 1200);
    const r = await submitFeedback(10, 'useful', 1200);
    expect(r).toMatchObject({ ok: true, jobValueUsd: null });
    expect(h.rows[0]).toMatchObject({ verdict: 'useful', job_value_usd: null });
  });

  it('keeps separate rows for different signals and different members', async () => {
    await submitFeedback(10, 'useful');
    await submitFeedback(11, 'useful');
    h.user = { id: 'u2' };
    await submitFeedback(10, 'not_relevant');
    expect(h.rows).toHaveLength(3);
    expect(h.rows.filter((r) => r.signal_id === 10).map((r) => r.user_id).sort()).toEqual(['u1', 'u2']);
  });
});

describe('submitFeedback: validation', () => {
  it('rejects unknown verdicts and bad signal ids', async () => {
    for (const v of ['', 'great', 'USEFUL', 'led to work']) expect((await submitFeedback(10, v)).ok, v).toBe(false);
    for (const id of [0, -1, 1.5, NaN, Infinity, '10' as unknown as number]) expect((await submitFeedback(id, 'useful')).ok, String(id)).toBe(false);
    expect(h.writes).toHaveLength(0);
  });

  it('job value: whole dollars 0 to 1,000,000 only', async () => {
    for (const bad of [-1, 1_000_001, 12.5, NaN, Infinity, '500' as unknown as number]) {
      expect((await submitFeedback(10, 'led_to_work', bad)).ok, String(bad)).toBe(false);
    }
    expect(h.writes).toHaveLength(0);
    for (const good of [0, 1, 1_000_000]) {
      const r = await submitFeedback(10, 'led_to_work', good);
      expect(r, String(good)).toMatchObject({ ok: true, jobValueUsd: good });
    }
    expect((await submitFeedback(10, 'led_to_work', null)).ok).toBe(true);
    expect((await submitFeedback(10, 'led_to_work')).ok).toBe(true);
  });
});
