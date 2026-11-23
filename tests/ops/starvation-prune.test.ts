// Verify P2-5 (a source can be starved forever by the scan deadline) and P2-3 (rate-limit table growth).
// Rows and adapters are hand written (assumed). The simulation mirrors /tmp/r2-verify/starve.vt.ts from the review: the fetch phase ends
// at 40 s and each signals write costs 4 s, with the real 48 s deadline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from './fakedb';
import { SCAN_DEADLINE_MS, runScan } from '../../lib/signals/run';
import { pruneOldSignals, type Db } from '../../lib/signals/store';
import type { Adapter } from '../../lib/signals/types';

const asDb = (f: FakeDb) => f as unknown as Db;
const BASE = new Date('2026-11-17T12:00:00Z').getTime();

const mk = (id: string, cadenceMinutes: number): Adapter => ({
  id,
  label: id,
  kind: 'alert',
  cadenceMinutes,
  sourceUrl: 'https://example.com',
  fetch: async () => [
    { source: id, externalId: `${id}-${Math.random()}`, kind: 'alert', title: `t ${id}`, categories: ['roofing'], severity: 2, occurredAt: new Date(BASE).toISOString(), lat: 33, lon: -84, state: 'GA' },
  ],
});

describe('scan deadline: nobody starves (P2-5)', () => {
  // getLastRunTimes (lib/signals/store.ts) reads only the last 3 days of holler_scan_runs, measured from the real Date.now(), while these
  // tests use the fixed simulated date BASE. Once BASE is more than 3 days in the past the simulated run logs fall out of that window,
  // every source looks never-run, and the write order silently falls back to registry order (the 2026-11-17 date aged out on 2026-11-20).
  // Pin Date (only Date: the adapter timeout still uses real timers) to the simulated time so the tests do not depend on today's date.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(BASE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function simulate(ticks: number, adapters: Adapter[]) {
    const db = new FakeDb({ holler_profiles: [] });
    const written: string[][] = [];
    const skipped: string[][] = [];
    let sim = 0;
    let started = false;
    const origFrom = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = origFrom(t) as { upsert: (...a: unknown[]) => unknown; insert: (...a: unknown[]) => unknown };
      if (t === 'holler_signals') {
        for (const m of ['upsert', 'insert'] as const) {
          const orig = b[m].bind(b);
          b[m] = (...a: unknown[]) => {
            sim += 4000;
            return orig(...a);
          };
        }
      }
      return b;
    };
    // First call is t0 (0 ms); every later call is "40 s of fetching plus the simulated write time so far".
    const clock = () => {
      if (!started) {
        started = true;
        sim = 0;
        return 0;
      }
      return 40_000 + sim;
    };
    for (let tick = 0; tick < ticks; tick++) {
      started = false;
      sim = 0;
      const now = new Date(BASE + tick * 15 * 60_000);
      vi.setSystemTime(now);
      const before = new Set((db.tables.holler_scan_runs ?? []).map((r) => r.id));
      const signalsBefore = (db.tables.holler_signals ?? []).length;
      const r = await runScan({ now, adapters, clock, deadlineMs: SCAN_DEADLINE_MS }, asDb(db));
      // the engine stamps started_at with real time; move the new rows onto the simulated clock so cadence works
      for (const row of db.tables.holler_scan_runs ?? []) if (!before.has(row.id)) row.started_at = now.toISOString();
      // in the order the engine wrote them (insertion order of the signals table), not the report's registry order
      written.push([...new Set((db.tables.holler_signals ?? []).slice(signalsBefore).map((s) => String(s.source)))]);
      skipped.push(r.sources.filter((s) => /^deadline:/.test(s.error ?? '')).map((s) => s.id));
    }
    return { written, skipped };
  }

  it('a source skipped at the deadline is written first on the next tick, so a 6 hour source is never skipped twice in a row', async () => {
    const adapters = [mk('nws', 15), mk('faa', 15), mk('spc', 30), mk('usgs', 30), mk('late', 360)];
    const { written, skipped } = await simulate(8, adapters);
    // tick 0: five never-run sources, three fit before the deadline (40, 44 and 48 s), two are skipped
    expect(written[0]).toEqual(['nws', 'faa', 'spc']);
    expect(skipped[0].sort()).toEqual(['late', 'usgs']);
    // tick 1: the two skipped sources have no run log, so they are the oldest and go first
    expect(written[1].slice(0, 2).sort()).toEqual(['late', 'usgs']);
    // no source is skipped on two consecutive ticks, and every source has been written within 8 ticks
    for (let i = 1; i < skipped.length; i++) for (const id of skipped[i]) expect(skipped[i - 1].includes(id), `${id} skipped twice in a row at tick ${i}`).toBe(false);
    for (const a of adapters) expect(written.flat().includes(a.id), a.id).toBe(true);
  });

  it('a never-run source that sits last in the registry is written first once the others have run (with the old fixed order it was skipped on every tick: the review\'s repro)', async () => {
    const adapters = [mk('nws', 15), mk('faa', 15), mk('spc', 30), mk('late', 360)];
    const { written } = await simulate(2, adapters);
    expect(written[0]).toEqual(['nws', 'faa', 'spc']);
    expect(written[1][0]).toBe('late');
  });

  it('the report keeps the registry order whatever order the writes happened in', async () => {
    const db = new FakeDb({ holler_profiles: [] });
    const now = new Date(BASE);
    // pretend b ran an hour ago and a never ran: a is written first, but the report lists a then b in registry order
    db.tables.holler_scan_runs = [{ id: 1, source: 'b', started_at: new Date(BASE - 3_600_000).toISOString() }];
    const r = await runScan({ now, adapters: [mk('a', 15), mk('b', 15)] }, asDb(db));
    expect(r.sources.map((s) => s.id)).toEqual(['a', 'b']);
    const order = (db.tables.holler_signals ?? []).map((s) => s.source);
    expect(order[0]).toBe('a');
  });
});

describe('daily prune also clears the rate-limit table (P2-3)', () => {
  it('deletes holler_rate_limits rows older than two days and keeps newer ones', async () => {
    const now = new Date(BASE);
    const f = new FakeDb({
      holler_rate_limits: [
        { key: 'check:ip:old', window_start: new Date(BASE - 3 * 86_400_000).toISOString(), count: 4 },
        { key: 'check:ip:edge', window_start: new Date(BASE - 2 * 86_400_000 - 1000).toISOString(), count: 1 },
        { key: 'check:ip:fresh', window_start: new Date(BASE - 60_000).toISOString(), count: 2 },
        { key: 'check:ip:yesterday', window_start: new Date(BASE - 86_400_000).toISOString(), count: 9 },
      ],
    });
    expect(await pruneOldSignals(asDb(f), now)).toBe(true);
    expect(f.tables.holler_rate_limits.map((r) => r.key).sort()).toEqual(['check:ip:fresh', 'check:ip:yesterday']);
  });

  it('a failing rate-limit delete (table missing, privileges) never fails the prune of signals, and runs once a day like the rest', async () => {
    const now = new Date(BASE);
    const f = new FakeDb({ holler_signals: [{ id: 1, source: 'x', external_id: 'old', occurred_at: new Date(BASE - 200 * 86_400_000).toISOString() }] });
    f.failOn['holler_rate_limits.delete'] = 'relation does not exist';
    const spy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await pruneOldSignals(asDb(f), now)).toBe(true);
    expect(f.tables.holler_signals).toHaveLength(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    // second call the same day: the marker row stops it, so the rate-limit delete is not repeated
    f.calls.length = 0;
    expect(await pruneOldSignals(asDb(f), now)).toBe(false);
    expect(f.calls.filter((c) => c === 'holler_rate_limits.delete')).toHaveLength(0);
  });
});
