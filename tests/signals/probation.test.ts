// Source probation: a new source's rows are stored (data.probation = true) and counted, but never matched, pushed or shown.
// Rows and fakes are hand-written; the in-memory db is tests/ops/fakedb.ts and the SQL double is tests/fixtures/fake-signals-db.ts.
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { fakeSignalsDb } from '../fixtures/fake-signals-db';
import { runScan } from '@/lib/signals/run';
import { backfillMatches } from '@/lib/signals/backfill';
import { matchOne, matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { isProbation, PROBATION_COLUMN, withoutProbation, withProbationData } from '@/lib/signals/probation';
import { OPPORTUNITY_DATA_COLUMNS } from '@/lib/signals/member-opportunity';
import { INSERTED_SIGNAL_COLUMNS, type Db } from '@/lib/signals/store';
import { pushEntriesFromMatches, PUSH_SIGNAL_COLUMNS } from '@/lib/push/notify';
import { buildAlerts, MATCH_SELECT } from '@/lib/mobile/feed';
import type { Adapter, SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-17T12:00:00Z');
const asDb = (f: FakeDb) => f as unknown as Db;
const profile = { user_id: 'u000001', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-10T00:00:00Z' };

const sig = (over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake',
  externalId: 'a',
  kind: 'alert',
  title: 'Hail warning: First',
  summary: null,
  url: 'https://example.com/a',
  categories: ['roofing'],
  severity: 3,
  occurredAt: '2026-11-17T11:00:00Z',
  lat: 33.953,
  lon: -84.55,
  state: 'GA',
  city: 'Marietta',
  ...over,
});
const adapter = (over: Partial<Adapter> = {}): Adapter => ({
  id: 'fake',
  label: 'Fake',
  kind: 'alert',
  cadenceMinutes: 15,
  sourceUrl: 'https://example.com',
  fetch: async () => [sig(), sig({ externalId: 'b', title: 'Hail warning: Second', data: { subtype: 'permit', note: 'keep me' } })],
  ...over,
});

describe('isProbation and friends', () => {
  it('reads data.probation, the probation alias, and nothing else', () => {
    expect(isProbation({ data: { probation: true } })).toBe(true);
    expect(isProbation({ probation: 'true' })).toBe(true);
    expect(isProbation({ probation: true })).toBe(true);
    expect(isProbation({ data: { probation: false } })).toBe(false);
    expect(isProbation({ data: { subtype: 'permit' } })).toBe(false);
    expect(isProbation({ probation: null })).toBe(false);
    expect(isProbation({ data: null })).toBe(false);
    expect(isProbation(null)).toBe(false);
    expect(isProbation(undefined)).toBe(false);
    expect(withoutProbation([{ id: 1 }, { id: 2, data: { probation: true } }, { id: 3, probation: 'true' }])).toEqual([{ id: 1 }]);
  });

  it('withProbationData merges the flag and keeps every other key; it leaves a normal adapter alone', () => {
    expect(withProbationData({ subtype: 'permit', n: 1 }, true)).toEqual({ subtype: 'permit', n: 1, probation: true });
    expect(withProbationData(undefined, true)).toEqual({ probation: true });
    const d = { subtype: 'permit' };
    expect(withProbationData(d, undefined)).toBe(d);
    expect(withProbationData(undefined, false)).toBeUndefined();
  });

  it('the opportunity select columns carry the flag, so every feed, push, digest, preview and check read can test it', () => {
    expect(OPPORTUNITY_DATA_COLUMNS).toContain(`probation:${PROBATION_COLUMN}`);
    for (const cols of [INSERTED_SIGNAL_COLUMNS, PUSH_SIGNAL_COLUMNS, MATCH_SELECT]) expect(cols).toContain('probation:data->>probation');
  });
});

describe('runScan with a probation adapter', () => {
  const seed = () => new FakeDb({ holler_profiles: [profile] });

  it('stores the rows with data.probation true and keeps the other data keys; no place slug; matches nobody', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter({ probation: true })] }, asDb(f));
    expect(f.tables.holler_signals).toHaveLength(2);
    const [a, b] = f.tables.holler_signals;
    expect(a.data).toEqual({ probation: true });
    expect(b.data).toEqual({ subtype: 'permit', note: 'keep me', probation: true });
    expect(a.place_slug).toBeNull();
    expect(b.place_slug).toBeNull();
    expect(f.tables.holler_matches ?? []).toEqual([]);
    expect(r.sources[0]).toMatchObject({ status: 'ok', fetched: 2, parsed: 2, inserted: 2, matched: 0 });
    expect(r.totals).toMatchObject({ fetched: 2, inserted: 2, matched: 0 });
  });

  it('scan_runs and source health still record the probation source normally', async () => {
    const f = seed();
    await runScan({ now: NOW, adapters: [adapter({ id: 'probe', probation: true, fetch: async () => [sig({ source: 'probe' }), sig({ source: 'probe', externalId: 'b' })] })] }, asDb(f));
    expect(f.tables.holler_scan_runs.find((x) => x.source === 'probe')).toMatchObject({ fetched: 2, inserted: 2, matched: 0, error: null });
    const health = (f.tables.holler_source_health ?? []).find((x) => x.source === 'probe');
    expect(health).toMatchObject({ status: 'healthy', rows_seen_last_run: 2, rows_new_last_run: 2 });
  });

  it('a source that errors is still logged as an error while on probation', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter({ id: 'probe', probation: true, fetch: async () => { throw new Error('HTTP 500'); } })] }, asDb(f));
    expect(r.sources[0]).toMatchObject({ status: 'error', inserted: 0 });
    expect(f.tables.holler_scan_runs.find((x) => x.source === 'probe')).toMatchObject({ error: 'HTTP 500' });
  });

  it('control: the same rows from a normal adapter carry no flag, get a place slug path and are matched', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter()] }, asDb(f));
    expect(f.tables.holler_signals.every((s) => s.data?.probation === undefined)).toBe(true);
    expect(f.tables.holler_matches.length).toBeGreaterThan(0);
    expect(r.sources[0].matched).toBe(f.tables.holler_matches.length);
  });

  it('a probation source mixed with a normal one: only the normal source is matched', async () => {
    const f = seed();
    const r = await runScan(
      { now: NOW, adapters: [adapter({ id: 'probe', probation: true, fetch: async () => [sig({ source: 'probe', externalId: 'p1' })] }), adapter({ id: 'live', fetch: async () => [sig({ source: 'live', externalId: 'l1' })] })] },
      asDb(f),
    );
    const bySource = Object.fromEntries(r.sources.map((s) => [s.id, s]));
    expect(bySource.probe).toMatchObject({ inserted: 1, matched: 0 });
    expect(bySource.live).toMatchObject({ inserted: 1, matched: 1 });
    const probeId = f.tables.holler_signals.find((s) => s.source === 'probe')!.id;
    expect(f.tables.holler_matches.map((m) => m.signal_id)).not.toContain(probeId);
  });

  it('a probation scan does not ping IndexNow (and the same scan from a normal source does)', async () => {
    const CFG = { key: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', host: 'holler.example', origin: 'https://holler.example', keyLocation: 'https://holler.example/indexnow-key.txt' };
    const permit = [sig({ kind: 'permit', title: 'Roof permit', lat: 33.749, lon: -84.388 })];
    const run = async (probation: boolean) => {
      const f = new FakeDb({ holler_profiles: [profile], holler_place_counts: [{ place_slug: 'atlanta-ga', signals_60d: 40 }], holler_signals: [] });
      for (let i = 0; i < 12; i++) f.tables.holler_signals.push({ id: 900 + i, source: 'seed', external_id: `s${i}`, place_slug: 'atlanta-ga', occurred_at: `2026-11-16T0${i % 9}:00:00Z` });
      const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
      await runScan({ now: NOW, adapters: [adapter({ kind: 'permit', probation, fetch: async () => permit })], indexNow: { config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch, memory: new Map() } }, asDb(f));
      return fetchImpl;
    };
    expect(await run(false)).toHaveBeenCalledTimes(1);
    expect(await run(true)).not.toHaveBeenCalled();
  });
});

describe('the matcher never matches a probation row', () => {
  const member: MatchProfile = { user_id: 'm', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25 };
  const rec = (id: number, over: Partial<MatchSignal> = {}): MatchSignal => ({
    id, kind: 'report', source: 'spc', title: 'Hail report', summary: null, categories: ['roofing'], lat: 33.8, lon: -84.4, state: 'GA', severity: 2,
    occurred_at: '2026-11-17T10:00:00Z', data: { type: 'hail', hailInches: 1.5 }, ...over,
  });

  it('control: the plain row matches', () => {
    expect(matchOne(rec(1), member)).not.toBeNull();
    expect(matchSignals([rec(1)], [member]).map((r) => r.signal_id)).toEqual([1]);
  });

  it('matchOne and matchSignals skip a row flagged in data, or by the data->>probation alias', () => {
    const inData = rec(2, { data: { type: 'hail', hailInches: 1.5, probation: true } });
    const alias = rec(3, { probation: 'true' });
    expect(matchOne(inData, member)).toBeNull();
    expect(matchOne(alias, member)).toBeNull();
    expect(matchSignals([rec(1), inData, alias], [member]).map((r) => r.signal_id)).toEqual([1]);
  });

  it('a probation row never takes a place in the per-user cap', () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => rec(100 + i, { probation: 'true', severity: 3 })), rec(1)];
    expect(matchSignals(rows, [member]).map((r) => r.signal_id)).toEqual([1]);
  });

  it('keyword watches (Pro) do not match a probation row either', () => {
    const pro: MatchProfile = { ...member, plan: 'pro', subscription_status: 'active', keywords: ['hail report'] };
    expect(matchOne(rec(4, { probation: 'true' }), pro)).toBeNull();
  });
});

describe('backfill never gives a new member a probation row', () => {
  const NOWB = new Date('2026-11-17T12:00:00Z');
  const mk = (id: number, over: Record<string, unknown> = {}) => ({
    id, kind: 'permit', categories: ['roofing'], lat: 33.953, lon: -84.55, state: 'GA', severity: 1, occurred_at: new Date(NOWB.getTime() - id * 3_600_000).toISOString(), expires_at: null, ...over,
  });
  it('drops rows of a probation source from the near RPC and from the direct reads', async () => {
    const base = fakeSignalsDb([mk(1), mk(2, { data: { probation: true } }), mk(3, { state: 'GA', lat: null, lon: null, severity: 3, data: { probation: true } })] as never, { now: NOWB });
    const upserts: Record<string, unknown>[][] = [];
    const db = {
      rpc: (...a: Parameters<typeof base.rpc>) => base.rpc(...a),
      from: (t: string) => (t === 'holler_matches' ? { upsert: (rows: Record<string, unknown>[]) => (upserts.push(rows), Promise.resolve({ error: null })) } : base.from(t)),
    };
    await backfillMatches(db as never, { user_id: 'u1', categories: ['roofing'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 }, NOWB);
    expect(upserts.flat().map((r) => r.signal_id)).toEqual([1]);
    // the direct state-level read filters in SQL as well
    expect(base.log.some((l) => l.kind === 'select' && String(l.name).includes('is:data->>probation'))).toBe(true);
  });
});

describe('push never counts a probation row', () => {
  const now = NOW.getTime();
  const m = (id: number, signal: Record<string, unknown>) => ({
    id, user_id: 'u1', created_at: new Date(now - 60_000).toISOString(),
    signal: { id: 100 + id, title: `Hail ${id}`, city: 'Atlanta', source: 'spc', kind: 'report', categories: ['roofing'], severity: 2, occurred_at: new Date(now - 3_600_000).toISOString(), opp_type: 'hail', opp_hail: '1.5', ...signal },
  });
  it('control: an Act now hail report is counted', () => {
    expect(pushEntriesFromMatches([m(1, {})] as never, now, new Map([['u1', ['roofing']]])).get('u1')?.count).toBe(1);
  });
  it('a probation row (alias or data) is not counted, and the member gets no entry at all when it is the only one', () => {
    const e = pushEntriesFromMatches([m(1, { probation: 'true' }), m(2, { data: { probation: true } }), m(3, {})] as never, now, new Map([['u1', ['roofing']]]));
    expect(e.get('u1')).toMatchObject({ count: 1, matchIds: [3] });
    expect(pushEntriesFromMatches([m(1, { probation: 'true' })] as never, now, new Map([['u1', ['roofing']]])).size).toBe(0);
  });
});

describe('the app feed builder (lib/mobile/feed) drops a probation row', () => {
  const row = (id: number, s: Record<string, unknown>) => ({
    id, status: 'new', distance_mi: 2, draft: null, created_at: NOW.toISOString(),
    signal: { id: 100 + id, source: 'spc', kind: 'report', title: `Hail ${id}`, summary: null, url: null, city: 'Austin', state: 'TX', county: null, zip: null, severity: 2, occurred_at: NOW.toISOString(), expires_at: null, categories: ['roofing'], subtype: null, opp_type: 'hail', opp_hail: '1.5', ...s },
  });
  it('lists the plain row and not the flagged one', async () => {
    const items = await buildAlerts([row(1, {}), row(2, { probation: 'true' }), row(3, { data: { probation: true } })] as never, {
      userId: 'u', locked: true, db: { from: () => { throw new Error('locked: no reads'); } } as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['roofing'],
    });
    expect(items.map((i) => i.matchId)).toEqual([1]);
  });
});
