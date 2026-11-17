import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_BUSINESS_PER_USER, matchOne, pickHits, type Hit, type MatchProfile, type MatchSignal } from './match';

export const BACKFILL_DAYS = 14;
export const BACKFILL_CAP = 25;
/** PostgREST (Supabase max_rows) returns at most 1000 rows per response, so asking for more would only hide what the server does. */
export const BACKFILL_ROW_LIMIT = 1000;
const MILES_PER_DEGREE = 69;
/** Slack on the box so rounding and the 69 vs 69.09 mi/degree difference can never clip the circle. */
const BOX_SLACK = 1.02;

const DAY = 86_400_000;
/** Events that start within this many days are worth a first-login match; anything further out is not read. */
const BACKFILL_AHEAD_DAYS = 7;

type Db = Pick<SupabaseClient, 'from'>;

interface SignalRow extends MatchSignal {
  expires_at: string | null;
}

/**
 * PostgREST filter that keeps only rows the profile could match: inside the bounding box of its radius, or state-level rows
 * (no coordinates) for its state at severity 2+. Without it the newest 1000 rows nationwide (a few hours of NYC 311) fill the
 * response and a user anywhere else gets nothing. The exact distance test stays in matchOne.
 * Returns null when the profile has neither coordinates nor a state (nothing could match).
 */
export function scopeFilter(profile: Pick<MatchProfile, 'lat' | 'lon' | 'state' | 'radius_mi'>): string | null {
  const parts: string[] = [];
  if (typeof profile.lat === 'number' && typeof profile.lon === 'number' && Number.isFinite(profile.lat) && Number.isFinite(profile.lon)) {
    const dLat = (profile.radius_mi / MILES_PER_DEGREE) * BOX_SLACK;
    const cos = Math.max(0.05, Math.cos((Math.min(89, Math.abs(profile.lat) + dLat) * Math.PI) / 180));
    const dLon = ((profile.radius_mi / (MILES_PER_DEGREE * cos)) * BOX_SLACK);
    const n = (x: number) => Number(x.toFixed(5));
    const box = [`lat.gte.${n(profile.lat - dLat)}`, `lat.lte.${n(profile.lat + dLat)}`];
    // A box that would cross the antimeridian (only the far Aleutians) falls back to latitude only; matchOne still checks distance.
    if (Math.abs(profile.lon) + dLon <= 180) box.push(`lon.gte.${n(profile.lon - dLon)}`, `lon.lte.${n(profile.lon + dLon)}`);
    parts.push(`and(${box.join(',')})`);
  }
  if (profile.state && /^[A-Za-z]{2}$/.test(profile.state)) parts.push(`and(lat.is.null,state.eq.${profile.state.toUpperCase()},severity.gte.2)`);
  return parts.length ? parts.join(',') : null;
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

    const scope = scopeFilter(profile);
    if (!scope) return { matched: 0, considered: 0 };

    // Two .or() calls are combined with AND by PostgREST: (not expired) AND (inside the box OR state-level for the state).
    const { data, error } = await db
      .from('holler_signals')
      .select('id,categories,lat,lon,state,severity,occurred_at,expires_at,subtype:data->>subtype')
      .overlaps('categories', profile.categories)
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .or(scope)
      .order('occurred_at', { ascending: false })
      .limit(BACKFILL_ROW_LIMIT);
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as SignalRow[]).filter(
      (s) => !s.expires_at || Date.parse(s.expires_at) > now.getTime(),
    );
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
