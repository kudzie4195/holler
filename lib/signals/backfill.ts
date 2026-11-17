import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_BUSINESS_PER_USER, matchOne, pickHits, type Hit, type MatchProfile, type MatchSignal } from './match';

export const BACKFILL_DAYS = 14;
export const BACKFILL_CAP = 25;
/** Rows read per page from holler_signals_near (the function clamps p_limit to 500 itself). */
export const BACKFILL_PAGE_LIMIT = 500;
/** At most this many pages: the newest 1500 records inside the radius. Pages only continue while a page comes back full. */
export const BACKFILL_MAX_PAGES = 3;
/** State-level rows (no coordinates, severity 2+) for the profile's state: their own small query, so nothing can crowd them out. */
export const BACKFILL_STATE_LIMIT = 100;

const DAY = 86_400_000;
/** Events that start within this many days are worth a first-login match; anything further out is not read. */
const BACKFILL_AHEAD_DAYS = 7;

type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

interface SignalRow extends MatchSignal {
  expires_at: string | null;
}

const COLUMNS = 'id,categories,lat,lon,state,severity,occurred_at,expires_at,subtype:data->>subtype';
/** The RPC's result is a function return table, so it takes plain columns only (no JSON arrow alias); subtypeOf() reads data.subtype. */
const RPC_COLUMNS = 'id,categories,lat,lon,state,severity,occurred_at,expires_at,data';

/**
 * Records with coordinates inside the profile's own radius, newest first. The distance test runs in SQL (holler_signals_near,
 * migration 0003) BEFORE the row limit, so a dense neighbour feed (NYC 311 next to a Trenton NJ profile at 50 miles) cannot use up
 * the limit with rows that are in the bounding box but outside the circle. Pages back in time while a page is full.
 */
async function readNear(db: Db, profile: MatchProfile, since: string, until: string): Promise<SignalRow[]> {
  if (typeof profile.lat !== 'number' || typeof profile.lon !== 'number' || !Number.isFinite(profile.lat) || !Number.isFinite(profile.lon)) return [];
  const out: SignalRow[] = [];
  const seen = new Set<number>();
  let pageUntil = until;
  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    const { data, error } = await db
      .rpc('holler_signals_near', {
        p_lat: profile.lat,
        p_lon: profile.lon,
        p_radius_mi: profile.radius_mi,
        p_categories: profile.categories,
        p_since: since,
        p_until: pageUntil,
        p_limit: BACKFILL_PAGE_LIMIT,
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
    if (rows.length < BACKFILL_PAGE_LIMIT || fresh === 0) break;
    pageUntil = rows[rows.length - 1].occurred_at; // newest first, so the last row is the oldest of this page
  }
  return out;
}

/** State-level rows (no coordinates) for the profile's state at severity 2+, unexpired, newest first. */
async function readStateLevel(db: Db, profile: MatchProfile, since: string, until: string, nowIso: string): Promise<SignalRow[]> {
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

export interface BackfillResult {
  /** Rows sent to the upsert (existing matches are ignored by the database, so this is an upper bound). */
  matched: number;
  considered: number;
  error?: string;
}

/**
 * Gives a new or re-targeted profile a filled feed: the most severe, then newest, unexpired signals of the last
 * 14 days that match, capped at 25. Rows are inserted notified = true so the first email never dumps old items.
 * Idempotent (upsert, ignore duplicates). Never throws: failures are logged and reported in the result.
 */
export async function backfillMatches(db: Db, profile: MatchProfile, now: Date = new Date()): Promise<BackfillResult> {
  try {
    if (!profile.categories?.length) return { matched: 0, considered: 0 };
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - BACKFILL_DAYS * DAY).toISOString();
    const until = new Date(now.getTime() + BACKFILL_AHEAD_DAYS * DAY).toISOString();

    const [near, state] = await Promise.all([
      readNear(db, profile, since, until),
      readStateLevel(db, profile, since, until, nowIso),
    ]);
    const rows = [...near, ...state].filter((s) => !s.expires_at || Date.parse(s.expires_at) > now.getTime());
    const hits: Hit[] = [];
    for (const s of rows) {
      const m = matchOne(s, profile);
      if (m) hits.push({ s, distance_mi: m.distance_mi });
    }
    // Most severe first, then newest (a future start ranks as now); new-business rows capped at 5, nearest first.
    const picked = pickHits(hits, now.getTime(), BACKFILL_CAP, MAX_BUSINESS_PER_USER);
    if (picked.length === 0) return { matched: 0, considered: rows.length };

    const { error: upErr } = await db.from('holler_matches').upsert(
      picked.map((h) => ({
        user_id: profile.user_id,
        signal_id: h.s.id,
        distance_mi: h.distance_mi,
        notified: true,
      })),
      { onConflict: 'user_id,signal_id', ignoreDuplicates: true },
    );
    if (upErr) throw new Error(upErr.message);
    return { matched: picked.length, considered: rows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('backfillMatches failed:', message);
    return { matched: 0, considered: 0, error: message };
  }
}

/** Loads the saved profile for a user and backfills it. Never throws. */
export async function backfillForUser(db: Db, userId: string, now: Date = new Date()): Promise<BackfillResult> {
  try {
    const { data, error } = await db
      .from('holler_profiles')
      .select('user_id,categories,lat,lon,state,radius_mi')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'profile not found');
    return await backfillMatches(db, data as MatchProfile, now);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('backfillForUser failed:', message);
    return { matched: 0, considered: 0, error: message };
  }
}
