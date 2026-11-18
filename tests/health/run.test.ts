import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-16T12:00:00Z');
const sig = (id: string, over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake', externalId: id, kind: 'alert', title: `Hail ${id}`, categories: ['roofing'], severity: 2,
  occurredAt: '2026-11-16T11:00:00Z', lat: 33.953, lon: -84.55, ...over,
});
const adapter = (over: Partial<Adapter> = {}): Adapter => ({
  id: 'fake', label: 'Fake', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'https://example.com',
  fetch: async () => [sig('a'), sig('b')], ...over,
});

/** FakeDb whose health upsert really updates, so a second run sees the first. */
class HealthDb extends FakeDb {
  from(table: string) {
    const b = super.from(table) as unknown as Record<string, unknown>;
    if (table !== 'holler_source_health') return b as never;
    const t = this.tables[table];
    const orig = b.upsert as (rows: Record<string, unknown>[], o?: unknown) => unknown;
    b.upsert = (rows: Record<string, unknown>[], o?: unknown) => {
      if (this.failOn['holler_source_health.upsert']) return orig.call(b, rows, o);
      for (const r of rows) {
        const i = t.findIndex((x) => x.source === r.source);
        if (i >= 0) t[i] = { ...r };
        else t.push({ ...r });
      }
      this.calls.push('holler_source_health.upsert');
      return Promise.resolve({ data: null, error: null });
    };
    return b as never;
  }
}

const run = (db: FakeDb, adapters: Adapter[], now = NOW, source?: string) => runScan({ now, source, adapters, indexNow: { config: null } as never }, db as never);

describe('runScan writes source health', () => {
  it('records a success with counts and the newest record time', async () => {
    const db = new HealthDb();
    await run(db, [adapter()]);
    const row = db.tables.holler_source_health[0];
    expect(row).toMatchObject({ source: 'fake', consecutive_failures: 0, last_error: null, rows_seen_last_run: 2, last_record_at: '2026-11-16T11:00:00.000Z' });
    expect(row.last_success_at).toBe(NOW.toISOString());
    expect(row.status).toBe('healthy');
  });

  it('counts failures across runs and goes unavailable on the third', async () => {
    const db = new HealthDb();
    const bad = adapter({ fetch: async () => { throw new Error('HTTP 503'); } });
    for (let i = 0; i < 3; i++) await run(db, [bad], new Date(NOW.getTime() + i * 30 * 60_000), 'fake'); // source option bypasses the cadence check
    const row = db.tables.holler_source_health[0];
    expect(row.consecutive_failures).toBe(3);
    expect(row.status).toBe('unavailable');
    expect(row.last_error).toBe('HTTP 503');
  });

  it('a timeout is recorded as timeout', async () => {
    const db = new HealthDb();
    await runScan({ now: NOW, adapters: [adapter({ fetch: () => new Promise(() => {}) })], adapterTimeoutMs: 20 }, db as never);
    expect(db.tables.holler_source_health[0].last_error).toBe('timeout');
  });

  it('keeps going when the health write fails: report unchanged, signals stored, other sources still logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = new HealthDb();
    db.failOn['holler_source_health.upsert'] = 'permission denied for table holler_source_health';
    const r = await run(db, [adapter(), adapter({ id: 'other', fetch: async () => [sig('z', { source: 'other' })] })]);
    expect(r.error).toBeUndefined();
    expect(r.sources.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(r.totals.inserted).toBe(3);
    expect(db.tables.holler_scan_runs.filter((x) => x.source !== '_prune')).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps going when the health read throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = new HealthDb();
    db.failOn['holler_source_health.select'] = 'relation does not exist';
    const r = await run(db, [adapter()]);
    expect(r.error).toBeUndefined();
    expect(r.totals.inserted).toBe(2);
    expect(db.tables.holler_scan_runs.filter((x) => x.source !== '_prune')).toHaveLength(1);
    warn.mockRestore();
  });

  it('stores a trimmed error with no row data when the insert fails', async () => {
    const db = new HealthDb();
    db.failOn['holler_signals.upsert'] = 'duplicate key\nDETAIL: Key (external_id)=(P-9 Jane Roe) exists. ' + 'x'.repeat(600);
    await run(db, [adapter()]);
    const row = db.tables.holler_source_health[0];
    expect(row.consecutive_failures).toBe(1);
    expect(String(row.last_error).length).toBeLessThanOrEqual(300);
    expect(String(row.last_error)).not.toMatch(/Jane|P-9/);
  });

  it('does not write health in a dry run', async () => {
    const db = new HealthDb();
    await runScan({ dry: true, now: NOW, adapters: [adapter()] }, db as never);
    expect(db.tables.holler_source_health ?? []).toHaveLength(0);
  });
});
