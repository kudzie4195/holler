import { isStageNote } from '../signals/stage';
import { computeStatus, normalGapDays, sanitizeHealthError, type SourceHealthRow } from '../signals/health';

/**
 * Ingest monitor rules. Everything here is pure: no database, no clock reads, no email. lib/monitor/run.ts feeds it rows.
 * Every limit is "more than", never "at least" (exactly on a limit is not past it), the same as lib/signals/health.ts.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The scan is scheduled every 15 minutes (supabase/cron.sql: holler-scan, every 15 minutes), not hourly. The fastest sources (nws,
 * spc) are due on every tick, so every healthy tick logs at least one holler_scan_runs row. Four ticks in a row with nothing logged
 * is an hour of silence, so "no scan finished in more than 60 minutes" alerts. The monitor runs at minute 11 of each hour: with three
 * missed ticks the newest run is 56 minutes old at the check (no alert), with four it is 71 (alert).
 */
export const SCAN_TICK_MINUTES = 15;
export const SCAN_STALE_TICKS = 4;
export const SCAN_STALE_MS = SCAN_TICK_MINUTES * SCAN_STALE_TICKS * MIN;
/** No new signals from any source in more than this long. */
export const FEED_SILENCE_MS = DAY;
/** A one-day source with nothing new for more than this long, and a broken fetch, alerts. */
export const SOURCE_SILENCE_MS = DAY;
/** An alert key is emailed when it first appears, then at most once in this long while it lasts. */
export const RESEND_MS = DAY;
/**
 * scan_error looks at every run that finished since the previous monitor tick: the monitor runs hourly (minute 11), so the last 60
 * minutes. An errored run followed by a clean one before the check still alerts.
 */
export const SCAN_ERROR_WINDOW_MS = 60 * MIN;
/** How far back the route reads scan runs. Also the longest "last success" the email can name. */
export const SCAN_LOOKBACK_MS = DAY;

/**
 * One-day sources whose healthy feed can legitimately return zero parsed rows for a whole day, so "zero rows seen" is not evidence
 * of a break for them (SPC storm reports on a calm day; USGS quakes are filtered to places we serve; FAA delay notices on a clear day;
 * Bluesky only searches since the last run). They still alert when the fetch itself is failing. Only nws is left: the national active
 * alert list is never empty for a day, so zero rows there is a break.
 */
export const ZERO_ROWS_IS_NORMAL = new Set(['spc', 'usgs', 'faa', 'bluesky']);

export type ConditionCode = 'scan_stale' | 'scan_error' | 'feed_silent' | 'source_silent' | 'source_down';

export interface Condition {
  /** Stable alert key, the primary key of holler_ops_alerts. */
  key: string;
  code: ConditionCode;
  /** Lower is worse. */
  severity: number;
  /** Source id, or 'scan' / 'feed' for the whole pipeline. */
  source: string;
  /** Short name used in the subject, for example "scan error" or "nws has gone quiet". */
  headline: string;
  /** One plain sentence saying what is wrong. No row data. */
  reason: string;
  lastSuccessAt: string | null;
  /** Already cleaned by sanitizeHealthError. Never raw. */
  lastError: string | null;
}

export interface ScanRunRow {
  source: string | null;
  finished_at: string | null;
  error: string | null;
}

function t(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

/** Errors that mean the pipeline itself failed, not one outside feed having a bad day. */
const RUN_LEVEL_ERROR = /^(matching failed|deadline:|database client unavailable|prune:)|(insert|upsert|write|read) failed/i;

export function isRunLevelError(error: string | null): boolean {
  return !!error && RUN_LEVEL_ERROR.test(error.trim());
}

interface RunGroup {
  finishedMs: number;
  rows: ScanRunRow[];
}

/** Rows of one scan share one finished_at. The '_prune' marker is logged later by its own insert, so it is left out. */
function groupRuns(rows: ScanRunRow[]): RunGroup[] {
  const by = new Map<number, ScanRunRow[]>();
  for (const r of rows) {
    if (r.source === '_prune' || r.source?.startsWith('_')) continue; // markers (_prune, _fc:<source> credit ledger) are not scan sources
    const f = t(r.finished_at);
    if (f === null) continue;
    const row = isStageNote(r.error) ? { ...r, error: null } : r; // a stage-query note is not a source or run failure
    const list = by.get(f);
    if (list) list.push(row);
    else by.set(f, [row]);
  }
  return [...by.entries()].map(([finishedMs, g]) => ({ finishedMs, rows: g })).sort((a, b) => b.finishedMs - a.finishedMs);
}

/**
 * A run-level error: one row names a pipeline failure (matching failed, a store or log write failed, the run itself failed), or every
 * source in a run of two or more failed (database or network down). A single source's fetch error (HTTP 500, timeout) is NOT a scan
 * error: the per-source rules (evaluateSources) report a source whose fetches keep failing.
 */
function groupError(g: RunGroup): boolean {
  const errored = g.rows.filter((r) => r.error);
  if (errored.length === 0) return false;
  return (g.rows.length > 1 && errored.length === g.rows.length) || errored.some((r) => isRunLevelError(r.error));
}

function firstError(g: RunGroup): string | null {
  const e = g.rows.find((r) => isRunLevelError(r.error))?.error ?? g.rows.find((r) => r.error)?.error ?? null;
  return e ? sanitizeHealthError(e) : null;
}

/**
 * Condition a: scan error or scan stale.
 *   scan_stale: nothing finished in more than SCAN_STALE_MS (or no finished run in the rows given).
 *   scan_error: any run that finished in the last SCAN_ERROR_WINDOW_MS (since the previous monitor tick) had a run-level error
 *               (see groupError). A single source's fetch error is left to the per-source rules.
 * Stale wins when both are true (the error text rides along on the stale condition).
 */
export function evaluateScan(runs: ScanRunRow[], now: Date): Condition[] {
  const groups = groupRuns(runs);
  const newest = groups[0];
  const nowMs = now.getTime();
  const lastClean = groups.find((g) => !groupError(g));
  const lastSuccessAt = lastClean ? new Date(lastClean.finishedMs).toISOString() : null;
  if (!newest || nowMs - newest.finishedMs > SCAN_STALE_MS) {
    return [
      {
        key: 'scan:stale',
        code: 'scan_stale',
        severity: 1,
        source: 'scan',
        headline: 'scan has stopped',
        reason: `No scan has finished in more than ${SCAN_STALE_TICKS * SCAN_TICK_MINUTES} minutes. It should run every ${SCAN_TICK_MINUTES}.`,
        lastSuccessAt,
        lastError: newest && groupError(newest) ? firstError(newest) : null,
      },
    ];
  }
  const erroredRecent = groups.find((g) => nowMs - g.finishedMs <= SCAN_ERROR_WINDOW_MS && groupError(g));
  const prune = failedPrune(runs);
  if (!erroredRecent && prune) {
    // verify-v3 P2: the daily prune fails closed (nothing deleted when the archive step fails), so a failed prune means old signals
    // pile up with no other sign. It stays an alert until a newer prune is clean (at most one prune a day, in the rows read).
    return [
      {
        key: 'scan:error',
        code: 'scan_error',
        severity: 2,
        source: 'scan',
        headline: 'scan error',
        reason: 'The daily prune of old signals failed, so nothing was archived or deleted. Old signals will pile up until it runs cleanly.',
        lastSuccessAt,
        lastError: sanitizeHealthError(prune),
      },
    ];
  }
  if (erroredRecent) {
    return [
      {
        key: 'scan:error',
        code: 'scan_error',
        severity: 2,
        source: 'scan',
        headline: 'scan error',
        reason:
          'A scan in the last hour failed as a whole (matching, storing or the run itself), so new signals may not be reaching members. A single source failing its fetch is not counted here; the source checks report that.',
        lastSuccessAt,
        lastError: firstError(erroredRecent),
      },
    ];
  }
  return [];
}

/**
 * The error of the newest '_prune' marker row (lib/signals/store.ts pruneOldSignals logs one per prune, with the delete or archive
 * error), or null when the newest prune was clean or none is in the rows given.
 */
function failedPrune(runs: ScanRunRow[]): string | null {
  let newest: ScanRunRow | null = null;
  let newestMs = -Infinity;
  for (const r of runs) {
    if (r.source !== '_prune') continue;
    const f = t(r.finished_at);
    if (f !== null && f > newestMs) {
      newest = r;
      newestMs = f;
    }
  }
  return newest?.error ? newest.error : null;
}

/** Condition b: zero new signals from all sources in more than 24 hours. `null` means the count could not be read: no alert. */
export function evaluateFeed(input: { newSignals24h: number | null; lastNewAt: string | null }): Condition[] {
  if (input.newSignals24h === null || input.newSignals24h > 0) return [];
  return [
    {
      key: 'feed:silent',
      code: 'feed_silent',
      severity: 3,
      source: 'feed',
      headline: 'no new signals in 24 hours',
      reason: 'No source has stored a new signal in the last 24 hours.',
      lastSuccessAt: input.lastNewAt,
      lastError: null,
    },
  ];
}

export type MonitorSourceRow = SourceHealthRow;

/**
 * How the two cases are told apart, from stored fields only:
 *   failing:   consecutive_failures > 0, or last_error is set (the newest run failed). rows_seen_last_run is 0 then, by construction.
 *   empty:     the newest run succeeded and parsed zero rows, and no run has parsed a row for more than 24 hours (last_rows_seen_at,
 *              from migration 0018; before it is filled, last_record_at is the stand-in).
 *   quiet:     the newest run succeeded and rows were seen recently, they were just not new. No storms today. Never an alert.
 *   not_running: the source has a row but has not run in more than 24 hours.
 * A one-day source alerts only when it is silent (nothing new for more than 24 hours) AND failing, empty or not running.
 */
export function oneDaySourceProblem(r: MonitorSourceRow, now: Date): { reason: string } | null {
  const nowMs = now.getTime();
  const lastActivity = t(r.last_new_at) ?? t(r.last_record_at) ?? t(r.tracked_since);
  // No evidence of when anything last happened: cannot call it silent.
  if (lastActivity === null) return null;
  if (nowMs - lastActivity <= SOURCE_SILENCE_MS) return null;

  const lastRun = t(r.last_run_at);
  const failing = r.consecutive_failures > 0 || !!r.last_error;
  if (failing) return { reason: 'The source has produced nothing new for more than 24 hours and its latest fetch failed, so its feed may be down.' };
  if (lastRun !== null && nowMs - lastRun > DAY) return { reason: 'The source has produced nothing new for more than 24 hours and has not run in that time, so it may have dropped out of the schedule.' };
  if (!ZERO_ROWS_IS_NORMAL.has(r.source) && r.rows_seen_last_run === 0) {
    const seen = t(r.last_rows_seen_at) ?? t(r.last_record_at);
    if (seen === null || nowMs - seen > DAY) return { reason: 'The source has produced nothing new for more than 24 hours and its fetches return no rows at all, so its feed may have changed.' };
  }
  return null;
}

/**
 * Condition c. One-day sources (normal gap 1 day in lib/signals/health.ts): see oneDaySourceProblem. Slower sources: alert when
 * the status, recomputed now, is degraded or unavailable. delayed is a warning the daily report already shows, so it is not an alert.
 * `enabled`: the source ids that are switched on now. Rows for any other id are skipped. Omitted means every row is judged.
 */
export function evaluateSources(rows: MonitorSourceRow[], now: Date, enabled?: ReadonlySet<string> | null): Condition[] {
  const out: Condition[] = [];
  for (const r of rows) {
    // Only sources that are on right now (in the registry, with their env keys set). A switched-off source keeps its old health row
    // forever; it must never alert.
    if (enabled && !enabled.has(r.source)) continue;
    const lastError = r.last_error ? sanitizeHealthError(r.last_error) : null;
    if (normalGapDays(r.source) <= 1) {
      const p = oneDaySourceProblem(r, now);
      if (p) {
        out.push({
          key: `source:${r.source}:silent`,
          code: 'source_silent',
          severity: 4,
          source: r.source,
          headline: `${r.source} has gone quiet`,
          reason: p.reason,
          lastSuccessAt: r.last_success_at,
          lastError,
        });
      }
      continue;
    }
    const status = computeStatus({
      source: r.source,
      now,
      lastSuccessAt: r.last_success_at,
      lastRecordAt: r.last_record_at,
      consecutiveFailures: r.consecutive_failures,
    });
    if (status === 'degraded' || status === 'unavailable') {
      out.push({
        key: `source:${r.source}:status`,
        code: 'source_down',
        severity: status === 'unavailable' ? 5 : 6,
        source: r.source,
        headline: `${r.source} is ${status}`,
        reason:
          status === 'unavailable'
            ? 'The source has failed 3 runs in a row, or has not worked in 72 hours.'
            : 'The source is working but has not produced a new record for more than 3 of its normal gaps.',
        lastSuccessAt: r.last_success_at,
        lastError,
      });
    }
  }
  return out;
}

export function sortConditions(c: Condition[]): Condition[] {
  return [...c].sort((a, b) => a.severity - b.severity || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------
// Dedupe and recovery
// ---------------------------------------------------------------------------------------------------------------------

/** One holler_ops_alerts row. last_state: alerting (emailed in this episode), suppressed (back inside the 24 h window, not emailed), recovered. */
export interface AlertRow {
  key: string;
  first_seen_at: string;
  last_sent_at: string | null;
  last_state: 'alerting' | 'suppressed' | 'recovered' | string;
  count: number;
}

export interface AlertPlan {
  /** True when this run should send one email. */
  send: boolean;
  /** Conditions to list in the email (all active ones, worst first) when send is true. */
  items: Condition[];
  /** Keys that cleared after an alert that was emailed. They get one "recovered" line. */
  recovered: string[];
  /** Row changes to store once the email is out (or, with no email, right away for keys that cleared quietly). */
  upserts: AlertRow[];
}

/**
 * Decide what to email. Rules:
 *  - A key is due when it is active and was never emailed, or was last emailed more than RESEND_MS ago.
 *    last_sent_at survives a recovery, so a condition that flaps does not email every time it comes back inside 24 hours.
 *  - Any due key makes one email. It lists the due keys and any key whose state changed since it was last emailed (it recovered and
 *    came back, or was never emailed); each listed key is stamped. A key emailed less than RESEND_MS ago that has stayed alerting
 *    since is NOT listed again and NOT restamped (verify-v3 P2); the email only counts it as still open (lib/monitor/run.ts).
 *  - A key that was alerting (emailed) and is no longer active is recovered. That also makes one email, so the line is not left waiting
 *    for the next problem: it carries the recovery line and any conditions still active.
 *  - A key that was only suppressed and clears recovers silently, so a flapping source gets one "recovered" line per emailed alert.
 *  - Nothing due and nothing recovered: quiet. A healthy feed never sends.
 */
export function planAlerts(active: Condition[], stored: AlertRow[], now: Date): AlertPlan {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const byKey = new Map(stored.map((r) => [r.key, r]));
  const activeKeys = new Set(active.map((c) => c.key));
  const items = sortConditions(active);

  const due = (c: Condition): boolean => {
    const row = byKey.get(c.key);
    const sent = row ? t(row.last_sent_at) : null;
    return sent === null || nowMs - sent > RESEND_MS;
  };

  const recovered: string[] = [];
  const cleared: AlertRow[] = [];
  for (const row of stored) {
    if (activeKeys.has(row.key) || row.last_state === 'recovered') continue;
    if (row.last_state === 'alerting') recovered.push(row.key);
    cleared.push({ ...row, last_state: 'recovered' });
  }

  // Changed since its last email: never stored, or not alerting (it recovered, or came back after a recovery and was suppressed).
  const changed = (c: Condition): boolean => {
    const row = byKey.get(c.key);
    return !row || row.last_state !== 'alerting';
  };
  const listed = (c: Condition): boolean => due(c) || changed(c);

  const send = items.some(due) || recovered.length > 0;
  const upserts: AlertRow[] = [...cleared];
  for (const c of items) {
    const row = byKey.get(c.key);
    const fresh = !row || row.last_state === 'recovered';
    if (send && listed(c)) {
      upserts.push({
        key: c.key,
        first_seen_at: fresh ? nowIso : row.first_seen_at,
        last_sent_at: nowIso,
        last_state: 'alerting',
        count: (row?.count ?? 0) + 1,
      });
    } else if (fresh) {
      // Back inside the 24 h window after an email: track it, do not email again.
      upserts.push({ key: c.key, first_seen_at: nowIso, last_sent_at: row?.last_sent_at ?? null, last_state: 'suppressed', count: row?.count ?? 0 });
    }
  }
  return { send, items: send ? items.filter(listed) : [], recovered, upserts };
}

/** A recovered key as a plain line, built from the key alone. */
export function recoveredLine(key: string): string {
  if (key === 'scan:stale') return 'Scan: running again.';
  if (key === 'scan:error') return 'Scan: the latest run has no error.';
  if (key === 'feed:silent') return 'Feed: new signals are arriving again.';
  const m = /^source:(.+):(silent|status)$/.exec(key);
  if (m) return m[2] === 'silent' ? `${m[1]}: delivering again.` : `${m[1]}: back to healthy or delayed.`;
  return `${key}: cleared.`;
}
