import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { createStore, isMissingTable, NotMigrated } from '@/lib/lifecycle/store';
import { missedSince, MISSED_ROW_CAP } from '@/lib/lifecycle/missed';
import { queryRanges } from '@/lib/lifecycle/select';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

const U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const V = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const mk = (db: FakeDb) => createStore(db as never);

describe('ledger: claim, release, opt-out', () => {
  it('claim inserts once; the second claim of the same kind finds it and inserts nothing', async () => {
    const db = new FakeDb({ holler_lifecycle_sends: [] });
    const s = mk(db);
    expect(await s.claim(U, 'welcome')).toBe('claimed');
    expect(await s.claim(U, 'welcome')).toBe('exists');
    expect(await s.claim(U, 'trial_ending')).toBe('claimed');
    expect(await s.claim(V, 'welcome')).toBe('claimed');
    expect(db.tables.holler_lifecycle_sends.map((r) => `${r.user_id}:${r.kind}`).sort()).toEqual([`${U}:welcome`, `${U}:trial_ending`, `${V}:welcome`].sort());
  });

  it('claim races: many at once, one winner', async () => {
    const db = new FakeDb({ holler_lifecycle_sends: [] });
    const s = mk(db);
    const results = await Promise.all(Array.from({ length: 10 }, () => s.claim(U, 'trial_ended')));
    expect(results.filter((r) => r === 'claimed')).toHaveLength(1);
    expect(db.tables.holler_lifecycle_sends).toHaveLength(1);
  });

  it('uses INSERT ... ON CONFLICT DO NOTHING on the primary key (ignoreDuplicates, onConflict user_id,kind)', async () => {
    const seen: unknown[] = [];
    const db = {
      from: () => ({
        upsert: (rows: unknown, o: unknown) => {
          seen.push([rows, o]);
          return { select: async () => ({ data: [{ user_id: U }], error: null }) };
        },
      }),
    };
    await createStore(db as never).claim(U, 'welcome');
    expect(seen).toEqual([[[{ user_id: U, kind: 'welcome' }], { onConflict: 'user_id,kind', ignoreDuplicates: true }]]);
  });

  it('release deletes only that row', async () => {
    const db = new FakeDb({ holler_lifecycle_sends: [{ user_id: U, kind: 'welcome' }, { user_id: U, kind: 'trial_ending' }, { user_id: V, kind: 'welcome' }] });
    await mk(db).release(U, 'welcome');
    expect(db.tables.holler_lifecycle_sends.map((r) => `${r.user_id}:${r.kind}`).sort()).toEqual([`${U}:trial_ending`, `${V}:welcome`].sort());
  });

  it('isOptedOut is true only for an optout row of that member', async () => {
    const db = new FakeDb({ holler_lifecycle_sends: [{ user_id: U, kind: 'optout' }, { user_id: V, kind: 'welcome' }] });
    const s = mk(db);
    expect(await s.isOptedOut(U)).toBe(true);
    expect(await s.isOptedOut(V)).toBe(false);
  });

  it('a missing table is NotMigrated, from the claim and from the sends read; other errors throw plainly', async () => {
    const db = new FakeDb({ holler_lifecycle_sends: [] });
    db.failOn['holler_lifecycle_sends.upsert'] = 'relation "public.holler_lifecycle_sends" does not exist';
    await expect(mk(db).claim(U, 'welcome')).rejects.toBeInstanceOf(NotMigrated);
    db.failOn['holler_lifecycle_sends.select'] = 'Could not find the table \'public.holler_lifecycle_sends\' in the schema cache';
    await expect(mk(db).loadSends([U])).rejects.toBeInstanceOf(NotMigrated);
    db.failOn['holler_lifecycle_sends.select'] = 'connection reset';
    await expect(mk(db).loadSends([U])).rejects.not.toBeInstanceOf(NotMigrated);
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ message: 'relation "other_table" does not exist' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });

  it('loadSends reads in chunks and returns every row', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const db = new FakeDb({ holler_lifecycle_sends: ids.map((id) => ({ user_id: id, kind: 'welcome' })) });
    const rows = await mk(db).loadSends(ids);
    expect(rows).toHaveLength(450);
    expect(db.calls.filter((c) => c === 'holler_lifecycle_sends.select')).toHaveLength(3);
  });
});

describe('matchesOf', () => {
  const sig = (id: number, over: Record<string, unknown> = {}) => ({ id, source: 'nws', kind: 'alert', title: `T${id}`, city: 'Atlanta', state: 'GA', severity: 2, occurred_at: `2026-11-${10 + id}T00:00:00Z`, subtype: null, ...over });
  it('returns real matches newest first, without resident requests, asks, dismissed rows or blank titles', async () => {
    const db = new FakeDb({
      holler_matches: [
        { id: 1, user_id: U, status: 'new', created_at: '2026-11-11T00:00:00Z', signal: sig(1) },
        { id: 2, user_id: U, status: 'saved', created_at: '2026-11-12T00:00:00Z', signal: sig(2) },
        { id: 3, user_id: U, status: 'dismissed', created_at: '2026-11-13T00:00:00Z', signal: sig(3) },
        { id: 4, user_id: U, status: 'new', created_at: '2026-11-14T00:00:00Z', signal: sig(4, { source: 'holler-request', kind: 'ask' }) },
        { id: 5, user_id: U, status: 'new', created_at: '2026-11-15T00:00:00Z', signal: sig(5, { title: '   ' }) },
        { id: 6, user_id: U, status: 'new', created_at: '2026-11-16T00:00:00Z', signal: [sig(6)] },
        { id: 7, user_id: U, status: 'new', created_at: '2026-11-17T00:00:00Z', signal: null },
        { id: 8, user_id: V, status: 'new', created_at: '2026-11-18T00:00:00Z', signal: sig(8) },
        { id: 9, user_id: U, status: 'new', created_at: '2026-11-18T00:00:00Z', signal: sig(9, { kind: 'ask' }) },
      ],
    });
    const r = await mk(db).matchesOf(U);
    expect(r.items.map((i) => i.title)).toEqual(['T6', 'T2', 'T1']);
    expect(r.total).toBe(3);
    expect(r.capped).toBe(false);
    expect(r.items[0]).toMatchObject({ id: 6, city: 'Atlanta', state: 'GA', kind: 'alert', source: 'nws', severity: 2, occurredAt: '2026-11-16T00:00:00Z' });
  });
  it('a read error throws (the cron then sends nothing for that member)', async () => {
    const db = new FakeDb({ holler_matches: [] });
    db.failOn['holler_matches.select'] = 'boom';
    await expect(mk(db).matchesOf(U)).rejects.toThrow('matches: boom');
  });
});

describe('loadProfiles', () => {
  it('asks for exactly the three windows and nothing else', async () => {
    const calls: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'or', 'order', 'limit']) chain[m] = (...a: unknown[]) => (calls.push(`${m}:${a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('|')}`), chain);
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: [{ user_id: U }], error: null }));
    const now = new Date('2026-11-19T12:00:00Z');
    const rows = await createStore({ from: () => chain } as never).loadProfiles(now);
    expect(rows).toEqual([{ user_id: U }]);
    const r = queryRanges(now);
    const or = calls.find((c) => c.startsWith('or:')) ?? '';
    for (const range of [r.created, r.endsSoon, r.endedRecently]) {
      expect(or).toContain(`gte.${range.gte}`);
      expect(or).toContain(`lte.${range.lte}`);
    }
    expect(or).toContain('created_at.gte');
    expect(or.match(/trial_ends_at\.gte/g)).toHaveLength(2);
    expect(calls.find((c) => c.startsWith('limit:'))).toBe('limit:1000');
    expect(calls.find((c) => c.startsWith('select:'))).not.toMatch(/stripe_customer|last_notified/);
  });
});

describe('missedSince (day 8 count)', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const since = new Date('2026-11-17T06:00:00Z');
  const base = { categories: ['roofing'] as string[] | null, lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25, plan: null, subscription_status: 'trialing', extra_areas: null, keywords: null };
  type Row = Record<string, unknown>;
  const row = (id: number, over: Row = {}): Row => ({ id, source: 'spc', kind: 'report', state: 'GA', lat: 33.75, lon: -84.39, categories: ['roofing'], severity: 2, occurred_at: '2026-11-18T10:00:00Z', subtype: null, ...over });
  function stub(a: Row[], b: Row[] = [], err?: string, c: Row[] = []): { db: never; filters: string[] } {
    const filters: string[] = [];
    const db = {
      from: () => {
        const q: string[] = [];
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'neq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'not', 'is', 'or', 'in']) chain[m] = (...args: unknown[]) => (q.push(`${m}:${args.map(String).join(',')}`), chain);
        chain.then = (res: (v: unknown) => unknown) => {
          filters.push(...q);
          const isB = q.some((f) => f.startsWith('is:lat'));
          // The approximate-location (Cobb County) query filters with in('source', ...).
          const isC = q.some((f) => f.startsWith('in:source,'));
          return Promise.resolve(res(err ? { data: null, error: { message: err } } : { data: isC ? c : isB ? b : a, error: null }));
        };
        return chain;
      },
    };
    return { db: db as never, filters };
  }

  it('counts matching rows exactly, never counting a row twice', async () => {
    const { db, filters } = stub([row(1), row(2), row(3, { categories: ['plumbing'] }), row(2)], [row(4, { lat: null, lon: null, severity: 2 }), row(5, { lat: null, lon: null, severity: 1 })]);
    const r = await missedSince(db, base, since, now);
    expect(r).toEqual({ count: 3, capped: false }); // 1, 2 and 4 (3 is another trade, 5 is state-level at severity 1)
    expect(filters).toContain(`gte:occurred_at,${since.toISOString()}`);
    expect(filters).toContain(`lte:occurred_at,${now.toISOString()}`);
    expect(filters).toContain('neq:source,holler-request');
    expect(filters).toContain('neq:kind,ask');
  });

  // Round 7 (review r1 P1-6 follow-up): Cobb County rows sit at a stand-in point; the scanner matches them within radius + 15 miles.
  it('counts a Cobb County row 20 miles from its stand-in for a 10-mile member, as the scanner does', async () => {
    const COBB = { lat: 33.95, lon: -84.55 };
    const member = { ...base, lat: COBB.lat - 20 / 69.09, lon: COBB.lon, radius_mi: 10 };
    const cobb = row(7, { source: 'arcgis-cobb-commercial-permits', kind: 'permit', subtype: 'permit', ...COBB });
    const { db, filters } = stub([], [], undefined, [cobb]);
    expect(await missedSince(db, member, since, now)).toEqual({ count: 1, capped: false });
    expect(filters).toContain('in:source,arcgis-cobb-residential-permits,arcgis-cobb-commercial-permits,arcgis-cobb-multiunit-permits');
    // 30 miles out is past radius + 15; a non-Cobb row 20 miles out is past the radius.
    expect((await missedSince(stub([], [], undefined, [cobb]).db, { ...member, lat: COBB.lat - 30 / 69.09 }, since, now)).count).toBe(0);
    expect((await missedSince(stub([row(8, { ...COBB })]).db, member, since, now)).count).toBe(0);
    // Returned by both queries, counted once.
    expect((await missedSince(stub([cobb], [], undefined, [cobb]).db, { ...base, ...COBB, radius_mi: 10 }, since, now)).count).toBe(1);
  });

  it('a row far outside the radius is not counted (same matcher as the scan)', async () => {
    const { db } = stub([row(1), row(2, { lat: 40.7, lon: -74 })]);
    expect((await missedSince(db, base, since, now)).count).toBe(1);
  });

  it('final review r17 P2-3: a follower (a second listing of a project) is not counted; the first record of its project is', async () => {
    const { db, filters } = stub([row(1), row(2, { projectOf: 'spc:1' })]);
    expect((await missedSince(db, base, since, now)).count).toBe(1);
    expect(filters.find((f) => f.startsWith('select:'))).toContain('projectOf:data->>projectOf');
  });

  it('never counts resident requests or asks even if the query returned them', async () => {
    const { db } = stub([row(1, { source: 'holler-request' }), row(2, { kind: 'ask' }), row(3)]);
    expect((await missedSince(db, base, since, now)).count).toBe(1);
  });

  it('zero is zero; no trades or no area is zero without a query', async () => {
    expect(await missedSince(stub([]).db, base, since, now)).toEqual({ count: 0, capped: false });
    const boom = stub([row(1)], [], 'should not be asked');
    expect(await missedSince(boom.db, { ...base, categories: [] }, since, now)).toEqual({ count: 0, capped: false });
    expect(await missedSince(boom.db, { ...base, lat: null, lon: null }, since, now)).toEqual({ count: 0, capped: false });
    expect(boom.filters).toEqual([]);
  });

  it('a full page means the count is a floor', async () => {
    const rows = Array.from({ length: MISSED_ROW_CAP }, (_, i) => row(i + 1));
    expect((await missedSince(stub(rows).db, base, since, now)).capped).toBe(true);
  });

  it('a query error throws instead of returning a made-up number', async () => {
    await expect(missedSince(stub([], [], 'down').db, base, since, now)).rejects.toThrow('down');
  });

  it('the store counts from the trial end', async () => {
    const { db, filters } = stub([row(1)]);
    const s = createStore(db);
    const r = await s.missedSince({ user_id: U, trial_ends_at: since.toISOString(), ...base, business_name: 'x', created_at: null, email_verified_at: null, subscription_status: 'trialing' }, now);
    expect(r.count).toBe(1);
    expect(filters).toContain(`gte:occurred_at,${since.toISOString()}`);
    await expect(s.missedSince({ user_id: U, trial_ends_at: null, ...base, business_name: 'x', created_at: null, email_verified_at: null, subscription_status: 'trialing' }, now)).rejects.toThrow();
  });
});

describe('quietPreview (day 1 with no matches)', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const profile = { user_id: U, business_name: 'x', created_at: null, email_verified_at: null, subscription_status: 'trialing', trial_ends_at: null, categories: ['roofing'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 };
  const row = (id: number, over: Record<string, unknown> = {}) => ({ id, source: 'spc', kind: 'report', title: 'Hail', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39, categories: ['roofing'], severity: 2, occurred_at: '2026-11-10T00:00:00Z', subtype: null, ...over });
  function stub(a: unknown[], err?: string) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'neq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'not', 'is', 'or', 'in']) chain[m] = () => chain;
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(res(err ? { data: null, error: { message: err } } : { data: a, error: null }));
    return { from: () => chain } as never;
  }
  it('gives labelled real counts from the 90-day preview', async () => {
    const q = await createStore(stub([row(1), row(2), row(3, { kind: 'permit', subtype: 'permit', source: 'x' })])).quietPreview(profile, now);
    // Round 18 ES: each line also carries its record type, so a Spanish email can name it in Spanish.
    expect(q).toEqual({ lines: [{ label: 'storm reports', count: 2, key: 'storm-report' }, { label: 'building permit', count: 1, key: 'permit' }], total: 3, capped: false, days: 90 });
  });
  it('is null when nothing matched (so day 1 is not sent), and null when the records cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await createStore(stub([])).quietPreview(profile, now)).toBeNull();
    expect(await createStore(stub([], 'down')).quietPreview(profile, now)).toBeNull();
    expect(await createStore(stub([row(1)])).quietPreview({ ...profile, categories: [] }, now)).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('emailOf and trialStartedAt (one auth read per member)', () => {
  const mk = (user: unknown, error: unknown = null) => {
    const calls: string[] = [];
    const db = { from: () => ({}), auth: { admin: { getUserById: async (id: string) => (calls.push(id), { data: { user }, error }) } } };
    return { db: db as unknown as Parameters<typeof createStore>[0], calls };
  };
  it('reads the email and the trial stamp from the same auth read', async () => {
    const { db, calls } = mk({ email: 'a@x.test', app_metadata: { holler_trial_started_at: '2026-10-01T00:00:00.000Z' } });
    const s = createStore(db);
    expect(await s.emailOf(U)).toBe('a@x.test');
    expect(await s.trialStartedAt?.(U)).toBe('2026-10-01T00:00:00.000Z');
    expect(calls).toEqual([U]);
  });
  it('no stamp, a bad stamp, or a read error is null', async () => {
    expect(await createStore(mk({ email: 'a@x.test', app_metadata: {} }).db).trialStartedAt?.(U)).toBeNull();
    expect(await createStore(mk({ email: 'a@x.test', app_metadata: { holler_trial_started_at: 'nope' } }).db).trialStartedAt?.(U)).toBeNull();
    const bad = createStore(mk(null, { message: 'down' }).db);
    expect(await bad.trialStartedAt?.(U)).toBeNull();
    expect(await bad.emailOf(U)).toBeNull();
  });
});
