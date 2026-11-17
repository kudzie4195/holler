import { haversineMi } from '@/lib/geo';

export const MAX_MATCHES_PER_USER = 25;
/**
 * New-business license rows are tagged for six trades at once, so on a busy city a cleaning or insurance user would fill the whole
 * 25-row cap with licenses. At most this many `business` rows per user per scan (and per backfill), nearest first.
 */
export const MAX_BUSINESS_PER_USER = 5;
/** State-level (no coordinates) signals only match when severity is at least this. */
export const STATE_LEVEL_MIN_SEVERITY = 2;

export interface MatchProfile {
  user_id: string;
  categories: string[];
  lat: number | null;
  lon: number | null;
  state: string | null;
  radius_mi: number;
}

export interface MatchSignal {
  id: number;
  categories: string[];
  lat: number | null;
  lon: number | null;
  state: string | null;
  severity: number;
  occurred_at: string;
  /** data.subtype of the record ('business', 'permit', ...). Either this or data.subtype may be present. */
  subtype?: string | null;
  data?: { subtype?: unknown } | null;
}

export interface MatchRow {
  user_id: string;
  signal_id: number;
  distance_mi: number | null;
}

function hasCoords(lat: number | null | undefined, lon: number | null | undefined): lat is number {
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon);
}

/**
 * Decide whether one signal matches one profile.
 * - category overlap is required
 * - signals with coordinates need a profile with coordinates and distance <= radius_mi
 * - signals without coordinates match only profiles in the same state, and only at severity >= 2
 * Returns the match (distance may be null for state-level) or null.
 */
export function matchOne(signal: MatchSignal, profile: MatchProfile): { distance_mi: number | null } | null {
  if (!signal.categories.length || !profile.categories.length) return null;
  if (!signal.categories.some((c) => profile.categories.includes(c))) return null;

  if (hasCoords(signal.lat, signal.lon)) {
    if (!hasCoords(profile.lat, profile.lon)) return null;
    const d = haversineMi(profile.lat, profile.lon as number, signal.lat, signal.lon as number);
    if (d > profile.radius_mi) return null;
    return { distance_mi: Math.round(d * 10) / 10 };
  }

  if (signal.severity < STATE_LEVEL_MIN_SEVERITY) return null;
  if (!signal.state || !profile.state) return null;
  if (signal.state.toUpperCase() !== profile.state.toUpperCase()) return null;
  return { distance_mi: null };
}

export function subtypeOf(s: Pick<MatchSignal, 'subtype' | 'data'>): string | null {
  if (typeof s.subtype === 'string' && s.subtype) return s.subtype;
  const d = s.data?.subtype;
  return typeof d === 'string' && d ? d : null;
}

export interface Hit {
  s: MatchSignal;
  distance_mi: number | null;
}

/** A start time in the future ranks as "now": a record dated next year never outranks a fresh one of the same severity. */
function rankTime(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.min(t, nowMs) : 0;
}

/**
 * Pick one user's rows: business rows are limited to `maxBusiness` (closest first, then newest), then everything is ordered most
 * severe first, newest first (future dates clamped to now) and cut to `cap`.
 */
export function pickHits(hits: Hit[], nowMs: number, cap = MAX_MATCHES_PER_USER, maxBusiness = MAX_BUSINESS_PER_USER): Hit[] {
  const isBiz = (h: Hit) => subtypeOf(h.s) === 'business';
  const biz = hits
    .filter(isBiz)
    .sort(
      (a, b) =>
        (a.distance_mi ?? Infinity) - (b.distance_mi ?? Infinity) || rankTime(b.s.occurred_at, nowMs) - rankTime(a.s.occurred_at, nowMs),
    )
    .slice(0, maxBusiness);
  const keep = [...hits.filter((h) => !isBiz(h)), ...biz];
  keep.sort((a, b) => b.s.severity - a.s.severity || rankTime(b.s.occurred_at, nowMs) - rankTime(a.s.occurred_at, nowMs));
  return keep.slice(0, cap);
}

/**
 * Match new signals to profiles. Per user: business rows capped, then most severe first, then newest, capped at `cap`.
 */
export function matchSignals(signals: MatchSignal[], profiles: MatchProfile[], cap = MAX_MATCHES_PER_USER, now: Date = new Date()): MatchRow[] {
  const out: MatchRow[] = [];
  for (const p of profiles) {
    const hits: Hit[] = [];
    for (const s of signals) {
      const m = matchOne(s, p);
      if (m) hits.push({ s, distance_mi: m.distance_mi });
    }
    for (const h of pickHits(hits, now.getTime(), cap)) out.push({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi });
  }
  return out;
}
