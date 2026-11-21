import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_BUSINESS_PER_USER, matchOne, pickHits, type Hit, type MatchProfile, type MatchSignal } from './match';
import { matchScope, type ScopeArea } from '@/lib/plan';
import { APPROX_LOCATION_SOURCES } from './approx-location';
import { historyRow, upsertMatchRows } from './quiet-matches';

export const BACKFILL_DAYS = 14;
export const BACKFILL_CAP = 25;
/** Rows read per page from holler_signals_near (the function clamps p_limit to 500 itself). */
export const BACKFILL_PAGE_LIMIT = 500;
/** At most this many pages: the newest 1500 records inside the radius. Pages only continue while a page comes back full. */
export const BACKFILL_MAX_PAGES = 3;
/** Severity 2+ rows with coordinates inside the radius: their own read, so a dense feed of routine rows cannot bury a severe report. */
export const BACKFILL_SEVERE_LIMIT = 100;
/** State-level rows (no coordinates, severity 2+) for the profile's state: their own small query, so nothing can crowd them out. */
export const BACKFILL_STATE_LIMIT = 100;
/** Keyword watches (Pro): rows per area (and per state for state-level rows) whose title or summary contains a watched phrase. */
export const BACKFILL_KEYWORD_LIMIT = 200;

const DAY = 86_400_000;
/** Events that start within this many days are worth a first-login match; anything further out is not read. */
const BACKFILL_AHEAD_DAYS = 7;

type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

interface SignalRow extends MatchSignal {
  expires_at: string | null;
}

const COLUMNS = 'id,source,kind,title,categories,lat,lon,state,severity,occurred_at,expires_at,subtype:data->>subtype';
/** Keyword reads also need the text the phrase is matched against. */
const KEYWORD_COLUMNS = 'id,source,kind,categories,lat,lon,state,severity,occurred_at,expires_at,title,summary,subtype:data->>subtype';
/** The RPC's result is a function return table, so it takes plain columns only (no JSON arrow alias); subtypeOf() reads data.subtype. */
const RPC_COLUMNS = 'id,categories,lat,lon,state,severity,occurred_at,expires_at,data';

/**
 * Records with coordinates inside the profile's own radius, newest first. The distance test runs in SQL (holler_signals_near,
 * migration 0003) BEFORE the row limit, so a dense neighbour feed (NYC 311 next to a Trenton NJ profile at 50 miles) cannot use up
 * the limit with rows that are in the bounding box but outside the circle. Pages back in time while a page is full, with a keyset
 * cursor (the oldest row's occurred_at as p_until plus its id as p_before_id), so thousands of rows that share one timestamp
 * (a date-only feed) are read in full instead of returning the same page again.
 * `minSeverity` 2 with `maxPages` 1 is the separate severe read.
 */
async function readNear(
  db: Db,
  profile: Pick<MatchProfile, 'lat' | 'lon' | 'radius_mi' | 'categories'>,
  since: string,
  until: string,
  opts: { minSeverity: number; limit: number; maxPages: number },
): Promise<SignalRow[]> {
  if (typeof profile.lat !== 'number' || typeof profile.lon !== 'number' || !Number.isFinite(profile.lat) || !Number.isFinite(profile.lon)) return [];
  const out: SignalRow[] = [];
  const seen = new Set<number>();
  let pageUntil = until;
  let beforeId: number | null = null;
  for (let page = 0; page < opts.maxPages; page++) {
    const { data, error } = await db
      .rpc('holler_signals_near', {
        p_lat: profile.lat,
        p_lon: profile.lon,
        p_radius_mi: profile.radius_mi,
        p_categories: profile.categories,
        p_since: since,
        p_until: pageUntil,
        p_limit: opts.limit,
        p_soonest_first: false,
        p_min_severity: opts.minSeverity,
        p_before_id: beforeId,
      })
      .select(RPC_COLUMNS);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SignalRow[];
    let fresh = 0;
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
        fresh++;
      }
    }
    if (rows.length < opts.limit || fresh === 0) break;
    const last = rows[rows.length - 1]; // newest first, so the last row is the oldest of this page
    pageUntil = last.occurred_at;
    beforeId = last.id;
  }
  return out;
}

/** State-level rows (no coordinates) for the profile's state at severity 2+, unexpired, newest first. */
async function readStateLevel(
  db: Db,
  profile: Pick<MatchProfile, 'state' | 'categories'>,
  since: string,
  until: string,
  nowIso: string,
): Promise<SignalRow[]> {
  if (!profile.state || !/^[A-Za-z]{2}$/.test(profile.state)) return [];
  const { data, error } = await db
    .from('holler_signals')
    .select(COLUMNS)
    .is('lat', null)
    .eq('state', profile.state.toUpperCase())
    .gte('severity', 2)
    .overlaps('categories', profile.categories)
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('occurred_at', { ascending: false })
    .limit(BACKFILL_STATE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalRow[];
}

/**
 * PostgREST or() filter: title or summary contains any watched phrase (ilike, case-insensitive). Values are double-quoted, and
 * keywords are limited to letters, digits, spaces, hyphens, apostrophes and ampersands when saved, so nothing here can break the filter.
 * This is only a prefilter; matchOne applies the whole-phrase rule afterwards.
 */
export function keywordOrFilter(keywords: string[]): string {
  const safe = keywords.map((k) => k.replace(/["\\,()*%]/g, ' ').trim()).filter(Boolean);
  return safe.flatMap((k) => [`title.ilike."*${k}*"`, `summary.ilike."*${k}*"`]).join(',');
}

/** Keyword reads for one area: a lat/lon box around it (matchOne does the exact distance test), unexpired, newest first. */
async function readKeywordsNear(
  db: Db,
  area: ScopeArea,
  radiusMi: number,
  keywords: string[],
  since: string,
  until: string,
  nowIso: string,
): Promise<SignalRow[]> {
  if (typeof area.lat !== 'number' || typeof area.lon !== 'number' || !Number.isFinite(area.lat) || !Number.isFinite(area.lon)) return [];
  const filter = keywordOrFilter(keywords);
  if (!filter) return [];
  const r = Math.min(Math.max(radiusMi, 0.1), 150);
  const dLat = r / 68.9;
  const dLon = r / (68.9 * Math.max(0.05, Math.cos(((Math.min(89, Math.abs(area.lat) + dLat)) * Math.PI) / 180)));
  const { data, error } = await db
    .from('holler_signals')
    .select(KEYWORD_COLUMNS)
    .gte('lat', area.lat - dLat)
    .lte('lat', area.lat + dLat)
    .gte('lon', area.lon - dLon)
    .lte('lon', area.lon + dLon)
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .or(filter)
    .order('occurred_at', { ascending: false })
    .limit(BACKFILL_KEYWORD_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalRow[];
}

/** Keyword reads for state-level rows (no coordinates, severity 2+) in one state. */
async function readKeywordsState(db: Db, state: string, keywords: string[], since: string, until: string, nowIso: string): Promise<SignalRow[]> {
  if (!/^[A-Za-z]{2}$/.test(state)) return [];
  const filter = keywordOrFilter(keywords);
  if (!filter) return [];
  const { data, error } = await db
    .from('holler_signals')
    .select(KEYWORD_COLUMNS)
    .is('lat', null)
    .eq('state', state.toUpperCase())
    .gte('severity', 2)
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .or(filter)
    .order('occurred_at', { ascending: false })
    .limit(BACKFILL_KEYWORD_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as SignalRow[];
}

/** Approximate-location rows (Cobb County: the stand-in point is the county seat) read per backfill. */
export const BACKFILL_APPROX_LIMIT = 200;
const APPROX_COLUMNS = 'id,source,kind,title,categories,lat,lon,state,severity,occurred_at,expires_at,subtype:data->>subtype';

/**
 * Rows from the approximate-location sources (lib/signals/approx-location.ts) in the window, for the profile's trades. They match a
 * member within radius + 15 miles of their stand-in point (matchOne), which the radius read in SQL cannot see. Fail soft: [] on error.
 */
async function readApprox(db: Db, categories: string[], since: string, until: string, nowIso: string): Promise<SignalRow[]> {
  if (!categories.length || APPROX_LOCATION_SOURCES.size === 0) return [];
  try {
    const { data, error } = await db
      .from('holler_signals')
      .select(APPROX_COLUMNS)
      .in('source', [...APPROX_LOCATION_SOURCES])
      .overlaps('categories', categories)
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('occurred_at', { ascending: false })
      .limit(BACKFILL_APPROX_LIMIT);
    if (error) return [];
    return (data ?? []) as SignalRow[];
  } catch {
    return [];
  }
}

/**
 * Keyword watches (Pro) on the approximate-location sources: the same radius + 15 miles rule as the scan (commander decision 4,
 * verify-v1 finding 10). The plain lat/lon box of readKeywordsNear cannot see a Cobb row whose stand-in point is past the radius, so these
 * rows get their own read; matchOne then applies the reach and stores no distance. Fail soft: [] on error.
 */
async function readApproxKeywords(db: Db, keywords: string[], since: string, until: string, nowIso: string): Promise<SignalRow[]> {
  const filter = keywordOrFilter(keywords);
  if (!filter || APPROX_LOCATION_SOURCES.size === 0) return [];
  try {
    const { data, error } = await db
      .from('holler_signals')
      .select(KEYWORD_COLUMNS)
      .in('source', [...APPROX_LOCATION_SOURCES])
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .or(filter)
      .order('occurred_at', { ascending: false })
      .limit(BACKFILL_APPROX_LIMIT);
    if (error) return [];
    return (data ?? []) as SignalRow[];
  } catch {
    return [];
  }
}

/** Signal ids (out of `ids`) this user already has a match for. Empty set on any failure (fail soft: the upsert still ignores repeats). */
async function existingMatchIds(db: Db, userId: string, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (!userId || ids.length === 0) return out;
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('holler_matches').select('signal_id').eq('user_id', userId).in('signal_id', ids.slice(i, i + 200));
      if (error) return new Set();
      for (const r of (data ?? []) as { signal_id: number }[]) out.add(r.signal_id);
    }
  } catch {
    return new Set();
  }
  return out;
}

export interface BackfillResult {
  /** Rows sent to the upsert (existing matches are ignored by the database, so this is an upper bound). */
  matched: number;
  considered: number;
  error?: string;
}

/**
 * Gives a new or re-targeted profile a filled feed: the most severe, then newest, unexpired signals of the last
 * 14 days that match, capped at 25. Rows are inserted notified = true and pushed_at = now so the first email and the first push never
 * dump old items (retried without pushed_at before migration 0020).
 * Idempotent (upsert, ignore duplicates). Never throws: failures are logged and reported in the result.
 */
export async function backfillMatches(db: Db, profile: MatchProfile, now: Date = new Date()): Promise<BackfillResult> {
  try {
    if (!profile.categories?.length && !(Array.isArray(profile.keywords) && profile.keywords.length)) return { matched: 0, considered: 0 };
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - BACKFILL_DAYS * DAY).toISOString();
    const until = new Date(now.getTime() + BACKFILL_AHEAD_DAYS * DAY).toISOString();

    // Only what the current plan allows: a Starter profile with saved Pro extras reads its main area and first 5 trades only.
    const scope = matchScope(profile);
    const states = [...new Set(scope.areas.map((a) => a.state?.toUpperCase()).filter((x): x is string => Boolean(x)))];
    const reads: Promise<SignalRow[]>[] = [];
    if (scope.categories.length) {
      for (const a of scope.areas) {
        const at = { lat: a.lat, lon: a.lon, radius_mi: profile.radius_mi, categories: scope.categories };
        reads.push(readNear(db, at, since, until, { minSeverity: 1, limit: BACKFILL_PAGE_LIMIT, maxPages: BACKFILL_MAX_PAGES }));
        reads.push(readNear(db, at, since, until, { minSeverity: 2, limit: BACKFILL_SEVERE_LIMIT, maxPages: 1 }));
      }
      for (const st of states) reads.push(readStateLevel(db, { state: st, categories: scope.categories }, since, until, nowIso));
      reads.push(readApprox(db, scope.categories, since, until, nowIso));
    }
    if (scope.keywords.length) {
      for (const a of scope.areas) reads.push(readKeywordsNear(db, a, profile.radius_mi, scope.keywords, since, until, nowIso));
      for (const st of states) reads.push(readKeywordsState(db, st, scope.keywords, since, until, nowIso));
      reads.push(readApproxKeywords(db, scope.keywords, since, until, nowIso));
    }
    const byId = new Map<number, SignalRow>();
    for (const r of (await Promise.all(reads)).flat()) if (!byId.has(r.id)) byId.set(r.id, r);
    const rows = [...byId.values()].filter((s) => !s.expires_at || Date.parse(s.expires_at) > now.getTime());
    const hits: Hit[] = [];
    for (const s of rows) {
      const m = matchOne(s, profile);
      if (m) hits.push({ s, distance_mi: m.distance_mi, label: m.label });
    }
    // Rows this member already has are left out BEFORE the cap: a member whose feed already holds 25 electrical rows who adds roofing
    // must get the roofing rows, not the same 25 electrical rows again (which the upsert would ignore). A failed read keeps them all.
    const have = await existingMatchIds(db, profile.user_id, hits.map((h) => h.s.id));
    const fresh = have.size ? hits.filter((h) => !have.has(h.s.id)) : hits;
    // Most severe first, then newest (a future start ranks as now); new-business rows capped at 5, nearest first.
    const picked = pickHits(fresh, now.getTime(), BACKFILL_CAP, MAX_BUSINESS_PER_USER);
    if (picked.length === 0) return { matched: 0, considered: rows.length };

    // History, not news: notified and pushed_at set at insert, so neither the email digest nor a push counts these rows.
    await upsertMatchRows(
      db,
      picked.map((h) => historyRow({ user_id: profile.user_id, signal_id: h.s.id, distance_mi: h.distance_mi }, now)),
    );
    return { matched: picked.length, considered: rows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('backfillMatches failed:', message);
    return { matched: 0, considered: 0, error: message };
  }
}

/** Loads the saved profile (plan, extra areas and keywords included) for a user and backfills every area the plan allows. Never throws. */
export async function backfillForUser(db: Db, userId: string, now: Date = new Date()): Promise<BackfillResult> {
  try {
    // '*' so a database without migration 0004 still works (no plan columns means Starter limits).
    const { data, error } = await db.from('holler_profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'profile not found');
    return await backfillMatches(db, data as MatchProfile, now);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('backfillForUser failed:', message);
    return { matched: 0, considered: 0, error: message };
  }
}
