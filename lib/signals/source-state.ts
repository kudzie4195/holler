/**
 * Source states (PLAN-2.0 item 2.4): is each source delivering what it should, right now? Pure: no database, no clock read, no email.
 *
 * Five states, judged from the SCAN, not from record dates:
 *   healthy      delivering on schedule.
 *   delayed      no successful run for more than 2 cadences ("last update" is old). The source may simply be slow or the scan late.
 *   degraded     the last 3 runs each failed, or each came back with 0 rows from a source that normally returns rows. It is running
 *                but not delivering.
 *   unavailable  no successful run for more than 24 hours (more than 3 cadences when the cadence is over 8 hours), or never run.
 *   not_set_up   the source needs an env key or feature flag that is not set. It is off on purpose and is never called broken.
 *                Member screens say nothing about it (they never promised it); the owner's health email counts it.
 *
 * First match wins, in this order: not_set_up, unavailable, degraded, delayed, healthy.
 *
 * Why not reuse holler_source_health.status (lib/signals/health.ts computeStatus)? That status is about how OLD THE NEWEST RECORD is
 * against a "normal gap" per kind of source (a quiet permit office is fine), and it calls 3 failures in a row "unavailable". This
 * module answers the other question members care about: "has Holler been able to read this source lately?" The two are kept apart on
 * purpose; the stored status column and the ingest monitor are unchanged. Both are shown in the owner JSON.
 *
 * Thresholds are all "more than": exactly on a limit is not past it.
 */

export type SourceState = 'healthy' | 'delayed' | 'degraded' | 'unavailable' | 'not_set_up';

export const SOURCE_STATES: readonly SourceState[] = ['healthy', 'delayed', 'degraded', 'unavailable', 'not_set_up'];

export type StateReason =
  | 'ok'
  | 'not_set_up'
  | 'never_run'
  | 'no_success_yet'
  | 'no_success_24h'
  | 'repeated_errors'
  | 'repeated_empty'
  | 'repeated_trouble'
  | 'behind_cadence';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Delayed: no successful run for more than this many cadences. */
export const DELAYED_CADENCE_FACTOR = 2;
/** Unavailable: no successful run for more than this long... */
export const UNAVAILABLE_MIN_MS = 24 * HOUR;
/** ...or more than this many cadences, whichever is longer. Only matters above an 8 hour cadence (a 12 hour source is delayed from 24 h, unavailable from 36 h), so a slow source is never "unavailable" while it is merely waiting for its next run. */
export const UNAVAILABLE_CADENCE_FACTOR = 3;
/** Degraded: this many most recent runs in a row were failures or empty. */
export const DEGRADED_RUNS = 3;

/** Kinds that return rows on every normal run: weather alerts, permits and city records (311, inspections, licences, violations). */
const ROWS_EVERY_RUN_KINDS = new Set(['alert', 'permit', 'civic']);

/**
 * Does this source normally return rows on every run? Decided from the registry kind and cadence, the same idea as
 * lib/email/health.ts expectsRows, minus storm reports ('report': calm days are empty). A `fetched` count is every row inside the
 * dataset's lookback window (days), so 0 from a permit or 311 source is a real break, not a quiet hour. Sources polled less often
 * than daily are too quiet to judge this way.
 */
export function usuallyReturnsRows(a: { kind: string; cadenceMinutes: number }): boolean {
  return ROWS_EVERY_RUN_KINDS.has(a.kind) && a.cadenceMinutes <= 24 * 60;
}

/** After how long without a successful run is this source unavailable? */
export function unavailableAfterMs(cadenceMinutes: number): number {
  return Math.max(UNAVAILABLE_MIN_MS, UNAVAILABLE_CADENCE_FACTOR * cadenceMinutes * MIN);
}

/** After how long without a successful run is this source delayed? */
export function delayedAfterMs(cadenceMinutes: number): number {
  return DELAYED_CADENCE_FACTOR * cadenceMinutes * MIN;
}

/** One scan run of one source (a holler_scan_runs row). */
export interface RunSample {
  startedAt: string | null;
  /** Rows the source returned. null = not recorded. */
  fetched: number | null;
  /** Error text, or null/empty when the run worked. */
  error: string | null;
}

/** The parts of a holler_source_health row this module reads. */
export interface HealthSample {
  last_success_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  tracked_since?: string | null;
}

export interface SourceStateInput {
  id: string;
  kind: string;
  cadenceMinutes: number;
  /** Env keys or feature flags the adapter needs that are not set (missingEnvFor). */
  missingEnv: readonly string[];
  health: HealthSample | null;
  /** Newest first. Only the first DEGRADED_RUNS matter. */
  recentRuns: readonly RunSample[];
  now: Date;
}

export interface SourceStateResult {
  id: string;
  state: SourceState;
  reason: StateReason;
  /** Newest successful run we know of (the health row or the run log, whichever is later). */
  lastSuccessAt: string | null;
  /** now minus lastSuccessAt, clamped at 0. null when there has been no success. */
  sinceSuccessMs: number | null;
  /** One plain line for the owner: what the rule saw. No row data. */
  detail: string;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function hasError(r: RunSample): boolean {
  return typeof r.error === 'string' && r.error.trim() !== '';
}

/** "9 hours", "35 minutes", "3 days". Rounded; never negative. */
export function agePhrase(ageMs: number): string {
  const mins = Math.max(0, Math.round(ageMs / MIN));
  if (mins < 90) return `${Math.max(1, mins)} ${mins <= 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

export function computeSourceState(i: SourceStateInput): SourceStateResult {
  const nowMs = i.now.getTime();
  const done = (state: SourceState, reason: StateReason, lastSuccess: number | null, detail: string): SourceStateResult => ({
    id: i.id,
    state,
    reason,
    lastSuccessAt: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
    sinceSuccessMs: lastSuccess === null ? null : Math.max(0, nowMs - lastSuccess),
    detail,
  });

  if (i.missingEnv.length > 0) return done('not_set_up', 'not_set_up', null, `needs ${i.missingEnv.join(', ')}`);

  // Newest success we know of: the health row, or the newest run in the log with no error.
  const recent = i.recentRuns.slice(0, DEGRADED_RUNS);
  const candidates = [ms(i.health?.last_success_at), ...i.recentRuns.filter((r) => !hasError(r)).map((r) => ms(r.startedAt))].filter(
    (t): t is number => t !== null,
  );
  const lastSuccess = candidates.length ? Math.max(...candidates) : null;
  const limitUnavailable = unavailableAfterMs(i.cadenceMinutes);

  if (lastSuccess === null) {
    // Never succeeded. With no run and no health row at all there is no evidence the source has ever been read.
    const basisCandidates = [ms(i.health?.tracked_since), ms(i.health?.last_run_at), ...i.recentRuns.map((r) => ms(r.startedAt))].filter(
      (t): t is number => t !== null,
    );
    if (basisCandidates.length === 0) return done('unavailable', 'never_run', null, 'no run recorded');
    const since = nowMs - Math.min(...basisCandidates);
    if (since > limitUnavailable) return done('unavailable', 'no_success_24h', null, `no successful run since it was first tracked (${agePhrase(since)} ago)`);
    return done('degraded', 'no_success_yet', null, 'has run but has not succeeded yet');
  }

  const since = Math.max(0, nowMs - lastSuccess);
  if (since > limitUnavailable) return done('unavailable', 'no_success_24h', lastSuccess, `no successful run for ${agePhrase(since)}`);

  // Degraded: the last 3 runs were each a failure, or empty from a source that normally returns rows.
  const emptyCounts = usuallyReturnsRows(i);
  const isBad = (r: RunSample) => hasError(r) || (emptyCounts && r.fetched === 0);
  if (recent.length >= DEGRADED_RUNS && recent.every(isBad)) {
    const errors = recent.filter(hasError).length;
    const reason: StateReason = errors === recent.length ? 'repeated_errors' : errors === 0 ? 'repeated_empty' : 'repeated_trouble';
    const what = reason === 'repeated_errors' ? 'failed' : reason === 'repeated_empty' ? 'returned no rows' : 'failed or returned no rows';
    return done('degraded', reason, lastSuccess, `the last ${DEGRADED_RUNS} runs ${what}`);
  }
  // The stored failure count covers the case where the run log is too short or too old to show three runs.
  if ((i.health?.consecutive_failures ?? 0) >= DEGRADED_RUNS) {
    return done('degraded', 'repeated_errors', lastSuccess, `${i.health?.consecutive_failures} failed runs in a row`);
  }

  if (since > delayedAfterMs(i.cadenceMinutes)) {
    return done('delayed', 'behind_cadence', lastSuccess, `last successful run ${agePhrase(since)} ago, more than ${DELAYED_CADENCE_FACTOR} cadences`);
  }
  return done('healthy', 'ok', lastSuccess, `last successful run ${agePhrase(since)} ago`);
}

export interface StateAdapter {
  id: string;
  kind: string;
  cadenceMinutes: number;
  missingEnv: readonly string[];
}

export interface ScanRunRow {
  source: string | null;
  started_at: string | null;
  fetched: number | null;
  error: string | null;
}

/** States for every adapter, in the adapters' order. `runs` may be in any order and may include other sources ('_prune' is ignored). */
export function computeSourceStates(input: {
  adapters: readonly StateAdapter[];
  health: ReadonlyArray<HealthSample & { source: string }>;
  runs: readonly ScanRunRow[];
  now: Date;
}): SourceStateResult[] {
  const healthBy = new Map(input.health.map((h) => [h.source, h]));
  const runsBy = new Map<string, RunSample[]>();
  const sorted = [...input.runs]
    .filter((r) => r.source && ms(r.started_at) !== null)
    .sort((a, b) => (ms(b.started_at) as number) - (ms(a.started_at) as number));
  for (const r of sorted) {
    const list = runsBy.get(r.source as string);
    const sample = { startedAt: r.started_at, fetched: r.fetched, error: r.error };
    if (list) {
      if (list.length < DEGRADED_RUNS + 2) list.push(sample);
    } else runsBy.set(r.source as string, [sample]);
  }
  return input.adapters.map((a) =>
    computeSourceState({
      id: a.id,
      kind: a.kind,
      cadenceMinutes: a.cadenceMinutes,
      missingEnv: a.missingEnv,
      health: healthBy.get(a.id) ?? null,
      recentRuns: runsBy.get(a.id) ?? [],
      now: input.now,
    }),
  );
}

export const STATE_LABEL: Record<SourceState, string> = {
  healthy: 'Healthy',
  delayed: 'Delayed',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  not_set_up: 'Not set up yet',
};

/** Smaller is worse. not_set_up is last: it is not a fault. */
export const STATE_SEVERITY: Record<SourceState, number> = { unavailable: 0, degraded: 1, delayed: 2, healthy: 3, not_set_up: 4 };

/** A state that means members may be missing records. */
export function isBehind(state: SourceState): boolean {
  return state === 'delayed' || state === 'degraded' || state === 'unavailable';
}

export interface SourceStateSummary {
  counts: Record<SourceState, number>;
  /** delayed + degraded + unavailable */
  behind: number;
  /** Non-healthy results, worst first (not_set_up included, last). */
  attention: SourceStateResult[];
  total: number;
}

export function summarizeSourceStates(results: readonly SourceStateResult[]): SourceStateSummary {
  const counts: Record<SourceState, number> = { healthy: 0, delayed: 0, degraded: 0, unavailable: 0, not_set_up: 0 };
  for (const r of results) counts[r.state]++;
  const attention = results
    .filter((r) => r.state !== 'healthy')
    .sort((a, b) => STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.id.localeCompare(b.id));
  return { counts, behind: counts.delayed + counts.degraded + counts.unavailable, attention, total: results.length };
}
