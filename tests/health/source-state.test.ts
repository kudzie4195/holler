// Source states (PLAN-2.0 2.4). Table-driven: every row is a source, a clock and what the scan recorded, with the state it must get.
// Inputs are hand-written (assumed) except where a case says it copies a live row (sourced: the Nov 22 2026 snapshot, H-states.md).
import { describe, expect, it } from 'vitest';
import {
  agePhrase,
  computeSourceState,
  computeSourceStates,
  delayedAfterMs,
  isBehind,
  summarizeSourceStates,
  unavailableAfterMs,
  usuallyReturnsRows,
  type RunSample,
  type SourceState,
  type SourceStateInput,
  type StateReason,
} from '@/lib/signals/source-state';
import { expectsRows } from '@/lib/email/health';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceHealthShape } from '../../scripts/source-states-format';

const NOW = new Date('2026-11-22T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ok = (agoMs: number, fetched = 10): RunSample => ({ startedAt: ago(agoMs), fetched, error: null });
const bad = (agoMs: number): RunSample => ({ startedAt: ago(agoMs), fetched: 0, error: 'HTTP 503' });
const empty = (agoMs: number): RunSample => ({ startedAt: ago(agoMs), fetched: 0, error: null });

/** A steady source's earlier history: `n` error-free runs with rows every 6 h, newest `fromAgo` before NOW. Spans 42 h with n=8. */
const steady = (fromAgo: number, n = 8): RunSample[] => Array.from({ length: n }, (_, i) => ok(fromAgo + i * 6 * H, 20));

const nws = { id: 'nws', kind: 'alert', cadenceMinutes: 15 };
const permits = { id: 'socrata-chicago-permits', kind: 'permit', cadenceMinutes: 360 };
const inspections = { id: 'socrata-chicago-inspections', kind: 'civic', cadenceMinutes: 720 };
const awards = { id: 'usaspending', kind: 'contract', cadenceMinutes: 720 };
const spc = { id: 'spc', kind: 'report', cadenceMinutes: 30 };

function input(src: typeof nws, over: Partial<SourceStateInput> & { success?: number | null } = {}): SourceStateInput {
  const { success, ...rest } = over;
  const lastSuccess = success === undefined ? 5 * MIN : success;
  return {
    ...src,
    missingEnv: [],
    health: { last_success_at: lastSuccess === null ? null : ago(lastSuccess), last_run_at: ago(5 * MIN), consecutive_failures: 0 },
    recentRuns: [],
    now: NOW,
    ...rest,
  };
}

interface Row {
  name: string;
  in: SourceStateInput;
  state: SourceState;
  reason: StateReason;
}

const rows: Row[] = [
  // not set up
  { name: 'missing env key is not set up, never broken', in: input(awards, { missingEnv: ['SAM_API_KEY'], health: null }), state: 'not_set_up', reason: 'not_set_up' },
  { name: 'switched-off flag is not set up even with old runs', in: input(awards, { missingEnv: ['HOLLER_BIDS_ENABLED'], recentRuns: [bad(40 * H), bad(41 * H), bad(42 * H)] }), state: 'not_set_up', reason: 'not_set_up' },
  // never run
  { name: 'no health row and no runs is unavailable (never run)', in: input(permits, { health: null, recentRuns: [] }), state: 'unavailable', reason: 'never_run' },
  { name: 'health row with no success and a run just now is degraded, not yet unavailable', in: input(permits, { success: null, recentRuns: [bad(10 * MIN)], health: { last_success_at: null, last_run_at: ago(10 * MIN), consecutive_failures: 1, tracked_since: ago(1 * H) } }), state: 'degraded', reason: 'no_success_yet' },
  { name: 'never succeeded for more than 24 h since tracked is unavailable', in: input(permits, { success: null, recentRuns: [bad(10 * MIN)], health: { last_success_at: null, last_run_at: ago(10 * MIN), consecutive_failures: 2, tracked_since: ago(30 * H) } }), state: 'unavailable', reason: 'no_success_24h' },
  // healthy
  { name: 'nws 5 minutes since success is healthy', in: input(nws, { success: 5 * MIN, recentRuns: [ok(5 * MIN)] }), state: 'healthy', reason: 'ok' },
  { name: 'permits 5 h since success is healthy', in: input(permits, { success: 5 * H, recentRuns: [ok(5 * H)] }), state: 'healthy', reason: 'ok' },
  // delayed: more than 2 cadences, boundary exclusive
  { name: 'nws exactly 30 min (2 cadences) is still healthy', in: input(nws, { success: 30 * MIN, recentRuns: [ok(30 * MIN)] }), state: 'healthy', reason: 'ok' },
  { name: 'nws 30 min + 1 s is delayed', in: input(nws, { success: 30 * MIN + 1000, recentRuns: [ok(30 * MIN + 1000)] }), state: 'delayed', reason: 'behind_cadence' },
  { name: 'permits exactly 12 h is healthy', in: input(permits, { success: 12 * H, recentRuns: [ok(12 * H)] }), state: 'healthy', reason: 'ok' },
  { name: 'permits 12 h + 1 s is delayed', in: input(permits, { success: 12 * H + 1000, recentRuns: [ok(12 * H + 1000)] }), state: 'delayed', reason: 'behind_cadence' },
  { name: 'permits 9 h with the run log empty is healthy (health row alone)', in: input(permits, { success: 9 * H }), state: 'healthy', reason: 'ok' },
  // unavailable: more than 24 h
  { name: 'permits exactly 24 h is delayed, not unavailable', in: input(permits, { success: 24 * H, recentRuns: [ok(24 * H)] }), state: 'delayed', reason: 'behind_cadence' },
  { name: 'permits 24 h + 1 s is unavailable', in: input(permits, { success: 24 * H + 1000, recentRuns: [ok(24 * H + 1000)] }), state: 'unavailable', reason: 'no_success_24h' },
  { name: 'nws 2 days is unavailable', in: input(nws, { success: 48 * H }), state: 'unavailable', reason: 'no_success_24h' },
  // slow cadence: 12 h sources are delayed from 24 h and unavailable only after 36 h
  { name: '12 h source at 13 h is healthy', in: input(inspections, { success: 13 * H }), state: 'healthy', reason: 'ok' },
  { name: '12 h source at 25 h is delayed (not unavailable)', in: input(inspections, { success: 25 * H }), state: 'delayed', reason: 'behind_cadence' },
  { name: '12 h source at exactly 36 h is delayed', in: input(inspections, { success: 36 * H }), state: 'delayed', reason: 'behind_cadence' },
  { name: '12 h source past 36 h is unavailable', in: input(inspections, { success: 36 * H + 1000 }), state: 'unavailable', reason: 'no_success_24h' },
  // degraded: last 3 runs
  { name: '3 errors in a row (success 1 h ago) is degraded', in: input(permits, { success: 1 * H, recentRuns: [bad(10 * MIN), bad(1 * H), bad(2 * H)] }), state: 'degraded', reason: 'repeated_errors' },
  { name: '3 empty runs from a permit source is degraded (live: socrata-la-permits)', in: input(permits, { recentRuns: [empty(2 * H), empty(8 * H), empty(14 * H), ...steady(20 * H)], success: 2 * H }), state: 'degraded', reason: 'repeated_empty' },
  { name: '3 empty runs from a permit source with NO earlier history is not degraded (no evidence it normally returns rows)', in: input(permits, { recentRuns: [empty(2 * H), empty(8 * H), empty(14 * H)], success: 2 * H }), state: 'healthy', reason: 'ok' },
  { name: '3 empty runs from a permit source that only ever returned nothing is not degraded (never a row)', in: input(permits, { recentRuns: Array.from({ length: 12 }, (_, i) => empty(2 * H + i * 6 * H)), success: 2 * H }), state: 'healthy', reason: 'ok' },
  { name: 'bursty source: rows on 2 of 10 earlier runs, then empty, is not degraded (publishes in bursts)', in: input(permits, { recentRuns: [empty(2 * H), empty(8 * H), empty(14 * H), ...[...steady(20 * H, 10)].map((r, i) => (i === 3 || i === 7 ? r : { ...r, fetched: 0 }))], success: 2 * H }), state: 'healthy', reason: 'ok' },
  { name: 'errors mixed with empty runs is degraded (repeated_trouble)', in: input(permits, { success: 2 * H, recentRuns: [bad(2 * H), empty(8 * H), bad(14 * H), ...steady(20 * H)] }), state: 'degraded', reason: 'repeated_trouble' },
  { name: '2 bad runs and 1 good run is not degraded', in: input(permits, { success: 2 * H, recentRuns: [bad(2 * H), ok(8 * H), bad(14 * H)] }), state: 'healthy', reason: 'ok' },
  { name: 'a good newest run clears it (live: cobb permits, rows 5, 0, 0)', in: input(permits, { success: 2 * H, recentRuns: [ok(2 * H, 5), empty(8 * H), empty(14 * H)] }), state: 'healthy', reason: 'ok' },
  { name: 'only 2 runs on record, both bad, is not degraded', in: input(permits, { success: 2 * H, recentRuns: [bad(2 * H), bad(8 * H)] }), state: 'healthy', reason: 'ok' },
  { name: 'zero rows from a source that does not usually return rows is not degraded (storm reports)', in: input(spc, { success: 10 * MIN, recentRuns: [empty(10 * MIN), empty(40 * MIN), empty(70 * MIN)] }), state: 'healthy', reason: 'ok' },
  { name: 'zero rows from awards (contract kind) is not degraded', in: input(awards, { success: 2 * H, recentRuns: [empty(2 * H), empty(14 * H), empty(26 * H)] }), state: 'healthy', reason: 'ok' },
  { name: 'one error among zero-row runs on awards is not degraded (live: usaspending, 0 / error / 0)', in: input(awards, { success: 8 * H, recentRuns: [empty(8 * H), bad(20 * H), empty(32 * H)] }), state: 'healthy', reason: 'ok' },
  { name: '3 errors on a source that does not usually return rows IS degraded (errors always count)', in: input(awards, { success: 2 * H, recentRuns: [bad(2 * H), bad(14 * H), bad(26 * H)] }), state: 'degraded', reason: 'repeated_errors' },
  { name: 'stored failure count of 3 with no run log is degraded', in: input(permits, { success: 2 * H, health: { last_success_at: ago(2 * H), last_run_at: ago(10 * MIN), consecutive_failures: 3 } }), state: 'degraded', reason: 'repeated_errors' },
  { name: 'errors do not outrank unavailable: 3 errors and no success for 30 h', in: input(permits, { success: 30 * H, recentRuns: [bad(1 * H), bad(7 * H), bad(13 * H)] }), state: 'unavailable', reason: 'no_success_24h' },
  { name: 'degraded outranks delayed: 3 errors and 13 h since success', in: input(permits, { success: 13 * H, recentRuns: [bad(1 * H), bad(7 * H), bad(13 * H)] }), state: 'degraded', reason: 'repeated_errors' },
  // clocks
  { name: 'a success time in the future is clamped, healthy', in: input(nws, { success: -10 * MIN }), state: 'healthy', reason: 'ok' },
  { name: 'the newer of the health row and the run log wins', in: input(nws, { success: 3 * H, recentRuns: [ok(10 * MIN)] }), state: 'healthy', reason: 'ok' },
];

describe('computeSourceState (table)', () => {
  it.each(rows)('$name', (r) => {
    const out = computeSourceState(r.in);
    expect({ state: out.state, reason: out.reason }).toEqual({ state: r.state, reason: r.reason });
  });

  it('reports the newest record date, capped at now, and null when the source never returned one', () => {
    const withRecord = (last_record_at: string | null) =>
      computeSourceState(input(permits, { health: { last_success_at: ago(1 * H), last_run_at: ago(1 * H), consecutive_failures: 0, last_record_at } }));
    expect(withRecord(ago(3 * 24 * H)).lastRecordAt).toBe(ago(3 * 24 * H));
    expect(withRecord(ago(-5 * H)).lastRecordAt).toBe(NOW.toISOString());
    expect(withRecord(null).lastRecordAt).toBeNull();
    expect(computeSourceState(input(permits, { health: null })).lastRecordAt).toBeNull();
  });
  it('the record date is independent of the last clean run: a clean run just now does not move it', () => {
    const out = computeSourceState(input(permits, { success: 5 * MIN, recentRuns: [ok(5 * MIN, 3)], health: { last_success_at: ago(5 * MIN), last_run_at: ago(5 * MIN), consecutive_failures: 0, last_record_at: ago(40 * H) } }));
    expect(out.lastSuccessAt).toBe(ago(5 * MIN));
    expect(out.lastRecordAt).toBe(ago(40 * H));
  });
  it('reports the last success and its age', () => {
    const out = computeSourceState(input(permits, { success: 9 * H }));
    expect(out.lastSuccessAt).toBe(ago(9 * H));
    expect(out.sinceSuccessMs).toBe(9 * H);
  });
  it('never-run has no last success', () => {
    const out = computeSourceState(input(permits, { health: null }));
    expect(out.lastSuccessAt).toBeNull();
    expect(out.sinceSuccessMs).toBeNull();
  });
  it('detail never carries run error text', () => {
    const out = computeSourceState(input(permits, { success: 1 * H, recentRuns: [{ startedAt: ago(1 * H), fetched: 0, error: 'secret row data 555-1234' }, bad(7 * H), bad(13 * H)] }));
    expect(out.detail).not.toMatch(/secret|555/);
  });
});

describe('thresholds', () => {
  it('delayed after 2 cadences, unavailable after max(24 h, 3 cadences)', () => {
    expect(delayedAfterMs(15)).toBe(30 * MIN);
    expect(delayedAfterMs(720)).toBe(24 * H);
    expect(unavailableAfterMs(15)).toBe(24 * H);
    expect(unavailableAfterMs(360)).toBe(24 * H);
    expect(unavailableAfterMs(480)).toBe(24 * H);
    expect(unavailableAfterMs(720)).toBe(36 * H);
  });
  it('delayed always comes before unavailable', () => {
    for (const c of [15, 30, 180, 360, 720, 1440]) expect(delayedAfterMs(c)).toBeLessThan(unavailableAfterMs(c));
  });
  it('usuallyReturnsRows matches lib/email/health expectsRows except storm reports', () => {
    for (const kind of ['alert', 'report', 'permit', 'civic', 'contract', 'event', 'ask', 'travel', 'quake', 'disaster']) {
      for (const cadenceMinutes of [15, 360, 1440, 2880]) {
        const mine = usuallyReturnsRows({ kind, cadenceMinutes });
        expect(mine).toBe(kind === 'report' ? false : expectsRows({ kind, cadenceMinutes }));
      }
    }
  });
});

describe('computeSourceStates', () => {
  const adapters = [
    { ...nws, missingEnv: [] as string[] },
    { ...permits, missingEnv: [] as string[] },
    { ...awards, id: 'sam-gov', missingEnv: ['SAM_API_KEY'] },
    { ...permits, id: 'socrata-la-permits', missingEnv: [] as string[] },
  ];
  it('joins health rows and runs per source, in any order, ignoring _prune and unknown sources', () => {
    const out = computeSourceStates({
      adapters,
      health: [
        { source: 'nws', last_success_at: ago(5 * MIN), last_run_at: ago(5 * MIN), consecutive_failures: 0 },
        { source: 'socrata-chicago-permits', last_success_at: ago(20 * H), last_run_at: ago(1 * H), consecutive_failures: 0 },
        { source: 'socrata-la-permits', last_success_at: ago(2 * H), last_run_at: ago(2 * H), consecutive_failures: 0 },
      ],
      runs: [
        ...steady(20 * H).map((r) => ({ source: 'socrata-la-permits', started_at: r.startedAt, fetched: r.fetched, error: null })),
        { source: 'socrata-la-permits', started_at: ago(14 * H), fetched: 0, error: null },
        { source: '_prune', started_at: ago(1 * MIN), fetched: 0, error: null },
        { source: 'socrata-la-permits', started_at: ago(2 * H), fetched: 0, error: null },
        { source: 'gone-source', started_at: ago(1 * MIN), fetched: 4, error: null },
        { source: 'socrata-la-permits', started_at: ago(8 * H), fetched: 0, error: null },
        { source: 'nws', started_at: ago(5 * MIN), fetched: 21, error: null },
      ],
      now: NOW,
    });
    expect(out.map((r) => [r.id, r.state])).toEqual([
      ['nws', 'healthy'],
      ['socrata-chicago-permits', 'delayed'],
      ['sam-gov', 'not_set_up'],
      ['socrata-la-permits', 'degraded'],
    ]);
  });
  it('an adapter with nothing recorded is never-run unavailable', () => {
    const out = computeSourceStates({ adapters: [adapters[1]], health: [], runs: [], now: NOW });
    expect(out[0]).toMatchObject({ state: 'unavailable', reason: 'never_run' });
  });
});

describe('summary and labels', () => {
  it('counts every state, lists non-healthy worst first, and isBehind excludes not_set_up', () => {
    const results = computeSourceStates({
      adapters: [
        { ...nws, missingEnv: [] },
        { ...permits, missingEnv: [] },
        { ...inspections, missingEnv: [] },
        { ...awards, missingEnv: ['X'] },
        { ...permits, id: 'p2', missingEnv: [] },
      ],
      health: [
        { source: 'nws', last_success_at: ago(5 * MIN), last_run_at: ago(5 * MIN), consecutive_failures: 0 },
        { source: 'socrata-chicago-permits', last_success_at: ago(30 * H), last_run_at: ago(1 * H), consecutive_failures: 0 },
        { source: 'socrata-chicago-inspections', last_success_at: ago(25 * H), last_run_at: ago(1 * H), consecutive_failures: 0 },
      ],
      runs: [],
      now: NOW,
    });
    const s = summarizeSourceStates(results);
    expect(s.counts).toEqual({ healthy: 1, delayed: 1, degraded: 0, unavailable: 2, not_set_up: 1 });
    expect(s.behind).toBe(3);
    expect(s.attention.map((r) => r.state)).toEqual(['unavailable', 'unavailable', 'delayed', 'not_set_up']);
    expect(isBehind('not_set_up')).toBe(false);
    expect(isBehind('healthy')).toBe(false);
    for (const st of ['delayed', 'degraded', 'unavailable'] as const) expect(isBehind(st)).toBe(true);
  });
  it('agePhrase', () => {
    expect(agePhrase(30 * 1000)).toBe('1 minute');
    expect(agePhrase(35 * MIN)).toBe('35 minutes');
    expect(agePhrase(89 * MIN)).toBe('89 minutes');
    expect(agePhrase(9 * H)).toBe('9 hours');
    expect(agePhrase(1.2 * H * 1)).toBe('72 minutes');
    expect(agePhrase(60 * H)).toBe('3 days');
    expect(agePhrase(-5)).toBe('1 minute');
  });
});

// The real run pattern (sourced: read-only selects on holler_scan_runs, Nov 18 to Nov 22 2026, scripts/fixtures/source-states-live/).
// Every scan time in the fixture is replayed as "now" (plus 5 minutes): the state the source would have shown at that moment.
describe('replaying the real Cobb, LA, Kansas City and Oakland run history', () => {
  const dir = join(__dirname, '..', '..', 'scripts', 'fixtures', 'source-states-live');
  const { health, runs } = readSourceHealthShape(readFileSync(join(dir, 'health.psv'), 'utf8'), readFileSync(join(dir, 'runs.psv'), 'utf8'));
  const kinds: Record<string, { kind: string; cadenceMinutes: number }> = {
    'arcgis-cobb-residential-permits': { kind: 'permit', cadenceMinutes: 360 },
    'arcgis-cobb-commercial-permits': { kind: 'permit', cadenceMinutes: 360 },
    'arcgis-cobb-multiunit-permits': { kind: 'permit', cadenceMinutes: 360 },
    'socrata-la-permits': { kind: 'permit', cadenceMinutes: 360 },
    'socrata-kansascity-311': { kind: 'civic', cadenceMinutes: 180 },
    'socrata-oakland-311': { kind: 'civic', cadenceMinutes: 180 },
    'socrata-batonrouge-311': { kind: 'civic', cadenceMinutes: 180 },
    'socrata-austin-inspections': { kind: 'civic', cadenceMinutes: 720 },
    'socrata-cincinnati-311': { kind: 'civic', cadenceMinutes: 180 },
  };
  // `now` may be later than the last scan in the fixture (Nov 22 03:30): the source then keeps running every cadence and returns nothing
  // new, which is exactly what a stalled source does. Runs older than the loader's 14-day lookback are dropped, as the loader does.
  const replay = (id: string, now: Date) => {
    const cadenceMs = kinds[id].cadenceMinutes * MIN;
    const real = runs.filter((r) => r.source === id && Date.parse(r.started_at as string) <= now.getTime());
    const lastReal = Math.max(...runs.filter((r) => r.source === id).map((r) => Date.parse(r.started_at as string)));
    const extra: typeof runs = [];
    for (let t = lastReal + cadenceMs; t <= now.getTime(); t += cadenceMs) extra.push({ source: id, started_at: new Date(t).toISOString(), fetched: 0, error: null });
    const all = [...real, ...extra]
      .filter((r) => Date.parse(r.started_at as string) >= now.getTime() - 14 * 24 * H)
      .sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string));
    const h = health.find((x) => x.source === id)!;
    const newest = all.length ? (all[0].started_at as string) : null;
    // What the scan stores: the newest run with rows (last_rows_seen_at), from every run since the source was tracked.
    const seen = [...real, ...extra].filter((r) => (r.fetched ?? 0) > 0).sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string))[0];
    const [r] = computeSourceStates({
      adapters: [{ id, ...kinds[id], missingEnv: [] }],
      health: [{ ...h, last_success_at: newest, last_run_at: newest, last_rows_seen_at: seen ? (seen.started_at as string) : null }],
      runs: all,
      now,
    });
    return r;
  };
  const scanTimes = (id: string) => runs.filter((r) => r.source === id).map((r) => new Date(Date.parse(r.started_at as string) + 5 * MIN));
  const at = (iso: string) => new Date(iso);

  it('the fixture holds the full history for these sources', () => {
    for (const id of Object.keys(kinds)) expect(runs.filter((r) => r.source === id).length).toBeGreaterThanOrEqual(8);
    expect(runs.filter((r) => r.source === 'arcgis-cobb-residential-permits')).toHaveLength(12);
  });

  it('the Cobb layers are never "not updating reliably" at any scan in the history: empty runs are normal for them', () => {
    for (const id of ['arcgis-cobb-residential-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits']) {
      for (const t of scanTimes(id)) {
        const r = replay(id, t);
        expect({ id, at: t.toISOString(), state: r.state }).toEqual({ id, at: t.toISOString(), state: 'healthy' });
      }
    }
  });
  it('Cobb at Nov 21 15:35 UTC (seven empty runs in a row on commercial, nine on residential) is healthy, and says its record date', () => {
    for (const id of ['arcgis-cobb-residential-permits', 'arcgis-cobb-commercial-permits']) {
      const r = replay(id, at('2026-11-21T15:35:00Z'));
      expect(r.state).toBe('healthy');
      expect(r.reason).toBe('ok');
    }
    expect(replay('arcgis-cobb-commercial-permits', at('2026-11-21T15:35:00Z')).rowsHistory).toBe('bursty');
  });
  it('the Cobb layers are Healthy now (rows on the last two runs) with the record date as their last update', () => {
    const r = replay('arcgis-cobb-residential-permits', at('2026-11-22T03:35:43Z'));
    expect(r).toMatchObject({ state: 'healthy', lastRecordAt: '2026-11-18T00:00:00.000Z' });
  });

  it('LA permits: healthy through the first two empty runs, degraded from the third (Nov 22 00:30), with its record date of Nov 14', () => {
    expect(replay('socrata-la-permits', at('2026-11-21T12:35:00Z')).state).toBe('healthy'); // 1 empty
    expect(replay('socrata-la-permits', at('2026-11-21T18:35:00Z')).state).toBe('healthy'); // 2 empty
    const r = replay('socrata-la-permits', at('2026-11-22T00:35:00Z')); // 3 empty after 13 runs with rows
    expect(r).toMatchObject({ state: 'degraded', reason: 'repeated_empty', rowsHistory: 'steady', lastRecordAt: '2026-11-14T08:00:00.000Z' });
  });
  it('Kansas City 311: steady (16 runs with rows) then empty: degraded from the third empty run (Nov 20 00:30)', () => {
    expect(replay('socrata-kansascity-311', at('2026-11-19T21:35:00Z')).state).toBe('healthy'); // 2 empty
    expect(replay('socrata-kansascity-311', at('2026-11-20T00:35:00Z'))).toMatchObject({ state: 'degraded', reason: 'repeated_empty' });
    expect(replay('socrata-kansascity-311', at('2026-11-22T03:35:43Z'))).toMatchObject({ state: 'degraded', lastRecordAt: '2026-11-16T16:02:00.000Z' });
  });
  it('Oakland 311: degraded from the third empty run (Nov 19 15:30) after a steady day of rows', () => {
    expect(replay('socrata-oakland-311', at('2026-11-19T12:35:00Z')).state).toBe('healthy'); // 2 empty
    expect(replay('socrata-oakland-311', at('2026-11-19T15:35:00Z'))).toMatchObject({ state: 'degraded', reason: 'repeated_empty', rowsHistory: 'steady' });
  });

  it('Baton Rouge 311 and Austin inspections never returned a row: healthy, flagged "none" so the owner email can list them as quiet', () => {
    for (const id of ['socrata-batonrouge-311', 'socrata-austin-inspections']) {
      const r = replay(id, at('2026-11-22T03:35:43Z'));
      expect(r).toMatchObject({ state: 'healthy', rowsHistory: 'none', lastRecordAt: null });
    }
    const sum = summarizeSourceStates([replay('socrata-batonrouge-311', at('2026-11-22T03:35:43Z')), replay('socrata-kansascity-311', at('2026-11-22T03:35:43Z'))]);
    expect(sum.quiet.map((q) => q.id)).toEqual(['socrata-batonrouge-311']);
    expect(sum.counts.degraded).toBe(1);
  });
  it('Cincinnati 311 (three days of zeros, then 70 rows a run) is healthy throughout', () => {
    for (const t of scanTimes('socrata-cincinnati-311')) expect(replay('socrata-cincinnati-311', t).state).toBe('healthy');
  });

  describe('a long stall stays degraded after the evidence window slides past it', () => {
    // Kansas City 311: rows on every run until Nov 19 15:30, then nothing; last record Nov 16. On the first redo it read Healthy by
    // Nov 23 12:00 (its steady stretch left the 96 h window). Clocks: Nov 23 12:00, Nov 30 12:00, Dec 5 12:00, Dec 20 12:00.
    const clocks = ['2026-11-23T12:00:00Z', '2026-11-30T12:00:00Z', '2026-12-05T12:00:00Z', '2026-12-20T12:00:00Z'];
    it.each(clocks)('Kansas City 311 stays degraded at %s with no new record since Nov 16', (clock) => {
      const r = replay('socrata-kansascity-311', at(clock));
      expect(r).toMatchObject({ state: 'degraded', reason: 'repeated_empty', lastRecordAt: '2026-11-16T16:02:00.000Z' });
    });
    it.each(clocks)('LA permits stays degraded at %s (no new record since Nov 14)', (clock) => {
      const r = replay('socrata-la-permits', at(clock));
      expect(r).toMatchObject({ state: 'degraded', reason: 'repeated_empty', lastRecordAt: '2026-11-14T08:00:00.000Z' });
    });
    it.each(clocks)('Oakland 311 stays degraded at %s (no new record since Nov 16)', (clock) => {
      const r = replay('socrata-oakland-311', at(clock));
      expect(r).toMatchObject({ state: 'degraded', reason: 'repeated_empty', lastRecordAt: '2026-11-16T06:30:35.000Z' });
    });
    it('the member notice for the stalled source keeps the honest wording at every clock', () => {
      for (const clock of clocks) {
        const r = replay('socrata-kansascity-311', at(clock));
        const n = coverageNotice({
          lat: 39.1, lon: -94.58, trades: [], now: Date.parse(clock),
          states: { 'socrata-kansascity-311': { state: r.state, reason: r.reason, lastRecordAt: r.lastRecordAt } },
        });
        expect(n?.line ?? '').toContain('no new records since Nov 16');
      }
    });
    it('the persisted rule alone (no run window evidence) keeps a had-rows source degraded past 1.5 normal gaps, and not before', () => {
      // permits normal gap 7 days: limit 10.5 days since rows were last seen.
      const stalled = (daysSince: number, lastRows: string | null = ago(daysSince * 24 * H)) =>
        computeSourceState(
          input(permits, {
            success: 1 * H,
            recentRuns: [empty(1 * H), empty(7 * H), empty(13 * H)],
            health: { last_success_at: ago(1 * H), last_run_at: ago(1 * H), consecutive_failures: 0, last_rows_seen_at: lastRows, last_record_at: ago((daysSince + 3) * 24 * H) },
          }),
        );
      expect(stalled(10).state).toBe('healthy');
      expect(stalled(10.5).state).toBe('healthy'); // exactly on the limit is not past it
      expect(stalled(11)).toMatchObject({ state: 'degraded', reason: 'repeated_empty' });
      // Before migration 0018 fills last_rows_seen_at, last_record_at stands in.
      expect(stalled(11, null).state).toBe('degraded');
      expect(stalled(6, null).state).toBe('healthy');
      // A source that never had rows is never judged this way.
      const never = computeSourceState(input(permits, { success: 1 * H, recentRuns: [empty(1 * H), empty(7 * H), empty(13 * H)], health: { last_success_at: ago(1 * H), last_run_at: ago(1 * H), consecutive_failures: 0, last_rows_seen_at: null, last_record_at: null } }));
      expect(never.state).toBe('healthy');
    });
    it('a source that is not judged by rows (storm reports, awards) is never degraded by the persisted rule', () => {
      const old = ago(40 * 24 * H);
      for (const src of [spc, awards]) {
        const r = computeSourceState(input(src, { success: 1 * H, recentRuns: [empty(1 * H), empty(2 * H), empty(3 * H)], health: { last_success_at: ago(1 * H), last_run_at: ago(1 * H), consecutive_failures: 0, last_rows_seen_at: old, last_record_at: old } }));
        expect(r.state).toBe('healthy');
      }
    });
    it('a recent row clears it: the persisted rule needs the newest runs to be empty or failed', () => {
      const r = computeSourceState(input(permits, { success: 1 * H, recentRuns: [ok(1 * H, 4), empty(7 * H), empty(13 * H)], health: { last_success_at: ago(1 * H), last_run_at: ago(1 * H), consecutive_failures: 0, last_rows_seen_at: ago(1 * H), last_record_at: ago(20 * 24 * H) } }));
      expect(r.state).toBe('healthy');
    });
    it('Cobb (bursty) never false-alarms on its ordinary quiet stretches, even replayed forward 8 days with nothing new', () => {
      for (const id of ['arcgis-cobb-residential-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits']) {
        for (const clock of ['2026-11-23T12:00:00Z', '2026-11-30T12:00:00Z']) {
          const r = replay(id, at(clock));
          expect({ id, clock, state: r.state }).toEqual({ id, clock, state: 'healthy' });
        }
      }
    });
    it('Cobb after 13 days with no rows at all is flagged (no new records since Nov 22): past 1.5 normal gaps is not a quiet stretch', () => {
      expect(replay('arcgis-cobb-commercial-permits', at('2026-12-05T12:00:00Z'))).toMatchObject({ state: 'degraded', reason: 'repeated_empty' });
    });
    it('sources that never returned a row stay healthy and quiet at every clock', () => {
      for (const id of ['socrata-batonrouge-311', 'socrata-austin-inspections']) {
        for (const clock of clocks) expect(replay(id, at(clock))).toMatchObject({ state: 'healthy', rowsHistory: 'none' });
      }
    });
    it('Cincinnati 311 (days of zeros, then 70 rows a run, then 8 quiet days) is still healthy: under 1.5 normal gaps', () => {
      const r = replay('socrata-cincinnati-311', at('2026-11-30T12:00:00Z'));
      expect(r.state).toBe('healthy');
    });
  });
});
