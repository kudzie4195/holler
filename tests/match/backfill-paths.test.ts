// Round 7 MATCH item 1: a 14-day backfill inside the member's radius runs on signup (onboarding save) and on every profile change that
// alters trades, ZIP, radius, extra areas or keywords; it reaches new trades even when the feed already has rows; it is idempotent.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfillMatches, BACKFILL_CAP, BACKFILL_DAYS } from '@/lib/signals/backfill';
import { loadProfiles } from '@/lib/signals/store';
import { fakeSignalsDb } from '../fixtures/fake-signals-db';
import type { MatchProfile } from '@/lib/signals/match';

const NOW = new Date('2026-11-19T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const SMYRNA = { lat: 33.8796, lon: -84.5023 };

/** fakeSignalsDb plus a stateful holler_matches table (select with eq/in, upsert that ignores duplicates). */
function dbWithMatches(signals: any[], existing: { user_id: string; signal_id: number }[] = []) {
  const base = fakeSignalsDb(signals, { now: NOW });
  const matches = [...existing];
  const upserts: any[][] = [];
  const db: any = {
    rpc: (...a: any[]) => (base.rpc as any)(...a),
    from(table: string) {
      if (table !== 'holler_matches') return base.from(table);
      const f: ((r: any) => boolean)[] = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (f.push((r) => r[c] === v), q),
        in: (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), q),
        then: (res: any, rej: any) => Promise.resolve({ data: matches.filter((r) => f.every((x) => x(r))), error: null }).then(res, rej),
        upsert: (rows: any[]) => {
          upserts.push(rows);
          for (const r of rows) if (!matches.some((m) => m.user_id === r.user_id && m.signal_id === r.signal_id)) matches.push(r);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { db, matches, upserts };
}

const sig = (id: number, categories: string[], h: number) => ({ id, categories, lat: 33.95, lon: -84.4, state: 'GA', severity: 1, occurred_at: hoursAgo(h), expires_at: null });

describe('backfill when the feed already has rows (round 7 fix)', () => {
  const electrical = Array.from({ length: 30 }, (_, i) => sig(i + 1, ['electrical'], i + 1)); // newest
  const roofing = [sig(101, ['roofing'], 200), sig(102, ['roofing'], 210), sig(103, ['roofing'], 220)]; // older, inside 14 days
  const profile: MatchProfile = { user_id: 'u1', categories: ['electrical', 'roofing'], ...SMYRNA, state: 'GA', radius_mi: 25 };

  it('a member with 25 electrical matches who adds roofing gets the roofing rows (existing rows no longer use up the cap)', async () => {
    const existing = electrical.slice(0, 25).map((s) => ({ user_id: 'u1', signal_id: s.id }));
    const f = dbWithMatches([...electrical, ...roofing], existing);
    const r = await backfillMatches(f.db, profile, NOW);
    const sent = f.upserts[0].map((x) => x.signal_id);
    expect(sent).toEqual(expect.arrayContaining([101, 102, 103]));
    expect(sent.some((id: number) => id <= 25)).toBe(false); // nothing already in the feed is re-sent
    expect(r.matched).toBe(8); // 5 more electrical + 3 roofing
  });

  it('is idempotent: a second run finds nothing new and writes nothing', async () => {
    const f = dbWithMatches([...electrical, ...roofing]);
    await backfillMatches(f.db, profile, NOW);
    const after1 = f.matches.length;
    expect(after1).toBe(BACKFILL_CAP);
    const r2 = await backfillMatches(f.db, profile, NOW);
    // the 8 rows the first run left out are now picked, and a third run writes nothing at all
    expect(f.matches.length).toBe(33);
    expect(r2.matched).toBe(8);
    const r3 = await backfillMatches(f.db, profile, NOW);
    expect(r3.matched).toBe(0);
    expect(f.matches.length).toBe(33);
    expect(new Set(f.matches.map((m) => m.signal_id)).size).toBe(33);
  });

  it('reads 14 days inside the radius only', async () => {
    const f = dbWithMatches([sig(1, ['roofing'], 24 * (BACKFILL_DAYS + 1)), { ...sig(2, ['roofing'], 5), lat: 34.6, lon: -84.5 }, sig(3, ['roofing'], 5)]);
    await backfillMatches(f.db, { ...profile, categories: ['roofing'] }, NOW);
    expect(f.upserts[0].map((x) => x.signal_id)).toEqual([3]);
  });

  it('a failed read of existing matches falls back to the old behaviour (fail soft)', async () => {
    const f = dbWithMatches([sig(1, ['roofing'], 5)]);
    const from = f.db.from.bind(f.db);
    f.db.from = (t: string) => {
      const q = from(t);
      if (t === 'holler_matches') q.then = (res: any) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res);
      return q;
    };
    const r = await backfillMatches(f.db, { ...profile, categories: ['roofing'] }, NOW);
    expect(r.matched).toBe(1);
  });
});

// ---- the paths that call it ----------------------------------------------------------------------------------------------------
const h = vi.hoisted(() => ({ afterCbs: [] as (() => Promise<void> | void)[], backfill: vi.fn<(id: string) => Promise<{ ran: true; result: { matched: number; considered: number } }>>(async () => ({ ran: true, result: { matched: 0, considered: 0 } })), order: [] as string[] }));

afterEach(() => {
  vi.doUnmock('next/server');
  vi.doUnmock('next/navigation');
});

async function loadSettings(before: Record<string, unknown> | null) {
  vi.resetModules();
  vi.doMock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
  vi.doMock('next/server', () => ({ after: (cb: () => void) => h.afterCbs.push(cb) }));
  vi.doMock('@/lib/stripe', () => ({ getStripe: () => null, isHollerMetadata: () => false }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
  vi.doMock('@/lib/auth/trial', () => ({ applyTrialRules: async () => 'first' }));
  vi.doMock('@/lib/auth/session', () => ({ getUser: async () => ({ id: 'u1' }), getProfile: async () => before }));
  vi.doMock('@/lib/auth/profile', () => ({ saveProfile: async () => ({ ok: true, message: 'Saved.' }) }));
  vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: h.backfill }));
  return (await import('../../app/app/settings/actions')).saveSettings;
}

const SAVED = {
  categories: ['roofing'],
  zip: '30080',
  radius_mi: 25,
  extra_areas: [{ zip: '30060', city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55 }],
  keywords: ['hail'],
  created_at: hoursAgo(48),
};
function form(over: Partial<Record<string, string | string[]>> = {}) {
  const v: Record<string, string | string[]> = { categories: ['roofing'], zip: '30080', radius: '25', extra_zip: ['30060'], keyword: ['hail'], ...over };
  const fd = new FormData();
  for (const [k, val] of Object.entries(v)) for (const x of Array.isArray(val) ? val : [val]) fd.append(k, x);
  return fd;
}

describe('settings: every targeting change schedules the backfill, nothing else does', () => {
  const cases: [string, FormData, boolean][] = [
    ['nothing changed', form(), false],
    ['a trade added', form({ categories: ['roofing', 'tree-service'] }), true],
    ['a trade swapped', form({ categories: ['plumbing'] }), true],
    ['ZIP changed', form({ zip: '30339' }), true],
    ['radius changed', form({ radius: '50' }), true],
    ['extra area added (Pro)', form({ extra_zip: ['30060', '30062'] }), true],
    ['extra area replaced (Pro)', form({ extra_zip: ['30062'] }), true],
    ['keyword added (Pro)', form({ keyword: ['hail', 'roof leak'] }), true],
    ['trades reordered only', form({ categories: ['roofing'] }), false],
  ];
  for (const [name, fd, expected] of cases) {
    it(`${name}: ${expected ? 'backfill scheduled' : 'no backfill'}`, async () => {
      h.afterCbs.length = 0;
      h.backfill.mockClear();
      const save = await loadSettings(SAVED);
      expect(await save({}, fd)).toEqual({ ok: true, message: 'Saved.' });
      expect(h.afterCbs).toHaveLength(expected ? 1 : 0);
      for (const cb of h.afterCbs) await cb();
      expect(h.backfill).toHaveBeenCalledTimes(expected ? 1 : 0);
      if (expected) expect(h.backfill).toHaveBeenCalledWith('u1');
    });
  }

  it('a first save with no profile (no onboarding) backfills too', async () => {
    h.afterCbs.length = 0;
    h.backfill.mockClear();
    const save = await loadSettings(null);
    await save({}, form());
    expect(h.afterCbs).toHaveLength(1);
  });
});

describe('signup: onboarding save runs the backfill before the first screen', () => {
  async function loadOnboarding(saveOk: boolean, pending = false) {
    h.order.length = 0;
    h.backfill.mockClear();
    vi.resetModules();
    vi.doMock('next/navigation', () => ({ redirect: (to: string) => { h.order.push(`redirect:${to}`); throw new Error('redirect'); } }));
    vi.doMock('@/lib/auth/session', () => ({ getUser: async () => ({ id: 'new-user', app_metadata: pending ? { holler_email_verified_at: hoursAgo(1) } : {} }) }));
    vi.doMock('@/lib/auth/profile', () => ({ saveProfile: async () => (h.order.push('save'), saveOk ? { ok: true } : { error: 'bad' }) }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
    vi.doMock('@/lib/auth/trial', () => ({ applyTrialRules: async () => (h.order.push('trial'), 'first') }));
    vi.doMock('@/lib/auth/verification', () => ({ applyPendingVerification: async () => { h.order.push('verify'); } }));
    // ANALYTICS records the signup in the same action (round 7); it is not part of this test.
    vi.doMock('@/lib/analytics/request', () => ({ recordSignup: async () => {} }));
    vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: async (id: string) => (h.order.push(`backfill:${id}`), h.backfill(id)) }));
    return (await import('../../app/onboarding/actions')).completeOnboarding;
  }

  it('save, trial, backfill (awaited), then the pending email confirmation, then the redirect', async () => {
    const go = await loadOnboarding(true, true);
    await expect(go({}, new FormData())).rejects.toThrow('redirect');
    expect(h.order).toEqual(['save', 'trial', 'backfill:new-user', 'verify', 'redirect:/onboarding/preview']);
    expect(h.backfill).toHaveBeenCalledTimes(1);
  });

  it('a failed save never backfills', async () => {
    const go = await loadOnboarding(false);
    expect(await go({}, new FormData())).toEqual({ error: 'bad' });
    expect(h.backfill).not.toHaveBeenCalled();
  });
});

describe('email verification does not gate matching', () => {
  it('loadProfiles reads and filters nothing about email verification, so matches exist before the email is confirmed', async () => {
    const calls: string[] = [];
    const db: any = {
      from: () => {
        const q: any = {
          select: (cols: string) => (calls.push(`select:${cols}`), q),
          neq: (c: string, v: string) => (calls.push(`neq:${c}=${v}`), q),
          order: () => q,
          // readAllPages reads until an empty page (verify-v1 finding 12): the second page is empty
          range: (a: number) => Promise.resolve({ data: a > 0 ? [] : [{ user_id: 'u1', categories: ['roofing'], lat: 1, lon: 1, state: 'GA', radius_mi: 25, subscription_status: 'trialing', trial_ends_at: hoursAgo(-48), email_verified_at: null }], error: null }),
        };
        return q;
      },
    };
    const p = await loadProfiles(db, NOW);
    expect(p.map((x) => x.user_id)).toEqual(['u1']);
    expect(calls.join(' ')).not.toMatch(/email_verified/);
  });
});
