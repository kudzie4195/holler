import { describe, expect, it, vi } from 'vitest';
import { backfillMatches, BACKFILL_CAP, BACKFILL_DAYS } from '@/lib/signals/backfill';
import type { MatchProfile } from '@/lib/signals/match';

const NOW = new Date('2026-11-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const profile: MatchProfile = { user_id: 'u1', categories: ['roofing'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 };

interface Sig {
  id: number;
  categories: string[];
  lat: number | null;
  lon: number | null;
  state: string | null;
  severity: number;
  occurred_at: string;
  expires_at: string | null;
}
const sig = (id: number, over: Partial<Sig> = {}): Sig => ({
  id,
  categories: ['roofing'],
  lat: 33.953,
  lon: -84.55,
  state: 'GA',
  severity: 1,
  occurred_at: hoursAgo(id),
  expires_at: null,
  ...over,
});

/** Fake db: records calls, returns canned signals (ignores filters, like a stub, so the code's own filters are tested too). */
function fakeDb(signals: Sig[], opts: { selectError?: boolean; upsertError?: boolean; throwOnFrom?: boolean } = {}) {
  const upserts: { rows: Record<string, unknown>[]; options: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  const db = {
    from(table: string) {
      if (opts.throwOnFrom) throw new Error('boom');
      if (table === 'holler_signals') {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'overlaps', 'gte', 'lte', 'or', 'order']) q[m] = (...a: unknown[]) => (calls.push(`${m}:${a.join('|')}`), q);
        q.limit = (n: number) => (calls.push(`limit:${n}`), Promise.resolve(opts.selectError ? { data: null, error: { message: 'down' } } : { data: signals, error: null }));
        return q;
      }
      return {
        upsert: (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
          upserts.push({ rows, options });
          return Promise.resolve({ error: opts.upsertError ? { message: 'nope' } : null });
        },
      };
    },
  };
  return { db: db as never, upserts, calls };
}

describe('backfillMatches', () => {
  it('reads at most 7 days ahead and ranks a future event as now, so it does not outrank a fresh record of the same severity', async () => {
    const f = fakeDb([sig(1, { occurred_at: hoursAgo(30) }), sig(2, { occurred_at: new Date(NOW.getTime() + 5 * 86_400_000).toISOString() }), sig(3, { occurred_at: hoursAgo(1) })]);
    await backfillMatches(f.db, profile, NOW);
    expect(f.calls.some((c) => c.startsWith('lte:occurred_at|') && c.includes('2026-11-24'))).toBe(true);
    // ranks: id 2 and id 3 are both "now or 1 h ago" -> 2 (clamped to now) then 3, then the 30 h old one
    expect(f.upserts[0].rows.map((r) => r.signal_id)).toEqual([2, 3, 1]);
  });
  it('caps at 25', async () => {
    const f = fakeDb(Array.from({ length: 60 }, (_, i) => sig(i + 1)));
    const r = await backfillMatches(f.db, profile, NOW);
    expect(r.matched).toBe(BACKFILL_CAP);
    expect(f.upserts[0].rows).toHaveLength(25);
  });

  it('orders most severe first, then newest', async () => {
    const f = fakeDb([sig(5, { severity: 1 }), sig(2, { severity: 1 }), sig(9, { severity: 3 }), sig(7, { severity: 2 })]);
    await backfillMatches(f.db, profile, NOW);
    expect(f.upserts[0].rows.map((r) => r.signal_id)).toEqual([9, 7, 2, 5]);
  });

  it('drops expired signals and uses a 14 day window in the query', async () => {
    const f = fakeDb([sig(1, { expires_at: hoursAgo(1) }), sig(2, { expires_at: hoursAgo(-5) }), sig(3)]);
    await backfillMatches(f.db, profile, NOW);
    expect(f.upserts[0].rows.map((r) => r.signal_id).sort()).toEqual([2, 3]);
    const since = new Date(NOW.getTime() - BACKFILL_DAYS * 86_400_000).toISOString();
    expect(f.calls).toContain(`gte:occurred_at|${since}`);
    expect(f.calls).toContain('limit:2000');
    expect(f.calls.some((c) => c.startsWith('overlaps:categories'))).toBe(true);
  });

  it('inserts notified = true with upsert ignoring duplicates', async () => {
    const f = fakeDb([sig(1)]);
    await backfillMatches(f.db, profile, NOW);
    expect(f.upserts[0].rows[0]).toMatchObject({ user_id: 'u1', signal_id: 1, notified: true });
    expect(f.upserts[0].options).toEqual({ onConflict: 'user_id,signal_id', ignoreDuplicates: true });
  });

  it('is idempotent: a second run sends the same rows to an ignore-duplicates upsert', async () => {
    const signals = [sig(1), sig(2)];
    const a = fakeDb(signals);
    const b = fakeDb(signals);
    await backfillMatches(a.db, profile, NOW);
    await backfillMatches(b.db, profile, NOW);
    expect(b.upserts[0].rows).toEqual(a.upserts[0].rows);
  });

  it('applies the matchOne rules: radius, category, and the state-level severity rule', async () => {
    const f = fakeDb([
      sig(1, { lat: 40.7, lon: -74.0 }), // too far
      sig(2, { categories: ['plumbing'] }), // wrong trade
      sig(3, { lat: null, lon: null, severity: 1 }), // state-level, too mild
      sig(4, { lat: null, lon: null, severity: 2 }), // state-level, ok
      sig(5, { lat: null, lon: null, severity: 3, state: 'AL' }), // other state
    ]);
    await backfillMatches(f.db, profile, NOW);
    expect(f.upserts[0].rows.map((r) => r.signal_id)).toEqual([4]);
    expect(f.upserts[0].rows[0].distance_mi).toBeNull();
  });

  it('does not write when nothing matches', async () => {
    const f = fakeDb([sig(1, { categories: ['plumbing'] })]);
    const r = await backfillMatches(f.db, profile, NOW);
    expect(r.matched).toBe(0);
    expect(f.upserts).toHaveLength(0);
  });

  it('never throws when the db errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const opts of [{ selectError: true }, { upsertError: true }, { throwOnFrom: true }]) {
      const f = fakeDb([sig(1)], opts);
      const r = await backfillMatches(f.db, profile, NOW);
      expect(r.matched).toBe(0);
      expect(r.error).toBeTruthy();
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
