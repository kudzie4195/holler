import type { Db } from './store';

/**
 * Per-source delivery health. Pure rules (computeStatus) plus the small amount of glue the scan and the admin routes share.
 * Internal only: nothing here is shown on a public page.
 */

export type SourceHealthStatus = 'healthy' | 'delayed' | 'degraded' | 'unavailable';

const DAY_MS = 86_400_000;

/** A source with this many failed runs in a row is unavailable. */
export const UNAVAILABLE_AFTER_FAILURES = 3;
/** A source with no successful run in this long is unavailable. */
export const UNAVAILABLE_AFTER_NO_SUCCESS_MS = 72 * 3_600_000;
/** No new record in more than this many normal gaps is delayed. */
export const DELAYED_FACTOR = 1.5;
/** No new record in more than this many normal gaps is degraded. */
export const DEGRADED_FACTOR = 3;

/**
 * Normal gap, in days, between new records for a kind of source. A source is judged against how often it normally has something
 * new, so a quiet permit office is not flagged the way a storm feed would be.
 *
 *   weather and storm feeds                      1 day   (nws, spc; also usgs, faa and bluesky, which publish all day)
 *   permits and 311                              7 days  (the city feeds named -permits and -311; also events, film permits,
 *                                                         ticketmaster and web search, which move at about the same pace)
 *   inspections, licences and violations         14 days (named -inspections, -business (licences) and -violations)
 *   federal awards                               30 days (usaspending, sam-gov; also fema declarations)
 *
 * Anything we do not recognize gets the 7 day default, so a new source is neither ignored nor flagged on day two.
 * These are conservative starting points, not measured gaps. Tune them here once a month of real rows exists.
 */
export const NORMAL_GAP_DAYS = {
  weather: 1,
  permits311: 7,
  inspections: 14,
  federal: 30,
} as const;

const EXACT_GAP_DAYS: Record<string, number> = {
  nws: NORMAL_GAP_DAYS.weather,
  spc: NORMAL_GAP_DAYS.weather,
  usgs: NORMAL_GAP_DAYS.weather,
  faa: NORMAL_GAP_DAYS.weather,
  bluesky: NORMAL_GAP_DAYS.weather,
  usaspending: NORMAL_GAP_DAYS.federal,
  'sam-gov': NORMAL_GAP_DAYS.federal,
  fema: NORMAL_GAP_DAYS.federal,
  ticketmaster: NORMAL_GAP_DAYS.permits311,
  'websearch-brave': NORMAL_GAP_DAYS.permits311,
  'websearch-serper': NORMAL_GAP_DAYS.permits311,
};

export function normalGapDays(source: string): number {
  const exact = EXACT_GAP_DAYS[source];
  if (exact !== undefined) return exact;
  if (/-(inspections|business|violations)$/.test(source)) return NORMAL_GAP_DAYS.inspections;
  if (/-(permits|311|events|filmpermits)$/.test(source)) return NORMAL_GAP_DAYS.permits311;
  return NORMAL_GAP_DAYS.permits311;
}

export interface HealthInput {
  source: string;
  now: Date;
  lastSuccessAt: string | null;
  lastRecordAt: string | null;
  consecutiveFailures: number;
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Status rules, first match wins:
 *   unavailable: 3 or more failures in a row, or no successful run in 72 hours (a source that has never succeeded and has failed fewer than 3 times is degraded, or delayed when it has not failed yet).
 *   degraded:    the last run worked, but no new record for more than 3 normal gaps.
 *   delayed:     no new record for more than 1.5 normal gaps.
 *   healthy:     otherwise.
 * A source that has succeeded but never returned a record is judged as delayed: it is not yet delivering anything we can show.
 * Exactly on a limit is not past it (72 hours, 1.5 gaps and 3 gaps are all "more than").
 */
export function computeStatus(i: HealthInput): SourceHealthStatus {
  const nowMs = i.now.getTime();
  const success = ms(i.lastSuccessAt);
  if (i.consecutiveFailures >= UNAVAILABLE_AFTER_FAILURES) return 'unavailable';
  if (success !== null && nowMs - success > UNAVAILABLE_AFTER_NO_SUCCESS_MS) return 'unavailable';
  if (success === null) return i.consecutiveFailures > 0 ? 'degraded' : 'delayed';
  const record = ms(i.lastRecordAt);
  if (record === null) return 'delayed';
  const gap = normalGapDays(i.source) * DAY_MS;
  const age = nowMs - record;
  if (age > DEGRADED_FACTOR * gap) return 'degraded';
  if (age > DELAYED_FACTOR * gap) return 'delayed';
  return 'healthy';
}

export interface SourceHealthRow {
  source: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_record_at: string | null;
  rows_seen_last_run: number;
  rows_new_last_run: number;
  consecutive_failures: number;
  status: SourceHealthStatus;
  updated_at: string;
}

export const HEALTH_ERROR_MAX = 300;

/**
 * Trim an error to a code or a short message with no row data. Takes the first line, cuts at the places database drivers put the
 * offending values ("Key (...)=(...)", "Failing row contains", DETAIL), removes JSON bodies, quoted values (object names after constraint, column and similar are kept), URL query strings and key, token and secret parameters, blanks emails and long digit runs, and caps at 300 characters.
 */
export function sanitizeHealthError(err: unknown): string | null {
  if (err === null || err === undefined || err === '') return null;
  let s = err instanceof Error ? err.message : String(err);
  s = s.split(/\r?\n/)[0] ?? '';
  s = s.replace(/(Failing row contains|Key \(|DETAIL:|details?:|\bdata:)[\s\S]*$/i, '');
  // A JSON body or object literal can hold row data: cut from the first brace.
  s = s.replace(/[{[].*$/, '[x]');
  // Quoted text is a value unless it names a database object right after a keyword ('constraint "x"', 'column "title"').
  s = s.replace(/(\b(?:constraint|column|relation|table|index|function|type|schema|policy|trigger)\s+)?("[^"]*"|'[^']*')/gi, (m, kw: string | undefined) => (kw ? m : '[x]'));
  // Secrets in URLs and messages: drop the value of key, token, secret and password style parameters, then any other query string.
  s = s.replace(/([?&;\s](?:[a-z_]*(?:key|token|secret|password|passwd|pwd|auth|sig|signature)[a-z_]*)=)[^&\s]*/gi, '$1[x]');
  s = s.replace(/(https?:\/\/[^\s?]*)\?\S*/gi, '$1?[x]');
  s = s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted]');
  s = s.replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted]');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return 'error';
  return s.slice(0, HEALTH_ERROR_MAX);
}

export interface RunOutcome {
  source: string;
  ok: boolean;
  error?: string | null;
  rowsSeen: number;
  rowsNew: number;
  /** newest occurredAt among the rows this run returned, null when none */
  latestRecordAt: string | null;
}

/** Next health row from the previous row (or none) and this run. Pure. */
export function nextHealthRow(prev: SourceHealthRow | undefined, o: RunOutcome, now: Date): SourceHealthRow {
  const nowIso = now.toISOString();
  const prevRecord = prev?.last_record_at ?? null;
  // Records dated in the future (events, scheduled work) must not make a stalled source look fresh: cap at the run time.
  const latest = o.latestRecordAt && o.latestRecordAt > nowIso ? nowIso : o.latestRecordAt;
  // Keep the newest record time ever seen: a quiet run must not move it backwards or clear it.
  const lastRecordAt = latest && (!prevRecord || latest > prevRecord) ? latest : prevRecord;
  const lastSuccessAt = o.ok ? nowIso : prev?.last_success_at ?? null;
  const failures = o.ok ? 0 : (prev?.consecutive_failures ?? 0) + 1;
  const status = computeStatus({ source: o.source, now, lastSuccessAt, lastRecordAt, consecutiveFailures: failures });
  return {
    source: o.source,
    last_run_at: nowIso,
    last_success_at: lastSuccessAt,
    last_error: o.ok ? null : sanitizeHealthError(o.error ?? 'error') ?? 'error',
    last_record_at: lastRecordAt,
    rows_seen_last_run: o.ok ? o.rowsSeen : 0,
    rows_new_last_run: o.ok ? o.rowsNew : 0,
    consecutive_failures: failures,
    status,
    updated_at: nowIso,
  };
}

const COLUMNS =
  'source, last_run_at, last_success_at, last_error, last_record_at, rows_seen_last_run, rows_new_last_run, consecutive_failures, status, updated_at';

export async function readSourceHealth(db: Db): Promise<SourceHealthRow[]> {
  const { data, error } = await db.from('holler_source_health').select(COLUMNS).order('source', { ascending: true }).limit(1000);
  if (error) throw new Error(`source_health read failed: ${error.message}`);
  return (data ?? []) as SourceHealthRow[];
}

export const HEALTH_WRITE_TIMEOUT_MS = 3000;

/** Rejects after `ms` so a hanging database call cannot hold up the rest of the scan. The late result is ignored. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  p.catch(() => undefined);
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function write(db: Db, outcomes: RunOutcome[], now: Date): Promise<string | null> {
  const prev = new Map((await readSourceHealth(db)).map((r) => [r.source, r]));
  const rows = outcomes.map((o) => nextHealthRow(prev.get(o.source), o, now));
  const { error } = await db.from('holler_source_health').upsert(rows, { onConflict: 'source' });
  return error ? `source_health write failed: ${sanitizeHealthError(error.message)}` : null;
}

/**
 * Record one run's outcomes. Reads the previous rows (to carry the failure count and newest record forward), then upserts all in one
 * call. NEVER throws: a failure here must not break the scan. Returns an error string for logging, or null.
 */
export async function recordSourceHealth(db: Db, outcomes: RunOutcome[], now: Date): Promise<string | null> {
  if (!outcomes.length) return null;
  try {
    return await withTimeout(write(db, outcomes, now), HEALTH_WRITE_TIMEOUT_MS);
  } catch (e) {
    return `source_health write failed: ${sanitizeHealthError(e)}`;
  }
}

export interface SourceHealthSummary {
  counts: Record<SourceHealthStatus, number>;
  sources: Array<SourceHealthRow & { normal_gap_days: number }>;
}

/** Table rows with the status recomputed at read time, so a source that stopped being scanned still goes stale. */
export function summarizeSourceHealth(rows: SourceHealthRow[], now: Date): SourceHealthSummary {
  const counts: Record<SourceHealthStatus, number> = { healthy: 0, delayed: 0, degraded: 0, unavailable: 0 };
  const sources = rows.map((r) => {
    const status = computeStatus({
      source: r.source,
      now,
      lastSuccessAt: r.last_success_at,
      lastRecordAt: r.last_record_at,
      consecutiveFailures: r.consecutive_failures,
    });
    counts[status]++;
    return { ...r, status, normal_gap_days: normalGapDays(r.source) };
  });
  return { counts, sources };
}
