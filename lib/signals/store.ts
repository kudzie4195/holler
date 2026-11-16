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

/** Latest started_at per source from holler_scan_runs. */
export async function getLastRunTimes(db: Db): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data, error } = await db
    .from('holler_scan_runs')
    .select('source, started_at')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`scan_runs read failed: ${error.message}`);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { source: string | null; started_at: string | null }[]) {
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

/** Profiles eligible for matching: has categories, not canceled, and not past an unpaid trial. */
export async function loadProfiles(db: Db): Promise<MatchProfile[]> {
  const { data, error } = await db
    .from('holler_profiles')
    .select('user_id, categories, lat, lon, state, radius_mi, subscription_status, trial_ends_at')
    .neq('subscription_status', 'canceled');
  if (error) throw new Error(`profiles read failed: ${error.message}`);
  return ((data ?? []) as (MatchProfile & { subscription_status: string; trial_ends_at: string | null })[]).filter(
    (p) => Array.isArray(p.categories) && p.categories.length > 0,
  );
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
