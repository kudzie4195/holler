/**
 * Source states (PLAN-2.0 item 2.4): is each source delivering what it should, right now? Pure: no database, no clock read, no email.
 *
 * Five states, judged from the SCAN, not from record dates:
 *   healthy      delivering on schedule.
 *   delayed      no successful run for more than 2 cadences ("last update" is old). The source may simply be slow or the scan late.
 *   degraded     the last 3 runs each failed, or each came back with 0 rows from a source whose OWN recent history shows it
 *                returning rows on most of its runs (see rowsHistory). It is running but not delivering.
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
 * A long stall stays degraded: when the source's own run history no longer shows it (the evidence window slid past the stall), the
 * stored last_rows_seen_at (or last_record_at before migration 0018 fills it) is compared with the source's normal gap between new
 * records (lib/signals/health.ts normalGapDays). A source that has had rows, whose newest runs are all empty or failed, and has had no
 * rows for more than 1.5 normal gaps stays degraded ("no new records since <date>") until rows return. A bursty source (Cobb County)
 * is not judged by the short window, only by this long limit, so it does not false-alarm on ordinary quiet days.
 *
 * Thresholds are all "more than": exactly on a limit is not past it.
 */
import { isStageNote } from './stage';
import { DELAYED_FACTOR as GAP_DELAYED_FACTOR, normalGapDays } from './health';

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

/** Degraded-by-empty needs this much history before the source counts as "usually returns rows": runs older than the current empty streak spanning at least this long... */
export const HISTORY_MIN_SPAN_MS = 24 * HOUR;
/** ...with at least this many error-free runs... */
export const HISTORY_MIN_RUNS = 3;
/** ...of which at least this share returned rows. A source that publishes in bursts (Cobb County) fails this and is never degraded for normal empty runs. */
export const HISTORY_MIN_ROWS_SHARE = 0.5;
/** A stall (newest runs empty or failed, no rows seen) longer than this many normal gaps between new records is degraded whatever the run window shows. */
export const STALL_GAP_FACTOR = GAP_DELAYED_FACTOR;
const DAY_MS = 86_400_000;

/** Runs kept per source for the history check (newest first). 96 hours of a 15 minute source is 384. */
export const MAX_HISTORY_RUNS = 500;

/** Kinds that can return rows on every normal run: weather alerts, permits and city records (311, inspections, licences, violations). Necessary, not sufficient: the history decides. */
const ROWS_EVERY_RUN_KINDS = new Set(['alert', 'permit', 'civic']);

/**
 * Could this source be judged by empty runs at all? From the registry kind and cadence, the same idea as lib/email/health.ts
 * expectsRows, minus storm reports ('report': calm days are empty). Sources polled less often than daily are too quiet to judge this
 * way. Whether it ACTUALLY usually returns rows is decided from its own run history (rowsHistory), not from its kind.
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
  /** Newest record date the source has returned (the record's own date, capped at the run time by the scan). */
  last_record_at?: string | null;
  /** Last successful run that parsed at least one row (migration 0018). Null/absent: no run has seen a row, or 0018 is not applied. */
  last_rows_seen_at?: string | null;
}

export interface SourceStateInput {
  id: string;
  kind: string;
  cadenceMinutes: number;
  /** Env keys or feature flags the adapter needs that are not set (missingEnvFor). */
  missingEnv: readonly string[];
  health: HealthSample | null;
  /** Newest first. The first DEGRADED_RUNS decide errors; the whole list (up to MAX_HISTORY_RUNS) is the history for empty runs. */
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
  /**
   * Newest record date the source actually returned (holler_source_health.last_record_at). This, not the last error-free run, is the
   * "last update" members are told: a source can run cleanly every hour and return nothing for a week. null = never returned a record.
   */
  lastRecordAt: string | null;
  /** How the source's own history looks for rows. null for kinds that are not judged by empty runs. */
  rowsHistory: RowsHistory | null;
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

/**
 *   steady   before its current bad streak the source returned rows on at least half of at least 3 runs spanning 24 hours or more:
 *            an empty run is unusual for it.
 *   bursty   it has returned rows, but not steadily (publishes in bursts, like Cobb County): empty runs are normal.
 *   none     it has run for 24 hours or more and never returned a row.
 *   unknown  not enough history yet.
 */
export type RowsHistory = 'steady' | 'bursty' | 'none' | 'unknown';

function spanMs(runs: readonly RunSample[], cadenceMinutes: number): number {
  const times = runs.map((r) => ms(r.startedAt)).filter((t): t is number => t !== null);
  if (times.length === 0) return 0;
  return Math.max(...times) - Math.min(...times) + cadenceMinutes * MIN;
}

function isBadRun(r: RunSample): boolean {
  return hasError(r) || r.fetched === 0;
}

/**
 * The source's own history of rows, newest run first in `runs`. The current bad streak (the newest runs that failed or came back
 * empty) is left out: it is what is being judged, so it cannot also be the evidence. Error runs are neither rows nor empty.
 */
export function rowsHistoryOf(runs: readonly RunSample[], cadenceMinutes: number): RowsHistory {
  let i = 0;
  while (i < runs.length && isBadRun(runs[i])) i++;
  const older = runs.slice(i).filter((r) => !hasError(r) && r.fetched !== null);
  const enough = (rs: readonly RunSample[]) => rs.length >= HISTORY_MIN_RUNS && spanMs(rs, cadenceMinutes) >= HISTORY_MIN_SPAN_MS;
  if (enough(older)) {
    const withRows = older.filter((r) => (r.fetched ?? 0) > 0).length;
    if (withRows / older.length >= HISTORY_MIN_ROWS_SHARE) return 'steady';
    return 'bursty';
  }
  // Too little before the streak. Over the whole history, if that is long enough: never a row is "none", some rows is "bursty" (rows
  // arrived, then stopped, but not steadily enough to call empty runs a fault). Too short to say: unknown. Neither is ever degraded
  // for empty runs: no evidence, no alarm.
  const all = runs.filter((r) => !hasError(r) && r.fetched !== null);
  if (enough(all)) return all.some((r) => (r.fetched ?? 0) > 0) ? 'bursty' : 'none';
  return 'unknown';
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
  const lastRecord = ms(i.health?.last_record_at);
  const judged = usuallyReturnsRows(i);
  const history: RowsHistory | null = judged ? rowsHistoryOf(i.recentRuns, i.cadenceMinutes) : null;
  const done = (state: SourceState, reason: StateReason, lastSuccess: number | null, detail: string): SourceStateResult => ({
    id: i.id,
    state,
    reason,
    lastSuccessAt: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
    sinceSuccessMs: lastSuccess === null ? null : Math.max(0, nowMs - lastSuccess),
    lastRecordAt: lastRecord === null ? null : new Date(Math.min(lastRecord, nowMs)).toISOString(),
    rowsHistory: history,
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

  // Degraded: the last 3 runs were each a failure, or empty from a source whose own history shows it returning rows steadily. A
  // source that publishes in bursts (or has never returned a row) is not degraded for empty runs.
  const emptyCounts = history === 'steady';
  const isBad = (r: RunSample) => hasError(r) || (emptyCounts && r.fetched === 0);
  if (recent.length >= DEGRADED_RUNS && recent.every(isBad)) {
    const errors = recent.filter(hasError).length;
    const reason: StateReason = errors === recent.length ? 'repeated_errors' : errors === 0 ? 'repeated_empty' : 'repeated_trouble';
    const what = reason === 'repeated_errors' ? 'failed' : reason === 'repeated_empty' ? 'returned no rows' : 'failed or returned no rows';
    return done('degraded', reason, lastSuccess, `the last ${DEGRADED_RUNS} runs ${what}`);
  }
  // A long stall the run window can no longer show: had rows (stored last_rows_seen_at, or last_record_at before 0018), the newest runs
  // are all empty or failed, and no rows for more than 1.5 normal gaps between new records. Only for sources judged by rows.
  if (judged && recent.length >= DEGRADED_RUNS && recent.every((r) => hasError(r) || r.fetched === 0)) {
    const seen = ms(i.health?.last_rows_seen_at) ?? lastRecord;
    if (seen !== null && nowMs - seen > STALL_GAP_FACTOR * normalGapDays(i.id) * DAY_MS) {
      const errors = recent.filter(hasError).length;
      const reason: StateReason = errors === 0 ? 'repeated_empty' : errors === recent.length ? 'repeated_errors' : 'repeated_trouble';
      return done('degraded', reason, lastSuccess, `no rows for ${agePhrase(nowMs - seen)}, more than ${STALL_GAP_FACTOR} normal gaps between new records`);
    }
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
    const sample = { startedAt: r.started_at, fetched: r.fetched, error: isStageNote(r.error) ? null : r.error }; // a stage-query note is not a source failure
    if (list) {
      if (list.length < MAX_HISTORY_RUNS) list.push(sample);
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
  /** Healthy sources that have run for a day or more and never returned a row (rowsHistory 'none'). Not a fault state; the owner should look. */
  quiet: SourceStateResult[];
  total: number;
}

export function summarizeSourceStates(results: readonly SourceStateResult[]): SourceStateSummary {
  const counts: Record<SourceState, number> = { healthy: 0, delayed: 0, degraded: 0, unavailable: 0, not_set_up: 0 };
  for (const r of results) counts[r.state]++;
  const attention = results
    .filter((r) => r.state !== 'healthy')
    .sort((a, b) => STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.id.localeCompare(b.id));
  const quiet = results.filter((r) => r.state === 'healthy' && r.rowsHistory === 'none').sort((a, b) => a.id.localeCompare(b.id));
  return { counts, behind: counts.delayed + counts.degraded + counts.unavailable, attention, quiet, total: results.length };
}
