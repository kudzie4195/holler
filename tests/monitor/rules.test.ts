import { describe, expect, it } from 'vitest';
import {
  evaluateFeed,
  evaluateScan,
  evaluateSources,
  isRunLevelError,
  oneDaySourceProblem,
  SCAN_STALE_MS,
  SOURCE_SILENCE_MS,
} from '@/lib/monitor/rules';
import { ago, D, H, health, MIN, NOW, scanRuns } from './helpers';

describe('schedule facts the thresholds rest on', () => {
  it('the scan runs every 15 minutes, so stale means more than an hour', () => {
    expect(SCAN_STALE_MS).toBe(60 * MIN);
    expect(SOURCE_SILENCE_MS).toBe(24 * H);
  });
});

describe('condition a: scan error and scan stale', () => {
  it('a recent clean scan is quiet', () => {
    expect(evaluateScan(scanRuns(6 * MIN), NOW)).toEqual([]);
  });
  it('exactly 60 minutes old is not stale; 60 minutes and 1 second is', () => {
    expect(evaluateScan(scanRuns(60 * MIN), NOW)).toEqual([]);
    const c = evaluateScan(scanRuns(60 * MIN + 1000), NOW);
    expect(c.map((x) => x.code)).toEqual(['scan_stale']);
    expect(c[0].key).toBe('scan:stale');
  });
  it('three missed ticks at the minute-11 check (56 min) is quiet, four (71 min) alerts', () => {
    expect(evaluateScan(scanRuns(56 * MIN), NOW)).toEqual([]);
    expect(evaluateScan(scanRuns(71 * MIN), NOW).map((x) => x.code)).toEqual(['scan_stale']);
  });
  it('no scan rows at all is stale, with no last success', () => {
    const c = evaluateScan([], NOW);
    expect(c.map((x) => x.code)).toEqual(['scan_stale']);
    expect(c[0].lastSuccessAt).toBeNull();
  });
  it('rows with no finished_at are ignored', () => {
    expect(evaluateScan([{ source: 'nws', finished_at: null, error: null }], NOW).map((x) => x.code)).toEqual(['scan_stale']);
  });
  it('the _prune marker row does not count as a scan finishing', () => {
    const runs = [{ source: '_prune', finished_at: ago(MIN), error: null }, ...scanRuns(90 * MIN)];
    expect(evaluateScan(runs, NOW).map((x) => x.code)).toEqual(['scan_stale']);
  });
  it('a matching failure in the latest run is a scan error, with the cleaned text and the last clean run time', () => {
    const runs = [
      ...scanRuns(6 * MIN, null, ['spc']),
      { source: 'nws', finished_at: ago(6 * MIN), error: 'matching failed: relation "holler_profiles" does not exist' },
      ...scanRuns(21 * MIN),
    ];
    const c = evaluateScan(runs, NOW);
    expect(c.map((x) => x.code)).toEqual(['scan_error']);
    expect(c[0].lastError).toContain('matching failed');
    expect(c[0].lastSuccessAt).toBe(ago(21 * MIN));
  });
  it('one source timing out in an otherwise clean run is that source\'s problem, not a scan error', () => {
    const runs = [...scanRuns(6 * MIN, null, ['spc', 'usgs']), { source: 'nws', finished_at: ago(6 * MIN), error: 'timeout' }];
    expect(evaluateScan(runs, NOW)).toEqual([]);
  });
  it('every source in the run failing is a scan error', () => {
    const c = evaluateScan(scanRuns(6 * MIN, 'timeout'), NOW);
    expect(c.map((x) => x.code)).toEqual(['scan_error']);
  });
  // Changed in round 7 (review r4): only the newest run used to count, so an errored run followed by a clean one before the hourly
  // check was never alerted. Now any run since the previous monitor tick (the last 60 minutes) with a run-level error alerts.
  it('an errored run inside the last 60 minutes alerts even when a clean run followed it', () => {
    const runs = [...scanRuns(6 * MIN), ...scanRuns(21 * MIN, 'matching failed: x')];
    const c = evaluateScan(runs, NOW);
    expect(c.map((x) => x.code)).toEqual(['scan_error']);
    expect(c[0].lastError).toContain('matching failed');
    expect(c[0].lastSuccessAt).toBe(ago(6 * MIN));
  });
  it('review r4 repro: clean at :00, matching failed at :15, :30 and :45 of the previous hour, checked at :11', () => {
    const runs = [
      ...scanRuns(11 * MIN),
      { source: 'nws', finished_at: ago(26 * MIN), error: 'matching failed: boom' },
      { source: 'nws', finished_at: ago(41 * MIN), error: 'matching failed: boom' },
      { source: 'nws', finished_at: ago(56 * MIN), error: 'matching failed: boom' },
    ];
    expect(evaluateScan(runs, NOW).map((x) => x.code)).toEqual(['scan_error']);
  });
  it('an error older than the last 60 minutes that cleared is quiet (the previous tick already saw it)', () => {
    expect(evaluateScan([...scanRuns(6 * MIN), ...scanRuns(60 * MIN + 1000, 'matching failed: x')], NOW)).toEqual([]);
    expect(evaluateScan([...scanRuns(6 * MIN), ...scanRuns(60 * MIN, 'matching failed: x')], NOW).map((x) => x.code)).toEqual(['scan_error']);
  });
  it('a single source fetch error is left to the per-source rule, and the scan error text says so', () => {
    const runs = [...scanRuns(6 * MIN, null, ['nws']), { source: 'atl-permits', finished_at: ago(6 * MIN), error: 'HTTP 500' }];
    expect(evaluateScan(runs, NOW)).toEqual([]);
    // A run with only one source due, and that one failing its fetch, is still that source's problem.
    expect(evaluateScan([...scanRuns(6 * MIN), { source: 'nws', finished_at: ago(20 * MIN), error: 'HTTP 503' }], NOW)).toEqual([]);
    const c = evaluateScan([...scanRuns(6 * MIN), ...scanRuns(21 * MIN, 'matching failed: x')], NOW);
    expect(c[0].reason).toMatch(/single source/i);
  });
  it('stale wins over error and carries the error text', () => {
    const c = evaluateScan(scanRuns(2 * H, 'matching failed: boom'), NOW);
    expect(c.map((x) => x.code)).toEqual(['scan_stale']);
    expect(c[0].lastError).toContain('matching failed');
  });
  it('recognizes run-level errors', () => {
    for (const e of ['matching failed: x', 'deadline: scan passed 50 s', 'scan_runs insert failed: x', 'database client unavailable', 'prune: boom'])
      expect(isRunLevelError(e), e).toBe(true);
    for (const e of ['timeout', 'HTTP 503', null, '']) expect(isRunLevelError(e as string | null), String(e)).toBe(false);
  });
  it('the error text is cleaned: no emails or quoted values', () => {
    const c = evaluateScan([{ source: 'nws', finished_at: ago(MIN), error: 'matching failed: bad value "Jane Roe" jane@example.com' }], NOW);
    expect(c[0].lastError).not.toMatch(/Jane|@example/);
  });
});

describe('condition b: whole-feed silence', () => {
  it('zero in 24 hours alerts; one does not; unknown does not', () => {
    expect(evaluateFeed({ newSignals24h: 0, lastNewAt: ago(30 * H) }).map((c) => c.key)).toEqual(['feed:silent']);
    expect(evaluateFeed({ newSignals24h: 1, lastNewAt: null })).toEqual([]);
    expect(evaluateFeed({ newSignals24h: null, lastNewAt: null })).toEqual([]);
  });
  it('carries the last time anything was new', () => {
    expect(evaluateFeed({ newSignals24h: 0, lastNewAt: ago(30 * H) })[0].lastSuccessAt).toBe(ago(30 * H));
  });
});

describe('condition c: one-day sources (nws, spc, usgs, faa, bluesky)', () => {
  const silent = { last_new_at: ago(25 * H), last_record_at: ago(25 * H) };
  it('exactly 24 hours without anything new is not silent; 24 hours and a second, with a failing fetch, is', () => {
    const fail = { consecutive_failures: 1, last_error: 'HTTP 503', rows_seen_last_run: 0 };
    expect(oneDaySourceProblem(health('nws', { ...fail, last_new_at: ago(24 * H), last_record_at: ago(24 * H) }), NOW)).toBeNull();
    expect(oneDaySourceProblem(health('nws', { ...fail, last_new_at: ago(24 * H + 1000), last_record_at: ago(24 * H + 1000) }), NOW)).not.toBeNull();
  });
  it('silent and failing alerts, naming the source and the cleaned error', () => {
    const c = evaluateSources([health('nws', { ...silent, consecutive_failures: 2, last_error: 'HTTP 503', rows_seen_last_run: 0, last_success_at: ago(26 * H) })], NOW);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'source:nws:silent', code: 'source_silent', source: 'nws', lastError: 'HTTP 503', lastSuccessAt: ago(26 * H) });
  });
  it('failing but something new came in the last day is not silent', () => {
    expect(evaluateSources([health('nws', { consecutive_failures: 2, last_error: 'HTTP 503', rows_seen_last_run: 0, last_new_at: ago(3 * H) })], NOW)).toEqual([]);
  });
  it('NO STORM TODAY: a healthy fetch that saw rows and found nothing new is not an alert', () => {
    const quiet = health('nws', { ...silent, rows_seen_last_run: 30, rows_new_last_run: 0, last_rows_seen_at: ago(5 * MIN) });
    expect(evaluateSources([quiet], NOW)).toEqual([]);
  });
  it('NO STORM TODAY: spc returning zero reports on a calm day is not an alert', () => {
    const calm = health('spc', { ...silent, rows_seen_last_run: 0, rows_new_last_run: 0, last_rows_seen_at: ago(40 * H) });
    expect(evaluateSources([calm], NOW)).toEqual([]);
  });
  it('spc still alerts when its fetch is failing', () => {
    expect(evaluateSources([health('spc', { ...silent, consecutive_failures: 1, last_error: 'HTTP 500', rows_seen_last_run: 0 })], NOW)).toHaveLength(1);
  });
  it('usgs, faa and bluesky returning zero rows with no error is not a break (US-only or since-window feeds)', () => {
    for (const id of ['usgs', 'faa', 'bluesky'])
      expect(evaluateSources([health(id, { ...silent, rows_seen_last_run: 0, last_rows_seen_at: ago(40 * H) })], NOW), id).toEqual([]);
  });
  it('nws returning zero rows for more than 24 hours with no error is a break', () => {
    const c = evaluateSources([health('nws', { ...silent, rows_seen_last_run: 0, last_rows_seen_at: ago(25 * H) })], NOW);
    expect(c[0].reason).toMatch(/no rows at all/);
  });
  it('nws zero rows right now but rows seen 2 hours ago is not a break', () => {
    expect(evaluateSources([health('nws', { ...silent, rows_seen_last_run: 0, last_rows_seen_at: ago(2 * H) })], NOW)).toEqual([]);
  });
  it('before 0018 is filled, last_record_at stands in for last_rows_seen_at', () => {
    const noCol = { ...silent, rows_seen_last_run: 0, last_rows_seen_at: null };
    expect(evaluateSources([health('nws', noCol)], NOW)).toHaveLength(1);
    expect(evaluateSources([health('nws', { ...noCol, last_record_at: ago(3 * H) })], NOW)).toEqual([]);
  });
  it('a source that has not run in 24 hours and has nothing new is flagged', () => {
    const c = evaluateSources([health('usgs', { ...silent, last_run_at: ago(26 * H), last_success_at: ago(26 * H) })], NOW);
    expect(c[0].reason).toMatch(/has not run/);
  });
  it('a brand-new source with no records is judged from tracked_since, not flagged on day one', () => {
    const fresh = { last_new_at: null, last_record_at: null, consecutive_failures: 1, last_error: 'HTTP 500', rows_seen_last_run: 0 };
    expect(evaluateSources([health('nws', { ...fresh, tracked_since: ago(3 * H) })], NOW)).toEqual([]);
    expect(evaluateSources([health('nws', { ...fresh, tracked_since: ago(25 * H) })], NOW)).toHaveLength(1);
  });
  it('no timestamps at all means no evidence, so no alert', () => {
    expect(evaluateSources([health('nws', { last_new_at: null, last_record_at: null, tracked_since: null, consecutive_failures: 5, last_error: 'x' })], NOW)).toEqual([]);
  });
  it('falls back to last_record_at when last_new_at is not there yet', () => {
    expect(evaluateSources([health('nws', { last_new_at: null, last_record_at: ago(30 * H), consecutive_failures: 1, last_error: 'x' })], NOW)).toHaveLength(1);
  });
  it('a failing source that is also unavailable by status still follows the one-day rule only', () => {
    expect(evaluateSources([health('nws', { consecutive_failures: 5, last_error: 'x', last_new_at: ago(2 * H) })], NOW)).toEqual([]);
  });
});

describe('condition c: only sources that are enabled right now', () => {
  it('review r4 repro: a switched-off bluesky row last run 10 days ago never alerts', () => {
    const off = health('bluesky', { last_run_at: ago(10 * D), last_success_at: ago(10 * D), last_new_at: ago(10 * D), last_record_at: ago(10 * D) });
    expect(evaluateSources([off], NOW).map((c) => c.key)).toEqual(['source:bluesky:silent']); // no enabled list: old behaviour
    expect(evaluateSources([off], NOW, new Set(['nws', 'spc']))).toEqual([]);
  });
  it('an enabled source with the same row still alerts', () => {
    const row = health('nws', { last_run_at: ago(10 * D), last_success_at: ago(10 * D), last_new_at: ago(10 * D), last_record_at: ago(10 * D) });
    expect(evaluateSources([row], NOW, new Set(['nws'])).map((c) => c.key)).toEqual(['source:nws:silent']);
  });
  it('a source removed from the registry (slow source) never alerts', () => {
    const gone = health('socrata-old-dataset', { last_record_at: ago(300 * D), consecutive_failures: 9, last_error: 'HTTP 404' });
    expect(evaluateSources([gone], NOW, new Set(['nws']))).toEqual([]);
  });
});

describe('condition c: slower sources alert on degraded or unavailable', () => {
  const slow = (over = {}) => health('socrata-chicago-permits', over);
  it('healthy and delayed are quiet', () => {
    expect(evaluateSources([slow()], NOW)).toEqual([]);
    // delayed: no new record for more than 1.5 gaps (7 days) but not more than 3
    expect(evaluateSources([slow({ last_record_at: ago(11 * D) })], NOW)).toEqual([]);
  });
  it('degraded: no new record for more than 3 gaps', () => {
    const c = evaluateSources([slow({ last_record_at: ago(22 * D) })], NOW);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'source:socrata-chicago-permits:status', code: 'source_down', headline: 'socrata-chicago-permits is degraded' });
  });
  it('exactly 3 gaps is not degraded', () => {
    expect(evaluateSources([slow({ last_record_at: ago(21 * D) })], NOW)).toEqual([]);
  });
  it('unavailable: 3 failures in a row, sorted worse than degraded', () => {
    const c = evaluateSources([slow({ consecutive_failures: 3, last_error: 'timeout' }), health('socrata-nyc-311', { last_record_at: ago(30 * D) })], NOW);
    expect(c.map((x) => [x.source, x.severity])).toEqual([['socrata-chicago-permits', 5], ['socrata-nyc-311', 6]]);
  });
  it('2 failures in a row is not an alert yet', () => {
    expect(evaluateSources([slow({ consecutive_failures: 2, last_error: 'timeout' })], NOW)).toEqual([]);
  });
  it('status is recomputed now: a stored healthy row whose last success is 73 hours old is unavailable', () => {
    expect(evaluateSources([slow({ status: 'healthy', last_success_at: ago(73 * H) })], NOW)).toHaveLength(1);
    expect(evaluateSources([slow({ status: 'healthy', last_success_at: ago(72 * H) })], NOW)).toEqual([]);
  });
  it('last error is cleaned again at the edge', () => {
    const c = evaluateSources([slow({ consecutive_failures: 3, last_error: 'failed for "Jane Roe" at jane@example.com' })], NOW);
    expect(c[0].lastError).not.toMatch(/Jane|example/);
  });
  it('annual or federal sources use their own gap (30 days)', () => {
    expect(evaluateSources([health('usaspending', { last_record_at: ago(80 * D) })], NOW)).toEqual([]);
    expect(evaluateSources([health('usaspending', { last_record_at: ago(91 * D) })], NOW)).toHaveLength(1);
  });
});

// Round 7 fix-g2 (verify-v3 P2, commander decision 10): a failed prune raises the scan-error alert.
describe('a failed daily prune (_prune row with an error) is a scan error', () => {
  const prune = (agoMs: number, error: string | null) => ({ source: '_prune', finished_at: ago(agoMs), error });
  it('reviewer repro: clean run 6 minutes ago + a _prune row with an error 5 minutes ago -> scan:error', () => {
    const c = evaluateScan([...scanRuns(6 * MIN), prune(5 * MIN, 'prune failed: relation "public.holler_signal_archive" does not exist')], NOW);
    expect(c.map((x) => [x.key, x.code])).toEqual([['scan:error', 'scan_error']]);
    expect(c[0].reason).toMatch(/prune/);
    expect(c[0].lastError).toMatch(/holler_signal_archive/);
  });
  it('it stays open while that failed prune is the newest one (prunes run once a day), and clears with a newer clean prune', () => {
    expect(evaluateScan([...scanRuns(6 * MIN), prune(20 * H, 'archive failed')], NOW).map((x) => x.key)).toEqual(['scan:error']);
    expect(evaluateScan([...scanRuns(6 * MIN), prune(20 * H, 'archive failed'), prune(10 * MIN, null)], NOW)).toEqual([]);
  });
  it('a clean prune is quiet; a stale scan still wins', () => {
    expect(evaluateScan([...scanRuns(6 * MIN), prune(5 * MIN, null)], NOW)).toEqual([]);
    expect(evaluateScan([...scanRuns(2 * H), prune(5 * MIN, 'x')], NOW).map((x) => x.key)).toEqual(['scan:stale']);
  });
  it('a run-level error in the last hour is reported as itself (one scan:error condition)', () => {
    const c = evaluateScan([...scanRuns(6 * MIN, 'matching failed: boom'), prune(5 * MIN, 'archive failed')], NOW);
    expect(c).toHaveLength(1);
    expect(c[0].lastError).toMatch(/matching failed/);
  });
});
