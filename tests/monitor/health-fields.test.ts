import { describe, expect, it } from 'vitest';
import { nextHealthRow, readSourceHealth, recordSourceHealth, type SourceHealthRow } from '@/lib/signals/health';
import { ago, H, MIN, MonitorDb, NOW } from './helpers';

const prev: SourceHealthRow = {
  source: 'nws', last_run_at: ago(H), last_success_at: ago(H), last_error: null, last_record_at: ago(3 * H),
  rows_seen_last_run: 4, rows_new_last_run: 1, consecutive_failures: 0, status: 'healthy', updated_at: ago(H),
  last_new_at: ago(5 * H), last_rows_seen_at: ago(2 * H),
};

describe('nextHealthRow keeps the two fields the monitor reads', () => {
  it('a run with new rows sets both', () => {
    const r = nextHealthRow(prev, { source: 'nws', ok: true, rowsSeen: 3, rowsNew: 2, latestRecordAt: ago(MIN) }, NOW);
    expect(r.last_new_at).toBe(NOW.toISOString());
    expect(r.last_rows_seen_at).toBe(NOW.toISOString());
  });
  it('rows seen but none new moves only last_rows_seen_at: this is how "no storms today" differs from "feed returns nothing"', () => {
    const r = nextHealthRow(prev, { source: 'nws', ok: true, rowsSeen: 30, rowsNew: 0, latestRecordAt: null }, NOW);
    expect(r.last_new_at).toBe(prev.last_new_at);
    expect(r.last_rows_seen_at).toBe(NOW.toISOString());
  });
  it('a successful empty run moves neither', () => {
    const r = nextHealthRow(prev, { source: 'nws', ok: true, rowsSeen: 0, rowsNew: 0, latestRecordAt: null }, NOW);
    expect(r.last_new_at).toBe(prev.last_new_at);
    expect(r.last_rows_seen_at).toBe(prev.last_rows_seen_at);
  });
  it('a failed run moves neither, even if it reports counts', () => {
    const r = nextHealthRow(prev, { source: 'nws', ok: false, error: 'timeout', rowsSeen: 9, rowsNew: 9, latestRecordAt: null }, NOW);
    expect(r.last_new_at).toBe(prev.last_new_at);
    expect(r.last_rows_seen_at).toBe(prev.last_rows_seen_at);
  });
  it('first run with nothing leaves both null', () => {
    const r = nextHealthRow(undefined, { source: 'nws', ok: true, rowsSeen: 0, rowsNew: 0, latestRecordAt: null }, NOW);
    expect(r.last_new_at).toBeNull();
    expect(r.last_rows_seen_at).toBeNull();
  });
  it('tracked_since is never written by the scan (the database default owns it)', () => {
    expect(nextHealthRow(prev, { source: 'nws', ok: true, rowsSeen: 1, rowsNew: 1, latestRecordAt: null }, NOW)).not.toHaveProperty('tracked_since');
  });
});

describe('before 0018 the scan keeps recording and the readers keep reading', () => {
  /** A db that rejects the new columns the way PostgREST does. */
  class OldSchemaDb extends MonitorDb {
    from(table: string) {
      const b = super.from(table) as unknown as Record<string, unknown>;
      if (table !== 'holler_source_health') return b as never;
      const up = b.upsert as (rows: Record<string, unknown>[], o?: unknown) => Promise<{ error: { message: string } | null }>;
      b.upsert = (rows: Record<string, unknown>[], o?: unknown) =>
        rows.some((r) => 'last_new_at' in r)
          ? Promise.resolve({ data: null, error: { message: "Could not find the 'last_new_at' column of 'holler_source_health' in the schema cache" } })
          : up(rows, o);
      const sel = (b.select as (c?: string) => unknown).bind(b);
      b.select = (cols?: string) =>
        cols && cols.includes('last_new_at')
          ? { order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'column holler_source_health.last_new_at does not exist' } }) }) }
          : sel(cols);
      return b as never;
    }
  }
  it('recordSourceHealth retries without the new columns and succeeds', async () => {
    const db = new OldSchemaDb();
    const err = await recordSourceHealth(db as never, [{ source: 'nws', ok: true, rowsSeen: 2, rowsNew: 1, latestRecordAt: ago(MIN) }], NOW);
    expect(err).toBeNull();
    expect(db.tables.holler_source_health).toHaveLength(1);
    expect(db.tables.holler_source_health[0]).not.toHaveProperty('last_new_at');
    expect(db.tables.holler_source_health[0]).toMatchObject({ source: 'nws', rows_new_last_run: 1 });
  });
  it('readSourceHealth falls back to the original columns', async () => {
    const db = new OldSchemaDb({ holler_source_health: [{ ...prev, last_new_at: undefined }] });
    const rows = await readSourceHealth(db as never);
    expect(rows).toHaveLength(1);
  });
  it('an unrelated read error is still an error', async () => {
    const db = new MonitorDb();
    db.failOn['holler_source_health.select'] = 'relation missing';
    await expect(readSourceHealth(db as never)).rejects.toThrow('source_health read failed: relation missing');
  });
  it('an unrelated write error is still reported, once, with no retry', async () => {
    const db = new MonitorDb();
    db.failOn['holler_source_health.upsert'] = 'permission denied';
    const err = await recordSourceHealth(db as never, [{ source: 'nws', ok: true, rowsSeen: 1, rowsNew: 1, latestRecordAt: null }], NOW);
    expect(err).toContain('permission denied');
  });
});
