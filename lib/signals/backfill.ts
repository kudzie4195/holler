import type { SupabaseClient } from '@supabase/supabase-js';
import { matchOne, type MatchProfile, type MatchSignal } from './match';

export const BACKFILL_DAYS = 14;
export const BACKFILL_CAP = 25;
export const BACKFILL_ROW_LIMIT = 2000;

const DAY = 86_400_000;
/** Events that start within this many days are worth a first-login match; anything further out is not read. */
const BACKFILL_AHEAD_DAYS = 7;

type Db = Pick<SupabaseClient, 'from'>;

interface SignalRow extends MatchSignal {
  expires_at: string | null;
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

    const { data, error } = await db
      .from('holler_signals')
      .select('id,categories,lat,lon,state,severity,occurred_at,expires_at')
      .overlaps('categories', profile.categories)
      .gte('occurred_at', since)
      .lte('occurred_at', until)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('occurred_at', { ascending: false })
      .limit(BACKFILL_ROW_LIMIT);
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as SignalRow[]).filter(
      (s) => !s.expires_at || Date.parse(s.expires_at) > now.getTime(),
    );
    const hits: { s: SignalRow; distance_mi: number | null }[] = [];
    for (const s of rows) {
      const m = matchOne(s, profile);
      if (m) hits.push({ s, distance_mi: m.distance_mi });
    }
    // A future start time ranks as "now", so an event next week never outranks a fresh record of the same severity.
    const rank = (iso: string) => Math.min(Date.parse(iso), now.getTime());
    hits.sort((a, b) => b.s.severity - a.s.severity || rank(b.s.occurred_at) - rank(a.s.occurred_at));
    const picked = hits.slice(0, BACKFILL_CAP);
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
