import { cityBySlug, nearestCity } from '@/lib/geo';
import { env } from '@/lib/env';
import { isCategoryId } from './categories';
import { MAX_FUTURE_DAYS } from './run-limits';
import { matchSignals, type MatchRow } from './match';
import {
  getLastRunTimes,
  insertMatches,
  insertNewSignals,
  loadProfiles,
  logRun,
  pruneOldSignals,
  type Db,
  type SignalRowInput,
  type StoredSignal,
} from './store';
import { recordSourceHealth, type RunOutcome } from './health';
import { normalizeState } from './adapters/usaspending';
import { pingNewSignals, type PingNewSignalsInput, type PingOutcome } from '@/lib/seo/indexnow';
import type { Adapter, Severity, SignalInput } from './types';

export type SourceStatus = 'ok' | 'error' | 'skipped(env)' | 'skipped(cadence)';

export interface SourceResult {
  id: string;
  status: SourceStatus;
  /** raw rows the adapter returned */
  fetched: number;
  /** rows that passed validation (fetched minus malformed and duplicate rows) */
  parsed: number;
  inserted: number;
  matched: number;
  /** up to three titles, for the live probe */
  samples: string[];
  logs: string[];
  error?: string;
  /** newest occurredAt among parsed items (null when none), to tell a quiet source from a stale one */
  latestOccurredAt?: string | null;
  missingEnv?: string[];
  ms: number;
}

export interface ScanReport {
  dry: boolean;
  startedAt: string;
  ms: number;
  sources: SourceResult[];
  totals: { fetched: number; inserted: number; matched: number };
  pruned?: boolean;
  /** IndexNow ping for this run. Absent when it was skipped (no key, localhost, dry run, nothing new). */
  indexNow?: PingOutcome;
  error?: string;
}

export interface RunOptions {
  /** run only this adapter id (bypasses the cadence check) */
  source?: string;
  /** fetch + parse only: no DB reads or writes */
  dry?: boolean;
  now?: Date;
  /** per-adapter timeout in ms (default 40000) */
  adapterTimeoutMs?: number;
  /** override adapter list (tests) */
  adapters?: Adapter[];
  fetchImpl?: typeof fetch;
  /**
   * Wall-clock budget in ms from the start of runScan after which no NEW source is written (default SCAN_DEADLINE_MS). Matching and the
   * run log for sources already written always happen. Sources skipped here are not logged, so they are due again on the next tick.
   */
  deadlineMs?: number;
  /** test hook: milliseconds clock (default Date.now) */
  clock?: () => number;
  /** test hook for the IndexNow ping after a non-dry scan (config, fetch, log, memory). Defaults read INDEXNOW_KEY and NEXT_PUBLIC_SITE_URL. */
  indexNow?: Partial<Pick<PingNewSignalsInput, 'config' | 'fetchImpl' | 'log' | 'timeoutMs' | 'memory'>>;
}

export const DEFAULT_ADAPTER_TIMEOUT_MS = 40_000;
/** The scan route has maxDuration = 60 s. Fetching takes up to 40 s, so new writes stop at 48 s and leave 12 s for matching, logging and the response. */
export const SCAN_DEADLINE_MS = 48_000;
/** Run-log inserts per round trip batch (about 45 adapters). */
const LOG_CONCURRENCY = 10;
const FIRST_RUN_LOOKBACK_MS = 48 * 3600_000;
const CADENCE_SLACK_MS = 60_000;

export function isDue(adapter: Adapter, lastRunMs: number | undefined, nowMs: number): boolean {
  if (lastRunMs === undefined) return true;
  return nowMs - lastRunMs >= adapter.cadenceMinutes * 60_000 - CADENCE_SLACK_MS;
}

export function missingEnvFor(adapter: Adapter, e: Record<string, string | undefined> = env): string[] {
  return (adapter.requiresEnv ?? []).filter((k) => !e[k]);
}

function safeHttpUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null;
  } catch {
    return null;
  }
}

export { MAX_FUTURE_DAYS };
const MIN_OCCURRED_MS = Date.UTC(2000, 0, 1);

/** Validate and normalize adapter output. Drops malformed rows, rows dated absurdly (before 2000 or more than 60 days ahead) and duplicate externalIds. */
export function normalizeSignals(adapter: Adapter, input: SignalInput[], now: Date = new Date()): SignalInput[] {
  const latest = now.getTime() + MAX_FUTURE_DAYS * 86_400_000;
  const seen = new Set<string>();
  const out: SignalInput[] = [];
  for (const s of input) {
    if (!s || typeof s.externalId !== 'string' || !s.externalId || typeof s.title !== 'string' || !s.title.trim()) continue;
    const t = Date.parse(s.occurredAt);
    if (!Number.isFinite(t) || t > latest || t < MIN_OCCURRED_MS) continue;
    if (seen.has(s.externalId)) continue;
    seen.add(s.externalId);
    const sev = Math.min(3, Math.max(1, Math.round(Number(s.severity) || 1))) as Severity;
    const lat = typeof s.lat === 'number' && Number.isFinite(s.lat) && Math.abs(s.lat) <= 90 ? s.lat : null;
    const lon = typeof s.lon === 'number' && Number.isFinite(s.lon) && Math.abs(s.lon) <= 180 ? s.lon : null;
    const hasBoth = lat !== null && lon !== null;
    out.push({
      ...s,
      source: s.source || adapter.id,
      kind: s.kind || adapter.kind,
      title: s.title.trim().slice(0, 300),
      summary: s.summary ? String(s.summary).slice(0, 600) : null,
      lat: hasBoth ? lat : null,
      lon: hasBoth ? lon : null,
      state: normalizeState(s.state),
      url: safeHttpUrl(s.url),
      categories: Array.from(new Set((s.categories ?? []).filter((c) => isCategoryId(c)))),
      severity: sev,
      occurredAt: new Date(t).toISOString(),
    });
  }
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Nearest city slug within 40 mi, or an exact city+state slug when there are no coordinates. */
export function placeSlugFor(s: SignalInput): string | null {
  try {
    if (typeof s.lat === 'number' && typeof s.lon === 'number') return nearestCity(s.lat, s.lon, 40)?.slug ?? null;
    if (s.city && s.state) return cityBySlug(`${slugify(s.city)}-${s.state.toLowerCase()}`)?.slug ?? null;
  } catch {
    /* geo lookup must never break a scan */
  }
  return null;
}

const ERROR_LOG = /\b(error|failed|failure|timeout|timed out|http\s?[45]\d\d|status\s?[45]\d\d)\b/i;

class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

function latestOf(signals: SignalInput[]): string | null {
  return signals.reduce<string | null>((m, s) => (m === null || s.occurredAt > m ? s.occurredAt : m), null);
}

interface Fetched {
  adapter: Adapter;
  result: SourceResult;
  signals: SignalInput[];
  startedAt: string;
  /** Delivery outcome for the health table: the fetch result, flipped to failed when the rows could not be stored. Matching problems do not count against the source. */
  health?: { ok: boolean; error: string | null };
}

async function fetchOne(adapter: Adapter, since: Date, now: Date, timeoutMs: number, fetchImpl: typeof fetch): Promise<Fetched> {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const logs: string[] = [];
  const result: SourceResult = { id: adapter.id, status: 'ok', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs, latestOccurredAt: null, ms: 0 };
  let signals: SignalInput[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      adapter.fetch({ since, now, fetch: fetchImpl, env, log: (m) => logs.push(String(m).slice(0, 300)) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          logs.push(`adapter timeout after ${timeoutMs} ms`);
          reject(new TimeoutError());
        }, timeoutMs);
      }),
    ]);
    const list = Array.isArray(raw) ? raw : [];
    result.fetched = list.length;
    signals = normalizeSignals(adapter, list, now);
    result.parsed = signals.length;
    result.latestOccurredAt = latestOf(signals);
    result.samples = signals.slice(0, 3).map((s) => s.title);
    // Adapters swallow errors and return []: an empty result with an error-looking log is a broken source, not a quiet day.
    if (list.length === 0 && logs.some((l) => ERROR_LOG.test(l))) {
      result.status = 'error';
      result.error = logs.filter((l) => ERROR_LOG.test(l)).join(' | ').slice(0, 500);
    }
  } catch (e) {
    result.status = 'error';
    // A timeout is recorded as exactly "timeout" so the health email and dashboards can group on it.
    result.error = e instanceof TimeoutError ? 'timeout' : (e instanceof Error ? e.message : String(e)).slice(0, 500);
  } finally {
    if (timer) clearTimeout(timer);
  }
  result.ms = Date.now() - t0;
  return { adapter, result, signals, startedAt, health: { ok: result.status !== 'error', error: result.error ?? null } };
}

export async function runScan(opts: RunOptions = {}, db?: Db | null): Promise<ScanReport> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const deadlineMs = opts.deadlineMs ?? SCAN_DEADLINE_MS;
  const dry = !!opts.dry;
  const timeoutMs = opts.adapterTimeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Lazy so unit tests (and dry probes of a single adapter list) do not load every adapter module.
  const all = opts.adapters ?? (await import('./registry')).ALL_ADAPTERS;
  const report: ScanReport = { dry, startedAt: now.toISOString(), ms: 0, sources: [], totals: { fetched: 0, inserted: 0, matched: 0 } };

  if (!dry && !db) {
    report.error = 'database client unavailable';
    return report;
  }

  const selected = opts.source ? all.filter((a) => a.id === opts.source) : all;
  if (opts.source && selected.length === 0) {
    report.error = `unknown source "${opts.source}"`;
    return report;
  }

  let lastRuns: Record<string, number> = {};
  if (!dry && db && !opts.source) {
    try {
      lastRuns = await getLastRunTimes(db);
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
      return report;
    }
  }

  const due: Adapter[] = [];
  for (const a of selected) {
    const missing = missingEnvFor(a);
    if (missing.length) {
      report.sources.push({ id: a.id, status: 'skipped(env)', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs: [], missingEnv: missing, ms: 0 });
    } else if (!dry && !opts.source && !isDue(a, lastRuns[a.id], now.getTime())) {
      report.sources.push({ id: a.id, status: 'skipped(cadence)', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs: [], ms: 0 });
    } else due.push(a);
  }

  const fetched = await Promise.all(
    due.map((a) => {
      const last = lastRuns[a.id];
      const since = last ? new Date(last - 10 * 60_000) : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
      return fetchOne(a, since, now, timeoutMs, fetchImpl);
    }),
  );

  if (dry || !db) {
    for (const f of fetched) report.sources.push(f.result);
  } else {
    // Phase 1: persist new signals per source.
    const storedAll: StoredSignal[] = [];
    const skippedForTime = new Set<Fetched>();
    // Oldest last successful run first (never run = first), so a source the deadline skipped is the first one written on the next tick.
    // In a fixed order the same late sources were skipped on every tick and a 6 hour feed could starve forever. Array.sort is stable,
    // so sources with equal ages keep their registry order.
    const writeOrder = [...fetched].sort((a, b) => (lastRuns[a.adapter.id] ?? 0) - (lastRuns[b.adapter.id] ?? 0));
    for (const f of writeOrder) {
      if (clock() - t0 > deadlineMs && f.result.status !== 'error' && f.signals.length) {
        // Out of time for new writes. Not logged below, so this source is due again on the next tick and nothing is silently lost.
        f.result.status = 'error';
        f.result.error = `deadline: scan passed ${Math.round(deadlineMs / 1000)} s before this source was written; it will retry next tick`;
        skippedForTime.add(f);
        continue;
      }
      if (f.result.status !== 'error' && f.signals.length) {
        try {
          const rows: SignalRowInput[] = f.signals.map((s) => ({ ...s, placeSlug: placeSlugFor(s) }));
          const inserted = await insertNewSignals(db, rows, { log: (m) => f.result.logs.push(m) });
          f.result.inserted = inserted.length;
          storedAll.push(...inserted);
        } catch (e) {
          f.result.status = 'error';
          f.result.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
          f.health = { ok: false, error: f.result.error };
        }
      }
    }
    // The report keeps the registry order whatever order the writes happened in.
    for (const f of fetched) report.sources.push(f.result);

    // Phase 2: match all new signals at once so the per-user cap applies per scan.
    if (storedAll.length) {
      try {
        const profiles = await loadProfiles(db, now);
        const rows: MatchRow[] = matchSignals(storedAll, profiles, undefined, now);
        await insertMatches(db, rows);
        const sourceById = new Map(storedAll.map((s) => [s.id, s.source]));
        const bySource = new Map<string, number>();
        for (const r of rows) {
          const src = sourceById.get(r.signal_id);
          if (src) bySource.set(src, (bySource.get(src) ?? 0) + 1);
        }
        for (const f of fetched) f.result.matched = bySource.get(f.adapter.id) ?? 0;
      } catch (e) {
        const msg = `matching failed: ${e instanceof Error ? e.message : String(e)}`;
        report.error = msg;
        // These signals are stored but nobody was matched. Put it on the scan_runs row so the health email shows it.
        for (const f of fetched) {
          if (f.result.inserted > 0) {
            f.result.status = 'error';
            f.result.error = msg.slice(0, 500);
          }
        }
      }
    }

    // Phase 3: log one scan_runs row per adapter that ran.
    // Always runs (even past the deadline), concurrently in small batches: 45 sequential inserts would eat the time that is left.
    const finishedAt = new Date().toISOString();
    const toLog = fetched.filter((f) => !skippedForTime.has(f));
    for (let i = 0; i < toLog.length; i += LOG_CONCURRENCY) {
      const results = await Promise.allSettled(
        toLog.slice(i, i + LOG_CONCURRENCY).map((f) =>
          logRun(db, {
            source: f.adapter.id,
            started_at: f.startedAt,
            finished_at: finishedAt,
            fetched: f.result.fetched,
            inserted: f.result.inserted,
            matched: f.result.matched,
            error: f.result.error ?? null,
          }),
        ),
      );
      for (const r of results) {
        if (r.status === 'rejected') {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          report.error = `${report.error ? report.error + '; ' : ''}${msg}`;
        }
      }
    }

    // Per-source health. Never throws and never changes the scan result: a failed health write is only noted in the logs.
    // Sources the deadline skipped are left alone (they are not logged either and are due again next tick).
    try {
      const outcomes: RunOutcome[] = fetched
        .filter((f) => !skippedForTime.has(f) && f.health)
        .map((f) => ({
          source: f.adapter.id,
          ok: f.health!.ok,
          error: f.health!.error,
          rowsSeen: f.result.parsed,
          rowsNew: f.result.inserted,
          latestRecordAt: f.result.latestOccurredAt ?? null,
        }));
      const healthError = await recordSourceHealth(db, outcomes, now);
      if (healthError) console.warn(healthError);
    } catch (e) {
      console.warn('source_health skipped', e instanceof Error ? e.message : 'error');
    }

    // One IndexNow ping per run for the city pages and the current weekly page that got new rows. It never throws, gives up after 5 s,
    // and is skipped when the scan is already close to the route limit. A key-less or localhost site skips it silently.
    if (storedAll.length && clock() - t0 <= deadlineMs + 2_000) {
      const outcome = await pingNewSignals({ db, inserted: storedAll, now, ...opts.indexNow }).catch(
        (): PingOutcome => ({ status: 'failed', urls: 0, error: 'unexpected' }),
      );
      if (outcome.status !== 'skipped') report.indexNow = outcome;
    }

    // The daily prune is optional work: skip it when the scan is already close to the route limit.
    if (clock() - t0 <= deadlineMs + 4_000) {
      try {
        report.pruned = await pruneOldSignals(db, now);
      } catch (e) {
        report.error = `${report.error ? report.error + '; ' : ''}prune: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  for (const s of report.sources) {
    report.totals.fetched += s.fetched;
    report.totals.inserted += s.inserted;
    report.totals.matched += s.matched;
  }
  report.ms = clock() - t0;
  return report;
}
