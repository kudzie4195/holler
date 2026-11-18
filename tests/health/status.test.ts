import { describe, expect, it, vi } from 'vitest';
import { computeStatus, nextHealthRow, normalGapDays, sanitizeHealthError, summarizeSourceHealth, type SourceHealthRow } from '@/lib/signals/health';

const NOW = new Date('2026-11-18T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const st = (over: Partial<Parameters<typeof computeStatus>[0]> = {}) =>
  computeStatus({ source: 'socrata-chicago-permits', now: NOW, lastSuccessAt: ago(H), lastRecordAt: ago(D), consecutiveFailures: 0, ...over });

describe('normal gap table', () => {
  it('maps source types to days', () => {
    expect(normalGapDays('nws')).toBe(1);
    expect(normalGapDays('spc')).toBe(1);
    expect(normalGapDays('socrata-nyc-permits')).toBe(7);
    expect(normalGapDays('socrata-nyc-311')).toBe(7);
    expect(normalGapDays('arcgis-atlanta-permits')).toBe(7);
    expect(normalGapDays('socrata-chicago-inspections')).toBe(14);
    expect(normalGapDays('socrata-chicago-business')).toBe(14);
    expect(normalGapDays('socrata-austin-violations')).toBe(14);
    expect(normalGapDays('usaspending')).toBe(30);
    expect(normalGapDays('sam-gov')).toBe(30);
    expect(normalGapDays('something-new')).toBe(7);
  });
});

describe('unavailable', () => {
  it('3 consecutive failures is unavailable, 2 is not', () => {
    expect(st({ consecutiveFailures: 3 })).toBe('unavailable');
    expect(st({ consecutiveFailures: 9 })).toBe('unavailable');
    expect(st({ consecutiveFailures: 2 })).toBe('healthy');
  });
  it('no success for more than 72 hours is unavailable; exactly 72 hours is not', () => {
    expect(st({ lastSuccessAt: ago(72 * H + 1) })).toBe('unavailable');
    expect(st({ lastSuccessAt: ago(72 * H), lastRecordAt: ago(H) })).toBe('healthy');
  });
  it('beats the record-age rules', () => {
    expect(st({ consecutiveFailures: 3, lastRecordAt: ago(H) })).toBe('unavailable');
  });
});

describe('delayed and degraded (permits, normal gap 7 days)', () => {
  it('1.5 gaps exactly is healthy, just past is delayed', () => {
    expect(st({ lastRecordAt: ago(10.5 * D) })).toBe('healthy');
    expect(st({ lastRecordAt: ago(10.5 * D + 1) })).toBe('delayed');
  });
  it('3 gaps exactly is delayed, just past is degraded', () => {
    expect(st({ lastRecordAt: ago(21 * D) })).toBe('delayed');
    expect(st({ lastRecordAt: ago(21 * D + 1) })).toBe('degraded');
  });
  it('uses the source gap: a storm feed is delayed after 1.5 days, an award feed is not', () => {
    expect(st({ source: 'nws', lastRecordAt: ago(2 * D) })).toBe('delayed');
    expect(st({ source: 'nws', lastRecordAt: ago(3.1 * D) })).toBe('degraded');
    expect(st({ source: 'usaspending', lastRecordAt: ago(40 * D) })).toBe('healthy');
    expect(st({ source: 'usaspending', lastRecordAt: ago(46 * D) })).toBe('delayed');
  });
  it('a source that succeeded but never returned a record is delayed', () => {
    expect(st({ lastRecordAt: null })).toBe('delayed');
  });
  it('a source that never succeeded is degraded after a failure, delayed before any', () => {
    expect(st({ lastSuccessAt: null, consecutiveFailures: 1 })).toBe('degraded');
    expect(st({ lastSuccessAt: null, consecutiveFailures: 0 })).toBe('delayed');
    expect(st({ lastSuccessAt: null, consecutiveFailures: 3 })).toBe('unavailable');
  });
});

describe('nextHealthRow', () => {
  const prev: SourceHealthRow = {
    source: 'nws', last_run_at: ago(H), last_success_at: ago(H), last_error: null, last_record_at: ago(3 * H),
    rows_seen_last_run: 4, rows_new_last_run: 1, consecutive_failures: 0, status: 'healthy', updated_at: ago(H),
  };
  it('a success resets failures, clears the error and keeps the newest record time', () => {
    const r = nextHealthRow({ ...prev, consecutive_failures: 2, last_error: 'timeout' }, { source: 'nws', ok: true, rowsSeen: 0, rowsNew: 0, latestRecordAt: null }, NOW);
    expect(r.consecutive_failures).toBe(0);
    expect(r.last_error).toBeNull();
    expect(r.last_record_at).toBe(prev.last_record_at);
    expect(r.last_success_at).toBe(NOW.toISOString());
  });
  it('a failure counts up, keeps last success and record, and stores the error', () => {
    const r = nextHealthRow(prev, { source: 'nws', ok: false, error: 'timeout', rowsSeen: 0, rowsNew: 0, latestRecordAt: null }, NOW);
    expect(r.consecutive_failures).toBe(1);
    expect(r.last_success_at).toBe(prev.last_success_at);
    expect(r.last_error).toBe('timeout');
  });
  it('the third failure in a row is unavailable', () => {
    let row: SourceHealthRow | undefined = prev;
    for (let i = 0; i < 3; i++) row = nextHealthRow(row, { source: 'nws', ok: false, error: 'HTTP 503', rowsSeen: 0, rowsNew: 0, latestRecordAt: null }, NOW);
    expect(row!.status).toBe('unavailable');
  });
  it('record time never moves backwards and is capped at the run time', () => {
    expect(nextHealthRow(prev, { source: 'nws', ok: true, rowsSeen: 1, rowsNew: 0, latestRecordAt: ago(9 * H) }, NOW).last_record_at).toBe(prev.last_record_at);
    expect(nextHealthRow(prev, { source: 'nws', ok: true, rowsSeen: 1, rowsNew: 1, latestRecordAt: ago(-5 * D) }, NOW).last_record_at).toBe(NOW.toISOString());
  });
  it('first run has no previous row', () => {
    const r = nextHealthRow(undefined, { source: 'nws', ok: true, rowsSeen: 3, rowsNew: 3, latestRecordAt: ago(H) }, NOW);
    expect(r).toMatchObject({ consecutive_failures: 0, rows_seen_last_run: 3, rows_new_last_run: 3, status: 'healthy' });
  });
});

describe('sanitizeHealthError', () => {
  it('keeps short codes and trims to 300 characters', () => {
    expect(sanitizeHealthError('timeout')).toBe('timeout');
    expect(sanitizeHealthError('x'.repeat(900))).toHaveLength(300);
    expect(sanitizeHealthError(null)).toBeNull();
  });
  it('carries no row data from database errors', () => {
    const e = 'duplicate key value violates unique constraint "x"\nDETAIL: Key (external_id)=(P-123 Jane Roe) already exists.';
    expect(sanitizeHealthError(new Error(e))).toBe('duplicate key value violates unique constraint "x"');
    expect(sanitizeHealthError('null value in column "title" Failing row contains (1, Jane Roe, 404-555-0100)')).not.toMatch(/Jane|404/);
  });
  it('blanks emails and phone numbers that slip into a message', () => {
    const s = sanitizeHealthError('bad row for jane@example.com call 404-555-0100')!;
    expect(s).not.toMatch(/jane@|404-555/);
  });
  it('strips quoted values, JSON bodies and secret query parameters (review P2-4)', () => {
    const cases = [
      'invalid input syntax for type timestamp with time zone: "Jane Doe"',
      'value "1234 Elm Street Apt 5" out of range',
      'HTTP 500: {"name":"Jane Doe","address":"123 Main St"}',
      'parse error at row: {"title":"Smith Residence roof replacement"}',
      "bad value 'Smith Residence' for column",
      'fetch failed https://api.example.com/v1/x?api_key=SECRETKEY123&q=roof',
      'fetch failed https://api.example.com/v1/x?token=abc123',
      'request to https://x.test/a?client_secret=ZZZ failed',
      'failed with &key=SECRETKEY123 on retry',
    ];
    for (const c of cases) {
      const out = sanitizeHealthError(c)!;
      expect(out, c).not.toMatch(/Jane|Doe|Elm|Main St|Smith|SECRETKEY|abc123|ZZZ|roof/);
    }
    expect(sanitizeHealthError('HTTP 500: {"name":"Jane Doe"}')).toBe('HTTP 500: [x]');
    expect(sanitizeHealthError('duplicate key value violates unique constraint "holler_signals_key"')).toContain('"holler_signals_key"');
    expect(sanitizeHealthError('null value in column "title" violates not-null constraint')).toContain('column "title"');
    expect(sanitizeHealthError('timeout')).toBe('timeout');
    expect(sanitizeHealthError('HTTP 503')).toBe('HTTP 503');
  });
  it('never returns an empty string', () => {
    expect(sanitizeHealthError('DETAIL: only row data')).toBe('error');
  });
});

describe('summarizeSourceHealth', () => {
  it('recomputes status at read time so a stalled source goes stale', () => {
    const row: SourceHealthRow = {
      source: 'nws', last_run_at: ago(100 * H), last_success_at: ago(100 * H), last_error: null, last_record_at: ago(100 * H),
      rows_seen_last_run: 1, rows_new_last_run: 1, consecutive_failures: 0, status: 'healthy', updated_at: ago(100 * H),
    };
    const s = summarizeSourceHealth([row], NOW);
    expect(s.sources[0].status).toBe('unavailable');
    expect(s.counts).toEqual({ healthy: 0, delayed: 0, degraded: 0, unavailable: 1 });
    expect(s.sources[0].normal_gap_days).toBe(1);
  });
});

describe('recordSourceHealth time bound (review P2-5)', () => {
  it('a hanging database call returns after 3 seconds with a message, and never throws', async () => {
    const { recordSourceHealth, HEALTH_WRITE_TIMEOUT_MS } = await import('@/lib/signals/health');
    expect(HEALTH_WRITE_TIMEOUT_MS).toBe(3000);
    vi.useFakeTimers();
    try {
      const hang = { from: () => ({ select: () => ({ order: () => ({ limit: () => new Promise(() => undefined) }) }) }) } as never;
      const p = recordSourceHealth(hang, [{ source: 'nws', ok: true, rowsSeen: 1, rowsNew: 1, latestRecordAt: null }], new Date());
      await vi.advanceTimersByTimeAsync(2999);
      let done = false;
      void p.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await expect(p).resolves.toBe('source_health write failed: timed out after 3000 ms');
    } finally {
      vi.useRealTimers();
    }
  });
});
