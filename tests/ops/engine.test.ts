// Engine robustness (U4). Uses an in-memory fake of the Supabase query builder (tests/ops/fakedb.ts) that caps selects at 1000
// rows like PostgREST. All rows are hand-written (assumed); column names come from supabase/migrations/0001_holler.sql.
import { describe, expect, it } from 'vitest';
import { FakeDb } from './fakedb';
import { canSeeAlerts, getLastRunTimes, loadProfiles, readAllPages, type Db } from '../../lib/signals/store';
import { runScan } from '../../lib/signals/run';
import type { Adapter, SignalInput } from '../../lib/signals/types';

const NOW = new Date('2026-11-17T12:00:00Z');
const asDb = (f: FakeDb) => f as unknown as Db;
const future = '2026-11-20T00:00:00Z';
const past = '2026-11-10T00:00:00Z';

const profile = (i: number, over: Record<string, unknown> = {}) => ({
  user_id: `u${String(i).padStart(6, '0')}`,
  categories: ['roofing'],
  lat: 33.75,
  lon: -84.39,
  state: 'GA',
  radius_mi: 25,
  subscription_status: 'active',
  trial_ends_at: past,
  ...over,
});

describe('canSeeAlerts (F-11)', () => {
  const now = NOW.getTime();
  it('active and past_due always, canceled never', () => {
    expect(canSeeAlerts({ subscription_status: 'active', trial_ends_at: past }, now)).toBe(true);
    expect(canSeeAlerts({ subscription_status: 'past_due', trial_ends_at: past }, now)).toBe(true);
    expect(canSeeAlerts({ subscription_status: 'canceled', trial_ends_at: future }, now)).toBe(false);
  });
  it('trialing only inside the trial', () => {
    expect(canSeeAlerts({ subscription_status: 'trialing', trial_ends_at: future }, now)).toBe(true);
    expect(canSeeAlerts({ subscription_status: 'trialing', trial_ends_at: past }, now)).toBe(false);
    expect(canSeeAlerts({ subscription_status: 'trialing', trial_ends_at: null }, now)).toBe(false);
    expect(canSeeAlerts({ subscription_status: 'trialing', trial_ends_at: 'garbage' }, now)).toBe(false);
  });
  it('an unknown status is treated like trialing, as lib/auth/access.ts does', () => {
    expect(canSeeAlerts({ subscription_status: 'weird', trial_ends_at: future }, now)).toBe(true);
    expect(canSeeAlerts({ subscription_status: 'weird', trial_ends_at: past }, now)).toBe(false);
  });
});

describe('readAllPages', () => {
  it('stops on a short page, throws on an error, and stops at maxPages', async () => {
    const f = new FakeDb({ t: Array.from({ length: 2300 }, (_, i) => ({ id: i + 1 })) });
    const all = await readAllPages<{ id: number }>((a, b) => f.from('t').select('id').order('id').range(a, b));
    expect(all).toHaveLength(2300);
    expect(new Set(all.map((r) => r.id)).size).toBe(2300);
    const capped = await readAllPages((a, b) => f.from('t').select('id').order('id').range(a, b), 2);
    expect(capped).toHaveLength(2000);
    f.failOn['t.select'] = 'boom';
    await expect(readAllPages((a, b) => f.from('t').select('id').range(a, b))).rejects.toThrow('boom');
  });
});

describe('loadProfiles', () => {
  it('pages past the 1000 row API cap', async () => {
    const f = new FakeDb({ holler_profiles: Array.from({ length: 2500 }, (_, i) => profile(i)) });
    const got = await loadProfiles(asDb(f), NOW);
    expect(got).toHaveLength(2500);
    expect(new Set(got.map((p) => p.user_id)).size).toBe(2500);
    expect(f.calls.filter((c) => c === 'holler_profiles.select')).toHaveLength(3);
  });

  it('skips canceled, expired trials and profiles with no categories; keeps active, past_due and live trials', async () => {
    const rows = [
      profile(1),
      profile(2, { subscription_status: 'past_due' }),
      profile(3, { subscription_status: 'trialing', trial_ends_at: future }),
      profile(4, { subscription_status: 'trialing', trial_ends_at: past }),
      profile(5, { subscription_status: 'canceled', trial_ends_at: future }),
      profile(6, { categories: [] }),
    ];
    const got = await loadProfiles(asDb(new FakeDb({ holler_profiles: rows })), NOW);
    expect(got.map((p) => p.user_id)).toEqual(['u000001', 'u000002', 'u000003']);
  });

  it('wraps a read error with context', async () => {
    const f = new FakeDb();
    f.failOn['holler_profiles.select'] = 'permission denied';
    await expect(loadProfiles(asDb(f), NOW)).rejects.toThrow(/profiles read failed: permission denied/);
  });
});

describe('getLastRunTimes', () => {
  it('still finds a slow source whose last run is beyond the first 1000 rows', async () => {
    const rows: Record<string, unknown>[] = [];
    // 1500 recent fast-source rows, then one old row for the slow source
    for (let i = 0; i < 1500; i++) rows.push({ id: i + 1, source: 'nws', started_at: new Date(Date.now() - i * 60_000).toISOString() });
    rows.push({ id: 9999, source: 'usaspending', started_at: new Date(Date.now() - 20 * 3600_000).toISOString() });
    const got = await getLastRunTimes(asDb(new FakeDb({ holler_scan_runs: rows })));
    expect(Object.keys(got).sort()).toEqual(['nws', 'usaspending']);
  });
});

const sig = (over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake',
  externalId: 'a',
  kind: 'alert',
  title: 'Hail near Marietta',
  categories: ['roofing'],
  severity: 2,
  occurredAt: '2026-11-17T11:00:00Z',
  lat: 33.953,
  lon: -84.55,
  ...over,
});
const adapter = (over: Partial<Adapter> = {}): Adapter => ({
  id: 'fake',
  label: 'Fake',
  kind: 'alert',
  cadenceMinutes: 15,
  sourceUrl: 'https://example.com',
  fetch: async () => [sig(), sig({ externalId: 'b', title: 'Second', occurredAt: '2026-11-17T11:30:00Z' })],
  ...over,
});

describe('runScan (write mode)', () => {
  const seed = () =>
    new FakeDb({
      holler_profiles: [
        profile(1),
        profile(2, { subscription_status: 'canceled', trial_ends_at: future }),
        profile(3, { subscription_status: 'trialing', trial_ends_at: past }),
        profile(4, { subscription_status: 'trialing', trial_ends_at: future }),
      ],
    });

  it('matches only profiles that can still see alerts', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter()] }, asDb(f));
    expect(f.tables.holler_matches.map((m) => m.user_id).sort()).toEqual(['u000001', 'u000001', 'u000004', 'u000004']);
    expect(r.sources[0].matched).toBe(4);
  });

  it('keeps fetched, parsed, inserted and latestOccurredAt per adapter', async () => {
    const f = seed();
    const noisy = adapter({ id: 'noisy', fetch: async () => [sig({ source: 'noisy' }), sig({ source: 'noisy' }), sig({ source: 'noisy', externalId: 'bad', title: '  ' }), sig({ source: 'noisy', externalId: 'c', occurredAt: '2026-11-17T11:45:00Z' })] });
    const r = await runScan({ now: NOW, adapters: [noisy] }, asDb(f));
    const s = r.sources[0];
    expect(s.fetched).toBe(4); // raw rows returned
    expect(s.parsed).toBe(2); // one duplicate id, one blank title dropped
    expect(s.inserted).toBe(2);
    expect(s.latestOccurredAt).toBe('2026-11-17T11:45:00.000Z');
    const run = f.tables.holler_scan_runs.find((x) => x.source === 'noisy')!;
    expect(run).toMatchObject({ fetched: 4, inserted: 2, error: null });
  });

  it('a second scan inserts nothing new (idempotent upsert)', async () => {
    const f = seed();
    await runScan({ now: NOW, adapters: [adapter()] }, asDb(f));
    const again = await runScan({ now: new Date(NOW.getTime() + 20 * 60_000), adapters: [adapter()] }, asDb(f));
    expect(again.sources[0].inserted).toBe(0);
    expect(f.tables.holler_signals).toHaveLength(2);
  });

  it('records an adapter timeout as the error "timeout" in the result and in holler_scan_runs', async () => {
    const f = seed();
    const slow = adapter({ id: 'slow', fetch: () => new Promise(() => {}) });
    const r = await runScan({ now: NOW, adapters: [slow, adapter({ id: 'fast' })], adapterTimeoutMs: 30 }, asDb(f));
    const by = Object.fromEntries(r.sources.map((s) => [s.id, s]));
    expect(by.slow.status).toBe('error');
    expect(by.slow.error).toBe('timeout');
    expect(by.fast.status).toBe('ok');
    expect(f.tables.holler_scan_runs.find((x) => x.source === 'slow')).toMatchObject({ error: 'timeout', fetched: 0, inserted: 0 });
  });

  it('when matching fails, the sources that inserted rows carry the error so the health email shows it', async () => {
    const f = seed();
    f.failOn['holler_matches.upsert'] = 'db down';
    const r = await runScan({ now: NOW, adapters: [adapter()] }, asDb(f));
    expect(r.error).toMatch(/matching failed: .*db down/);
    expect(r.sources[0].status).toBe('error');
    expect(f.tables.holler_scan_runs.find((x) => x.source === 'fake')!.error).toMatch(/matching failed/);
  });
});

describe('runScan (dry mode is write-free)', () => {
  it('makes no database call at all, even when a db is passed', async () => {
    const f = new FakeDb({ holler_profiles: [profile(1)] });
    const r = await runScan({ dry: true, now: NOW, adapters: [adapter()] }, asDb(f));
    expect(f.calls).toEqual([]);
    expect(f.tables.holler_signals ?? []).toEqual([]);
    expect(r.sources[0]).toMatchObject({ status: 'ok', fetched: 2, parsed: 2, inserted: 0, latestOccurredAt: '2026-11-17T11:30:00.000Z' });
  });
  it('a dry timeout is also "timeout"', async () => {
    const r = await runScan({ dry: true, adapters: [adapter({ fetch: () => new Promise(() => {}) })], adapterTimeoutMs: 20 });
    expect(r.sources[0].error).toBe('timeout');
  });
});
