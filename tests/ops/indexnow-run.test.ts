// IndexNow wiring inside runScan: one ping per non-dry run, never fails or reshapes the scan.
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from './fakedb';
import { runScan } from '../../lib/signals/run';
import type { Db } from '../../lib/signals/store';
import type { Adapter, SignalInput } from '../../lib/signals/types';
import type { IndexNowConfig } from '../../lib/seo/indexnow';

const NOW = new Date('2026-11-17T12:00:00Z'); // Tuesday, Monday 2026-11-16
const SITE = 'https://holler.example';
const CFG: IndexNowConfig = { key: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', host: 'holler.example', origin: SITE, keyLocation: `${SITE}/indexnow-key.txt` };
const asDb = (f: FakeDb) => f as unknown as Db;

const sig = (over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake', externalId: 'a', kind: 'permit', title: 'Roof permit', categories: ['roofing'], severity: 1,
  occurredAt: '2026-11-17T11:00:00Z', lat: 33.749, lon: -84.388, ...over,
});
const adapter = (signals: SignalInput[] = [sig()]): Adapter => ({ id: 'fake', label: 'Fake', kind: 'permit', cadenceMinutes: 15, sourceUrl: 'https://example.com', fetch: async () => signals });
const seed = () => new FakeDb({ holler_place_counts: [{ place_slug: 'atlanta-ga', signals_60d: 40 }], holler_signals: [] });

/** The FakeDb gets the scan's own inserts, so make 12 older rows of this week available to the weekly count. */
function seedWeek(f: FakeDb) {
  for (let i = 0; i < 12; i++) f.tables.holler_signals.push({ id: 900 + i, source: 'seed', external_id: `s${i}`, place_slug: 'atlanta-ga', occurred_at: `2026-11-16T0${i % 9}:00:00Z` });
}

describe('runScan pings IndexNow once after a non-dry scan', () => {
  it('sends the city page and the current weekly page of places that got new rows', async () => {
    const f = seed();
    seedWeek(f);
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const r = await runScan({ now: NOW, adapters: [adapter()], indexNow: { config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch, memory: new Map() } }, asDb(f));
    expect(r.error).toBeUndefined();
    expect(r.totals.inserted).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('https://api.indexnow.org/indexnow');
    const body = JSON.parse(init.body as string);
    expect(body.urlList).toEqual([`${SITE}/local/georgia/atlanta-ga`, `${SITE}/local/georgia/atlanta-ga/week/2026-11-16`]);
    expect(r.indexNow).toMatchObject({ status: 'sent', urls: 2 });
  });
  it('one ping per run, however many sources and rows', async () => {
    const f = seed();
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const a2: Adapter = { ...adapter([sig({ source: 'two', externalId: 'z', occurredAt: '2026-11-10T00:00:00Z' })]), id: 'two' };
    await runScan({ now: NOW, adapters: [adapter([sig(), sig({ externalId: 'b' })]), a2], indexNow: { config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch, memory: new Map() } }, asDb(f));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('dry mode never pings and reads nothing from the database', async () => {
    const f = seed();
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const r = await runScan({ now: NOW, dry: true, adapters: [adapter()], indexNow: { config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch } }, null);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.indexNow).toBeUndefined();
    expect(f.calls).toEqual([]);
  });
  it('skips silently with no config (no key, or localhost): no fetch and nothing on the report', async () => {
    const f = seed();
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const r = await runScan({ now: NOW, adapters: [adapter()], indexNow: { config: null, fetchImpl: fetchImpl as unknown as typeof fetch } }, asDb(f));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.indexNow).toBeUndefined();
    expect(f.calls.filter((c) => c.startsWith('holler_place_counts'))).toEqual([]);
  });
  it('does nothing when the scan wrote no new rows', async () => {
    const f = seed();
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    await runScan({ now: NOW, adapters: [adapter([])], indexNow: { config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch } }, asDb(f));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('a failing ping is logged and never fails the scan or changes its results', async () => {
    const f = seed();
    const log = vi.fn();
    const boom = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const r = await runScan({ now: NOW, adapters: [adapter()], indexNow: { config: CFG, fetchImpl: boom as unknown as typeof fetch, log, memory: new Map() } }, asDb(f));
    expect(r.error).toBeUndefined();
    expect(r.sources[0]).toMatchObject({ status: 'ok', inserted: 1 });
    expect(f.tables.holler_signals).toHaveLength(1);
    expect(f.tables.holler_scan_runs.some((x) => x.source === 'fake')).toBe(true);
    expect(r.indexNow).toMatchObject({ status: 'failed', error: 'socket hang up' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
  });
  it('a database error while counting is isolated too', async () => {
    const f = seed();
    f.failOn['holler_place_counts.select'] = 'view missing';
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const r = await runScan({ now: NOW, adapters: [adapter()], indexNow: { config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch, log: () => {} } }, asDb(f));
    expect(r.error).toBeUndefined();
    expect(r.sources[0].status).toBe('ok');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.indexNow).toMatchObject({ status: 'failed' });
  });
  it('with no INDEXNOW_KEY in the environment the default path makes no request at all', async () => {
    const f = seed();
    const g = vi.spyOn(globalThis, 'fetch');
    await runScan({ now: NOW, adapters: [adapter()] }, asDb(f));
    expect(g.mock.calls.filter((c) => String(c[0]).includes('indexnow'))).toEqual([]);
    g.mockRestore();
  });
});
