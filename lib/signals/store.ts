import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchProfile, MatchRow, MatchSignal } from './match';
import type { SignalInput } from './types';

export type Db = SupabaseClient;

export const RETENTION_DAYS = 120;
const CHUNK = 200;

export interface StoredSignal extends MatchSignal {
  source: string;
  title: string;
}

export interface ScanRunRecord {
  source: string;
  started_at: string;
  finished_at: string;
  fetched: number;
  inserted: number;
  matched: number;
  error: string | null;
}

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** PostgREST caps one response at 1000 rows (Supabase default max_rows), so everything that can exceed that is read in pages. */
export const PAGE_SIZE = 1000;

/**
 * Read every row a query returns, one 1000-row page at a time.
 * `build(from, to)` must return the same ordered query for the given inclusive range. Stops after `maxPages`.
 */
export async function readAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Latest started_at per source from holler_scan_runs (last 3 days).
 * Paged: 40 sources at 15 to 720 minute cadences write about 350 rows a day, so one 1000-row page can drop a slow
 * source off the end, which would make it look "never run" and re-run it on every tick.
 */
export async function getLastRunTimes(db: Db): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  let rows: { source: string | null; started_at: string | null }[];
  try {
    rows = await readAllPages(
      (from, to) =>
        db
          .from('holler_scan_runs')
          .select('source, started_at')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      10,
    );
  } catch (e) {
    throw new Error(`scan_runs read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.source || !r.started_at) continue;
    const t = Date.parse(r.started_at);
    if (Number.isFinite(t) && !(r.source in out)) out[r.source] = t;
  }
  return out;
}

export interface SignalRowInput extends SignalInput {
  placeSlug: string | null;
}

function toRow(s: SignalRowInput) {
  return {
    source: s.source,
    external_id: s.externalId,
    kind: s.kind,
    title: s.title,
    summary: s.summary ?? null,
    url: s.url ?? null,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    city: s.city ?? null,
    state: s.state ?? null,
    county: s.county ?? null,
    zip: s.zip ?? null,
    place_slug: s.placeSlug,
    categories: s.categories,
    severity: s.severity,
    occurred_at: s.occurredAt,
    expires_at: s.expiresAt ?? null,
    data: s.data ?? {},
  };
}

/** Insert with on conflict (source, external_id) do nothing; returns only the rows actually inserted. */
export async function insertNewSignals(db: Db, signals: SignalRowInput[]): Promise<StoredSignal[]> {
  const inserted: StoredSignal[] = [];
  for (const part of chunks(signals)) {
    const { data, error } = await db
      .from('holler_signals')
      .upsert(part.map(toRow), { onConflict: 'source,external_id', ignoreDuplicates: true })
      .select('id, source, title, categories, lat, lon, state, severity, occurred_at');
    if (error) throw new Error(`signals upsert failed: ${error.message}`);
    inserted.push(...((data ?? []) as StoredSignal[]));
  }
  return inserted;
}

export interface LoadedProfile extends MatchProfile {
  subscription_status: string;
  trial_ends_at: string | null;
}

/**
 * Can this profile still see alerts in the app? (F-11)
 * Mirrors lib/auth/access.ts computeAccess, with one difference: a canceled profile never matches.
 * active and past_due keep access (past_due is Stripe's retry window); trialing keeps it until trial_ends_at;
 * an unknown status is treated as trialing, like computeAccess does.
 */
export function canSeeAlerts(p: { subscription_status: string; trial_ends_at: string | null }, nowMs: number = Date.now()): boolean {
  if (p.subscription_status === 'canceled') return false;
  if (p.subscription_status === 'active' || p.subscription_status === 'past_due') return true;
  const end = p.trial_ends_at ? Date.parse(p.trial_ends_at) : NaN;
  return Number.isFinite(end) && end > nowMs;
}

/**
 * Profiles eligible for matching: has categories and can still see alerts (not canceled, not past an unpaid trial).
 * Paged with .range() because PostgREST silently caps one response at 1000 rows.
 */
export async function loadProfiles(db: Db, now: Date = new Date()): Promise<MatchProfile[]> {
  let rows: LoadedProfile[];
  try {
    rows = await readAllPages<LoadedProfile>(
      (from, to) =>
        db
          .from('holler_profiles')
          .select('user_id, categories, lat, lon, state, radius_mi, subscription_status, trial_ends_at')
          .neq('subscription_status', 'canceled')
          .order('user_id', { ascending: true })
          .range(from, to),
      100,
    );
  } catch (e) {
    throw new Error(`profiles read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return rows.filter((p) => Array.isArray(p.categories) && p.categories.length > 0 && canSeeAlerts(p, now.getTime()));
}

export async function insertMatches(db: Db, rows: MatchRow[]): Promise<number> {
  let n = 0;
  for (const part of chunks(rows, 500)) {
    const { data, error } = await db
      .from('holler_matches')
      .upsert(part, { onConflict: 'user_id,signal_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`matches upsert failed: ${error.message}`);
    n += data?.length ?? 0;
  }
  return n;
}

export async function logRun(db: Db, rec: ScanRunRecord): Promise<void> {
  const { error } = await db.from('holler_scan_runs').insert(rec);
  if (error) throw new Error(`scan_runs insert failed: ${error.message}`);
}

/**
 * Delete signals older than RETENTION_DAYS (matches cascade) at most once per 24 h.
 * Uses a marker row in holler_scan_runs with source '_prune'. Returns true when a prune ran.
 */
export async function pruneOldSignals(db: Db, now = new Date()): Promise<boolean> {
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const { data, error } = await db.from('holler_scan_runs').select('id').eq('source', '_prune').gte('started_at', dayAgo).limit(1);
  if (error) throw new Error(`prune check failed: ${error.message}`);
  if (data && data.length > 0) return false;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000).toISOString();
  const started = new Date().toISOString();
  const { error: delErr, count } = await db.from('holler_signals').delete({ count: 'exact' }).lt('occurred_at', cutoff);
  await db
    .from('holler_scan_runs')
    .delete()
    .lt('started_at', new Date(now.getTime() - 30 * 86400_000).toISOString());
  await logRun(db, {
    source: '_prune',
    started_at: started,
    finished_at: new Date().toISOString(),
    fetched: 0,
    inserted: 0,
    matched: count ?? 0,
    error: delErr ? delErr.message : null,
  });
  return !delErr;
}
