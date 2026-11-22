import { hasApproxLocation } from './approx-location';
import { cityBySlug, nearestCity } from '@/lib/geo';
import { env } from '@/lib/env';
import { isCategoryId } from './categories';
import { MAX_FUTURE_DAYS } from './run-limits';
import { pruneSourceSamples, SAMPLES_MISSING, SamplesMissingError, samplesTableState, storeSourceSamples } from './samples';
import { MAX_MATCHES_PER_USER, matchOne, matchSignals, type MatchRow } from './match';
import { ProjectStore, rearmStageAlerts } from './projects';
import { matchScope } from '@/lib/plan';
import { isStageTrade, MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY, STAGE_NOTE_PREFIX, stageUpdatesEnabled } from './stage';
import {
  getLastRunTimes,
  insertMatches,
  insertNewSignals,
  markStoredContactPaths,
  contactGateOn,
  loadProfiles,
  logRun,
  pruneOldSignals,
  readAllPages,
  type Db,
  type SignalRowInput,
  type StoredSignal,
} from './store';
import { recordSourceHealth, type RunOutcome } from './health';
import { contactPathOf, holdOf, missingHoldColumn } from './alert-gate';
import { isPermitRecord } from './permit-routing';
import { sanitizeContacts } from '@/lib/contacts/sanitize';
import { remapStoredSignals, type RemapReport } from './mapping/remap';
import { alertLogRowsFor, logAlerts } from '@/lib/moat/log';
import { normalizeState } from './adapters/usaspending';
import { pingNewSignals, type PingNewSignalsInput, type PingOutcome } from '@/lib/seo/indexnow';
import type { StageQueryOutcome, Adapter, Severity, SignalInput } from './types';

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
  /** The source's stage query did not work (lib/signals/stage.ts isStageNote). Not a failure of the source: its status stays ok; it is written on the source's scan_runs row. */
  stageNote?: string;
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
  /** Re-map of stored rows written under an older category mapping (lib/signals/mapping). Absent when skipped for time. */
  remap?: RemapReport;
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
  /** Test hook: stage updates on or off (default: the HOLLER_STAGE_UPDATES_ENABLED flag). */
  stageUpdates?: boolean;
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
/**
 * The stored-row re-map (one batch is a 100-row read, up to 100 small updates and one rematch) only starts a batch while at least this
 * much of the write budget is left, so it can never push the scan past the route limit.
 */
export const REMAP_RESERVE_MS = 10_000;
/** Run-log inserts per round trip batch (about 45 adapters). */
const LOG_CONCURRENCY = 10;
const FIRST_RUN_LOOKBACK_MS = 48 * 3600_000;
const CADENCE_SLACK_MS = 60_000;

export function isDue(adapter: Adapter, lastRunMs: number | undefined, nowMs: number): boolean {
  if (lastRunMs === undefined) return true;
  return nowMs - lastRunMs >= adapter.cadenceMinutes * 60_000 - CADENCE_SLACK_MS;
}

export function missingEnvFor(adapter: Adapter, e: Record<string, string | undefined> = env): string[] {
  const keys = (adapter.requiresEnv ?? []).filter((k) => !e[k]);
  // A feature-flagged adapter (city bids) that is switched off counts as not configured, naming the flag. The scan, the health
  // email and the ingest monitor all read this, so a deliberately-off source is never reported as "never ran".
  // Each flagged adapter names ITS flag (Adapter.flag); one that does not says so generically instead of naming another adapter's flag.
  if (adapter.enabled && !adapter.enabled()) keys.push(adapter.flag ?? 'feature flag');
  for (const f of adapter.extraFlags ?? []) if (!f.on()) keys.push(f.name);
  return keys;
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

/**
 * Nearest city slug within 40 mi, or an exact city+state slug when there are no coordinates. Null for a record whose position is a
 * stand-in (lib/signals/approx-location.ts, Cobb County rows at the county seat): it is not "in" the nearest city, so it is never listed
 * on a city page.
 */
export function placeSlugFor(s: SignalInput): string | null {
  // Only data.loc counts here: a row placed at its city's centre (data.approxLocation) still belongs on that city's page.
  if (hasApproxLocation({ source: s.source, data: { loc: (s.data as { loc?: unknown } | null | undefined)?.loc } })) return null;
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

async function fetchOne(adapter: Adapter, since: Date, now: Date, timeoutMs: number, fetchImpl: typeof fetch, extra: { db?: Db | null; dry?: boolean; stageTracking?: boolean } = {}): Promise<Fetched> {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const logs: string[] = [];
  const result: SourceResult = { id: adapter.id, status: 'ok', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs, latestOccurredAt: null, ms: 0 };
  let signals: SignalInput[] = [];
  let stageOutcome: StageQueryOutcome | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      adapter.fetch({ since, now, fetch: fetchImpl, env, log: (m) => logs.push(String(m).slice(0, 300)), db: extra.db ?? null, dry: !!extra.dry, stageTracking: !!extra.stageTracking, stageOutcome: (o) => { stageOutcome = o; } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          logs.push(`adapter timeout after ${timeoutMs} ms`);
          reject(new TimeoutError());
        }, timeoutMs);
      }),
    ]);
    const list = Array.isArray(raw) ? raw : [];
    // Probe rows (the stage query) are not rows the source published today: they do not count as fetched, parsed or latest.
    const real = list.filter((x) => !(x && typeof x === 'object' && (x as SignalInput).stageProbe));
    result.fetched = real.length;
    signals = normalizeSignals(adapter, list, now);
    const parsedReal = signals.filter((x) => !x.stageProbe);
    result.parsed = parsedReal.length;
    result.latestOccurredAt = latestOf(parsedReal);
    result.samples = parsedReal.slice(0, 3).map((x) => x.title);
    if (stageOutcome && (stageOutcome as StageQueryOutcome).state !== 'ok') {
      const o = stageOutcome as StageQueryOutcome;
      result.stageNote = `${STAGE_NOTE_PREFIX} ${o.state === 'rejected' ? `date column ${o.dateField} not accepted (code ${o.httpStatus ?? '?'})` : o.state === 'failed' ? 'no usable answer' : 'full page, newest changes only'}`.slice(0, 200);
    }
    // Adapters swallow errors and return []: an empty result with an error-looking log is a broken source, not a quiet day.
    if (real.length === 0 && logs.some((l) => ERROR_LOG.test(l))) {
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

/**
 * Stage updates each member already got in this UTC day: their matches on projects whose stage update was emitted today, not counting
 * the ones this scan is sending. Never throws; a failed read counts as none (the per-scan room still applies).
 */
async function stageUpdatesToday(db: Db, now: Date, exceptSignalIds: readonly number[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const stages = await readAllPages<{ signal_id: number | null }>(
      (from, to) => db.from('holler_permit_stages').select('signal_id').eq('emitted', true).gte('first_seen_at', dayStart).order('first_seen_at', { ascending: true }).range(from, to),
      5,
    );
    const except = new Set(exceptSignalIds);
    const ids = [...new Set(stages.map((x) => x.signal_id).filter((x): x is number => typeof x === 'number' && !except.has(x)))];
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200);
      const read = (cols: string) =>
        readAllPages<{ user_id: string; alert_hold?: string | null }>(
          (from, to) => db.from('holler_matches').select(cols).in('signal_id', part).order('id', { ascending: true }).range(from, to),
          10,
        );
      let matches: Array<{ user_id: string; alert_hold?: string | null }>;
      try {
        matches = await read('user_id, alert_hold');
      } catch (e) {
        if (!missingHoldColumn(e instanceof Error ? e.message : String(e))) throw e;
        matches = await read('user_id');
      }
      // A feed-only card never got its update (it is never sent), so it does not use one of the member's 5 places.
      for (const m of matches) if (!holdOf(m)) out.set(m.user_id, (out.get(m.user_id) ?? 0) + 1);
    }
  } catch {
    /* no count: the per-scan room still caps the member */
  }
  return out;
}

/**
 * Round 18 contact gate (lib/signals/alert-gate.ts): for every building permit this scan just stored, whether it names a business or a
 * job-site street address (from the contacts the adapter attached, sanitised exactly as they are stored, or from the public summary).
 * Set on the stored row object (like hasContact) so matchSignals can hold a permit card with neither out of email and push. Rows that are
 * not permits are left untouched (their contact state stays unknown, and the gate never applies to them).
 */
export function markContactPaths(inserted: StoredSignal[], built: readonly SignalInput[]): void {
  const byKey = new Map<string, SignalInput>();
  for (const b of built) byKey.set(`${b.source}\u0000${b.externalId}`, b);
  for (const r of inserted) {
    if (!isPermitRecord({ kind: r.kind, subtype: r.subtype ?? null })) continue;
    const b = r.external_id != null ? byKey.get(`${r.source}\u0000${r.external_id}`) : undefined;
    let contacts: ReturnType<typeof sanitizeContacts> = [];
    try {
      contacts = sanitizeContacts(b?.contacts ?? [], { datasetCity: b?.city ?? null });
    } catch {
      contacts = [];
    }
    r.contactPath = contactPathOf(contacts, r.summary ?? b?.summary ?? null);
  }
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
      lastRuns = await getLastRunTimes(db, now.getTime());
    } catch (e) {
      report.error = e instanceof Error ? e.message : String(e);
      return report;
    }
  }

  const due: Adapter[] = [];
  for (const a of selected) {
    const missing = missingEnvFor(a);
    // missingEnvFor also names the flag when a feature-flagged adapter (city bids) is switched off.
    if (missing.length) {
      report.sources.push({ id: a.id, status: 'skipped(env)', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs: [], missingEnv: missing, ms: 0 });
    } else if (!dry && !opts.source && !isDue(a, lastRuns[a.id], now.getTime())) {
      report.sources.push({ id: a.id, status: 'skipped(cadence)', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs: [], ms: 0 });
    } else due.push(a);
  }

  // Source probation (migration 0032). The samples table is probed once, and only when a probation source is due on a real scan. With
  // it missing, every probation source is skipped like an unconfigured one: no fetch, no write anywhere, no scan_runs row, no error.
  let samplesState: 'ok' | 'missing' | 'failed' | 'unknown' = 'unknown';
  if (!dry && db && due.some((a) => a.probation)) {
    samplesState = await samplesTableState(db);
    if (samplesState === 'missing') {
      for (let i = due.length - 1; i >= 0; i--) {
        const a = due[i];
        if (!a.probation) continue;
        due.splice(i, 1);
        report.sources.push({ id: a.id, status: 'skipped(env)', fetched: 0, parsed: 0, inserted: 0, matched: 0, samples: [], logs: [SAMPLES_MISSING], missingEnv: ['migration 0032 (holler_source_samples)'], ms: 0 });
      }
    }
  }

  // PLAN-2.0 2.1 and 2.3 (migration 0025). The stage table is probed once, and only when a source in this scan has a stage query: with
  // the table missing no adapter makes that query, so the scan fetches exactly what it fetched before.
  const logsSink: string[] = [];
  const updatesOn = opts.stageUpdates ?? stageUpdatesEnabled();
  const projects = !dry && db ? new ProjectStore(db, (m) => logsSink.push(m), now, updatesOn) : null;
  // The stage query is made only with the flag on AND the stage table there; with either missing the fetch is exactly the pre-0025 one.
  const stageTracking = projects && updatesOn && due.some((a) => a.stageQuery) ? await projects.stageTrackingAvailable() : false;
  const probeLogs = logsSink.splice(0);

  const fetched = await Promise.all(
    due.map((a) => {
      const last = lastRuns[a.id];
      const since = last ? new Date(last - 10 * 60_000) : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
      return fetchOne(a, since, now, timeoutMs, fetchImpl, { db, dry, stageTracking });
    }),
  );

  if (dry || !db) {
    for (const f of fetched) report.sources.push(f.result);
  } else {
    // Phase 1: persist new signals per source.
    const storedAll: StoredSignal[] = [];
    /** Existing project rows whose permit just moved to a final stage: matched to the stage trades only (lib/signals/projects.ts). */
    const stageSignals: StoredSignal[] = [];
    const projectStore = projects as ProjectStore; // db is set on this branch
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
      if (f.result.status !== 'error' && f.signals.length && f.adapter.probation) {
        // Probation: same fetch, parsing and contact clean-up as any source, but the rows go to holler_source_samples (service role
        // only). Never holler_signals or the project store, so no matching, card, alert, AI note or IndexNow ping can see them (they
        // stay out of storedAll). A table that went missing since the probe is a skip, not an error.
        try {
          f.result.inserted = await storeSourceSamples(db, f.adapter.id, f.signals, now);
        } catch (e) {
          if (e instanceof SamplesMissingError) {
            f.result.logs.push(SAMPLES_MISSING);
          } else {
            f.result.status = 'error';
            f.result.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
            f.health = { ok: false, error: f.result.error };
          }
        }
        continue;
      }
      if (f.result.status !== 'error' && f.signals.length) {
        try {
          const rows: SignalRowInput[] = f.signals.map((s) => ({ ...s, placeSlug: placeSlugFor(s) }));
          // PLAN-2.0 2.1 and 2.3 (migration 0025). Off, and silent, while the tables are missing: the rows then go in exactly as built.
          logsSink.length = 0;
          if (f.adapter.stageQuery) logsSink.push(...probeLogs);
          const plan = await projectStore.plan(rows);
          const inserted = await insertNewSignals(db, plan.rows, { log: (m) => f.result.logs.push(m), dedupe: true });
          f.result.inserted = inserted.length;
          await projectStore.record(plan, inserted);
          const events = await projectStore.stages(plan, inserted);
          f.result.logs.push(...logsSink);
          markContactPaths(inserted, plan.rows);
          // A row stored as a follower (another listing of a project, same or another source) is evidence, not a second card.
          storedAll.push(...inserted.filter((r) => !(r.external_id != null && plan.followers.has(r.external_id))));
          stageSignals.push(...events);
        } catch (e) {
          f.result.status = 'error';
          f.result.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
          f.health = { ok: false, error: f.result.error };
        }
      }
    }
    // Sample retention, once per scan for every source (a quiet, promoted or removed source's samples expire too). Skipped when the
    // probe already found the table missing; never throws and never fails the scan.
    if (samplesState !== 'missing') await pruneSourceSamples(db, now);
    // The report keeps the registry order whatever order the writes happened in.
    for (const f of fetched) report.sources.push(f.result);

    // Phase 2: match all new signals at once so the per-user cap applies per scan.
    if (storedAll.length || stageSignals.length) {
      try {
        const profiles = await loadProfiles(db, now);
        // The contact gate runs only with migration 0027 applied; before it, no card is held anywhere (review 2, P1-1).
        const gateOn = [...storedAll, ...stageSignals].some((s) => isPermitRecord({ kind: s.kind ?? null, subtype: s.subtype ?? null })) ? await contactGateOn(db) : false;
        if (!gateOn) for (const s of storedAll) s.contactPath = undefined;
        const rows: MatchRow[] = matchSignals(storedAll, profiles, undefined, now);
        // A stage update (final inspection, finished, certificate of occupancy): the project row is matched again, for the stage trades
        // only (a member's own trades, inside the plan's limit). A member with no card for it gets one new card; a member who already
        // holds the card gets it re-sent once as a stage update. Per member: at most MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY a UTC day, and
        // together with this scan's normal cards inside MAX_MATCHES_PER_USER (a stage update never sits outside the 25).
        const rearm = new Map<number, string[]>();
        if (stageSignals.length) {
          const have = new Map<string, string>();
          /** Pairs whose card is feed-only (alert_hold): a re-sent card would still be held, so it gets no update and takes no place. */
          const heldPairs = new Set<string>();
          // A member with no card yet gets a fresh one: the contact gate reads the stored contacts for it, as the scan did for the others.
          if (gateOn) await markStoredContactPaths(db, stageSignals);
          else for (const sig of stageSignals) sig.contactPath = undefined;
          try {
            type Existing = { user_id: string; signal_id: number; status: string | null; alert_hold?: string | null };
            const read = (cols: string) =>
              readAllPages<Existing>(
                (from, to) => db.from('holler_matches').select(cols).in('signal_id', stageSignals.map((s) => s.id)).order('id', { ascending: true }).range(from, to),
                20,
              );
            let existing: Existing[];
            try {
              existing = await read('user_id, signal_id, status, alert_hold');
            } catch (e) {
              if (!missingHoldColumn(e instanceof Error ? e.message : String(e))) throw e;
              existing = await read('user_id, signal_id, status');
              // Migration 0027 is not applied after all: no card is feed-only. Every card of this scan is stored as a plain alert (insertMatches
              // drops the hold too) and every stage update goes out exactly as before round 18.
              for (const r of rows) delete r.alert_hold;
              for (const sig of stageSignals) sig.contactPath = undefined;
            }
            for (const m of existing) {
              have.set(`${m.user_id}\u0000${m.signal_id}`, m.status ?? 'new');
              if (holdOf(m)) heldPairs.add(`${m.user_id}\u0000${m.signal_id}`);
            }
          } catch {
            /* insertMatches keeps (user, signal) unique anyway */
          }
          const usedToday = await stageUpdatesToday(db, now, stageSignals.map((s) => s.id));
          const normal = new Map<string, number>();
          // Only cards that go out count against the room: a feed-only card of this scan gives way to a stage update (trimmed below).
          for (const r of rows) if (!r.alert_hold) normal.set(r.user_id, (normal.get(r.user_id) ?? 0) + 1);
          for (const p of profiles) {
            // Only the member's stage trades are asked: a member of ['moving', 'landscaping'] must not be answered with "moving" alone.
            const mine = matchScope(p).categories.filter((c) => isStageTrade(c));
            if (mine.length === 0) continue;
            const hits: Array<{ sig: StoredSignal; fresh: boolean; distance: number | null; score: number }> = [];
            for (const sig of stageSignals) {
              const hit = matchOne(sig, { ...p, categories: mine, keywords: [] }, undefined, now.getTime());
              // A card that is feed-only for this member (below their minimum job value, migration 0027) gets no stage update either.
              if (!hit || hit.label !== 'coming_soon' || hit.hold || !isStageTrade(hit.trade)) continue;
              // A card the member saved, finished or dismissed is never re-sent (rearmStageAlerts), so it must not take one of the 5 places.
              const held = have.get(`${p.user_id}\u0000${sig.id}`);
              if (held !== undefined && held !== 'new') continue;
              if (heldPairs.has(`${p.user_id}\u0000${sig.id}`)) continue;
              hits.push({ sig, fresh: held === undefined, distance: hit.distance_mi, score: hit.score });
            }
            if (hits.length === 0) continue;
            const room = Math.max(0, Math.min(MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY - (usedToday.get(p.user_id) ?? 0), MAX_MATCHES_PER_USER - (normal.get(p.user_id) ?? 0)));
            hits.sort((x, y) => y.score - x.score || y.sig.id - x.sig.id);
            for (const h of hits.slice(0, room)) {
              if (h.fresh) rows.push({ user_id: p.user_id, signal_id: h.sig.id, distance_mi: h.distance });
              else rearm.set(h.sig.id, [...(rearm.get(h.sig.id) ?? []), p.user_id]);
            }
          }
        }
        // Still at most MAX_MATCHES_PER_USER new rows per member: a fresh stage card takes the place of this scan's last feed-only card.
        if (stageSignals.length) {
          const count = new Map<string, number>();
          for (const r of rows) count.set(r.user_id, (count.get(r.user_id) ?? 0) + 1);
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            if (r.alert_hold && (count.get(r.user_id) ?? 0) > MAX_MATCHES_PER_USER) {
              rows.splice(i, 1);
              count.set(r.user_id, (count.get(r.user_id) ?? 0) - 1);
            }
          }
        }
        // A held row is stored as already handled (notified, pushed_at): the email and push runs never read it again (review P3-4). If
        // 0027 turns out to be missing, insertMatches drops all three keys and the card is stored exactly as before round 18.
        for (const r of rows) if (r.alert_hold) Object.assign(r, { notified: true, pushed_at: now.toISOString() });
        await insertMatches(db, rows);
        if (rearm.size) await rearmStageAlerts(db, [...rearm].map(([signalId, userIds]) => ({ signalId, userIds })), (m, signalId) => { const src = stageSignals.find((x) => x.id === signalId)?.source; report.sources.find((x) => x.id === src)?.logs.push(m); });
        // Outcome log (migration 0015): one coarse row per new alert. Never throws; returns 0 before the migration.
        const alertSignals = stageSignals.length ? [...storedAll, ...stageSignals] : storedAll;
        // A feed-only card (alert_hold: background, below the member's minimum, or a held trade family) is not an alert: not logged as one.
        await logAlerts(db, alertLogRowsFor(rows.filter((r) => !r.alert_hold), alertSignals, profiles));
        const sourceById = new Map(alertSignals.map((s) => [s.id, s.source]));
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
          // Probation sources are never matched, so a matching failure is not theirs (their inserted count is samples).
          if (f.result.inserted > 0 && !f.adapter.probation) {
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
            error: f.result.error ?? f.result.stageNote ?? null,
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

    // Category mapping upgrades reach rows already stored (data.cat_v older than the code's CAT_V): small batches, only while the time
    // budget allows, then a rematch of the rows that changed. Never throws and never fails the scan.
    if (clock() - t0 <= deadlineMs - REMAP_RESERVE_MS) {
      try {
        report.remap = await remapStoredSignals(db, { now, shouldContinue: () => clock() - t0 <= deadlineMs - REMAP_RESERVE_MS });
      } catch (e) {
        report.remap = { scanned: 0, updated: 0, changed: 0, rematched: 0, pruned: 0, batches: 0, done: false, error: e instanceof Error ? e.message : String(e) };
      }
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
        if (report.pruned) await projectStore.pruneOld();
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
