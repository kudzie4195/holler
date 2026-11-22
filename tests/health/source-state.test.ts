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

const NOW = new Date('2026-11-22T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ok = (agoMs: number, fetched = 10): RunSample => ({ startedAt: ago(agoMs), fetched, error: null });
const bad = (agoMs: number): RunSample => ({ startedAt: ago(agoMs), fetched: 0, error: 'HTTP 503' });
const empty = (agoMs: number): RunSample => ({ startedAt: ago(agoMs), fetched: 0, error: null });

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
  { name: '3 empty runs from a permit source is degraded (live: socrata-la-permits)', in: input(permits, { recentRuns: [empty(2 * H), empty(8 * H), empty(14 * H)], success: 2 * H }), state: 'degraded', reason: 'repeated_empty' },
  { name: 'errors mixed with empty runs is degraded (repeated_trouble)', in: input(permits, { success: 2 * H, recentRuns: [bad(2 * H), empty(8 * H), bad(14 * H)] }), state: 'degraded', reason: 'repeated_trouble' },
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
