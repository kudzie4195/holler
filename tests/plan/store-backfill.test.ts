// loadProfiles reads the plan columns; backfill covers every allowed area and keyword watch. Fakes are hand-written (assumed PostgREST
// behaviour); the RPC double is tests/fixtures/fake-signals-db.ts, which mirrors holler_signals_near from migration 0003.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { loadProfiles, PROFILE_MATCH_COLUMNS, type Db } from '@/lib/signals/store';
import { backfillMatches, keywordOrFilter } from '@/lib/signals/backfill';
import { fakeSignalsDb } from '../fixtures/fake-signals-db';
import type { MatchProfile } from '@/lib/signals/match';

const NOW = new Date('2026-11-17T12:00:00Z');

function profilesDb(rows: any[], failColumns?: RegExp, message = 'column holler_profiles.plan does not exist') {
  const selects: string[] = [];
  const db = {
    from: () => {
      let cols = '';
      const q: any = {
        // one entry per read (its first page): readAllPages also asks for a final empty page (verify-v1 decision 6)
        select: (c: string) => ((cols = c), q),
        neq: () => q,
        order: () => q,
        // readAllPages reads until an empty page (verify-v1 decision 6): rows on the first page only
        range: (a: number) =>
          (a === 0 && selects.push(cols), Promise.resolve(
            failColumns && failColumns.test(cols)
              ? { data: null, error: { message } }
              : { data: a > 0 ? [] : rows, error: null },
          )),
      };
      return q;
    },
  };
  return { db: db as unknown as Db, selects };
}

describe('loadProfiles', () => {
  const row = { user_id: 'u1', categories: ['roofing'], lat: 1, lon: 1, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: null, plan: 'pro', extra_areas: [], keywords: ['tree removal'] };
  it('selects plan, extra_areas and keywords so matching can apply the plan', async () => {
    const f = profilesDb([row]);
    const got = await loadProfiles(f.db, NOW);
    // Round 7 integrate3 (review r2 F7): the first read also asks for the 0020 store columns, so a lapsed store plan is judged.
    expect(f.selects[0]).toBe(`${PROFILE_MATCH_COLUMNS}, plan_source, store_expires_at`);
    expect(f.selects).toHaveLength(1);
    for (const c of ['plan', 'extra_areas', 'keywords', 'subscription_status']) expect(PROFILE_MATCH_COLUMNS).toContain(c);
    expect(got[0]).toMatchObject({ plan: 'pro', keywords: ['tree removal'] });
  });
  it('a database without 0020 retries without the store columns and keeps the plan columns (not the legacy read)', async () => {
    const f = profilesDb([row], /plan_source/, 'column holler_profiles.plan_source does not exist');
    const got = await loadProfiles(f.db, NOW);
    expect(f.selects).toEqual([`${PROFILE_MATCH_COLUMNS}, plan_source, store_expires_at`, PROFILE_MATCH_COLUMNS]);
    expect(got[0]).toMatchObject({ plan: 'pro', keywords: ['tree removal'] });
    // PostgREST's wording for a missing column is handled the same way.
    const g = profilesDb([row], /store_expires_at/, "Could not find the 'store_expires_at' column of 'holler_profiles' in the schema cache");
    await loadProfiles(g.db, NOW);
    expect(g.selects[1]).toBe(PROFILE_MATCH_COLUMNS);
  });
  it('a store plan that lapsed (or has no expiry) is not matched once the trial is over; a live one is', async () => {
    const past = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    const store = { ...row, trial_ends_at: past, plan_source: 'apple' };
    const f = profilesDb([
      { ...store, user_id: 'live', store_expires_at: new Date(NOW.getTime() + 20 * 86_400_000).toISOString() },
      { ...store, user_id: 'lapsed', store_expires_at: new Date(NOW.getTime() - 10 * 86_400_000).toISOString() },
      { ...store, user_id: 'no-expiry', store_expires_at: null },
      { ...row, user_id: 'stripe', trial_ends_at: past, plan_source: 'stripe', store_expires_at: null },
    ]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await loadProfiles(f.db, NOW)).map((p) => p.user_id)).toEqual(['live', 'stripe']);
    vi.restoreAllMocks();
  });
  it('falls back to the old columns (Solo limits) when migration 0004 is not applied yet', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = profilesDb([{ ...row, plan: undefined, keywords: undefined }], /plan/);
    const got = await loadProfiles(f.db, NOW);
    expect(f.selects).toHaveLength(2);
    expect(f.selects[1]).not.toContain('plan');
    expect(got).toHaveLength(1);
    spy.mockRestore();
  });
});

describe('backfill covers every allowed area', () => {
  const ATHENS = { zip: '30601', city: 'Athens', state: 'GA', lat: 33.96, lon: -83.38 };
  const MACON = { zip: '31201', city: 'Macon', state: 'GA', lat: 32.84, lon: -83.63 };
  const sig = (id: number, lat: number, lon: number, over: Record<string, any> = {}) => ({
    id, categories: ['roofing'], lat, lon, state: 'GA', severity: 1, occurred_at: new Date(NOW.getTime() - id * 3600e3).toISOString(), expires_at: null, title: `t${id}`, summary: null, ...over,
  });
  const signals = [sig(1, 33.75, -84.39), sig(2, 33.95, -83.39), sig(3, 32.85, -83.62)];
  const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({ user_id: 'u1', categories: ['roofing'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25, ...over });
  const withUpserts = (base: ReturnType<typeof fakeSignalsDb>) => {
    const upserts: any[] = [];
    const db = { rpc: base.rpc, from: (t: string) => (t === 'holler_matches' ? { upsert: (rows: any[]) => (upserts.push(...rows), Promise.resolve({ error: null })) } : base.from(t)) };
    return { db: db as never, upserts };
  };

  it('pro with 2 extra areas: reads near each area and matches records near Athens and Macon too', async () => {
    const base = fakeSignalsDb(signals as never, { now: NOW });
    const f = withUpserts(base);
    const r = await backfillMatches(f.db, profile({ plan: 'pro', subscription_status: 'active', extra_areas: [ATHENS, MACON] }), NOW);
    expect(r.error).toBeUndefined();
    const centres = new Set(base.log.filter((l) => l.kind === 'rpc').map((l) => `${l.args!.p_lat},${l.args!.p_lon}`));
    expect(centres).toEqual(new Set(['33.749,-84.388', '33.96,-83.38', '32.84,-83.63']));
    expect(f.upserts.map((u) => u.signal_id).sort()).toEqual([1, 2, 3]);
  });

  it('starter with saved extras reads only the main area', async () => {
    const base = fakeSignalsDb(signals as never, { now: NOW });
    const f = withUpserts(base);
    await backfillMatches(f.db, profile({ plan: 'pro', subscription_status: 'canceled', extra_areas: [ATHENS, MACON], keywords: ['roof'] }), NOW);
    const centres = new Set(base.log.filter((l) => l.kind === 'rpc').map((l) => `${l.args!.p_lat},${l.args!.p_lon}`));
    expect(centres).toEqual(new Set(['33.749,-84.388']));
    expect(f.upserts.map((u) => u.signal_id)).toEqual([1]);
  });

  it('keyword watches read records outside the trades and match by phrase', async () => {
    const kw = [sig(10, 33.76, -84.4, { categories: ['landscaping'], title: 'Tree removal permit' }), sig(11, 33.76, -84.4, { categories: ['landscaping'], title: 'Street removal' })];
    const reads: string[] = [];
    const base = fakeSignalsDb([...signals, ...kw] as never, { now: NOW });
    const db = {
      rpc: base.rpc,
      from: (t: string) => {
        if (t === 'holler_matches') return { upsert: (rows: any[]) => ((upserts.push(...rows)), Promise.resolve({ error: null })) };
        // The fake has no ilike: answer the keyword read with every row in the box; matchOne applies the phrase rule.
        const q: any = { select: () => q, gte: () => q, lte: () => q, is: () => q, eq: () => q, overlaps: () => q, order: () => q, limit: () => Promise.resolve({ data: [...signals, ...kw], error: null }), or: (s: string) => (reads.push(s), q) };
        return q;
      },
    };
    const upserts: any[] = [];
    await backfillMatches(db as never, profile({ plan: 'pro', subscription_status: 'active', keywords: ['tree removal'] }), NOW);
    expect(reads.some((s) => s === 'title.ilike."*tree removal*",summary.ilike."*tree removal*"')).toBe(true);
    expect(upserts.map((u) => u.signal_id).sort((a, b) => a - b)).toEqual([1, 10]);
  });

  it('keywordOrFilter quotes values and strips characters that would break the filter', () => {
    expect(keywordOrFilter(['a,b (c)', 'x"y'])).toBe('title.ilike."*a b  c*",summary.ilike."*a b  c*",title.ilike."*x y*",summary.ilike."*x y*"');
  });
});
