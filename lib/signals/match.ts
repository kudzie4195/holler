import { haversineMi } from '@/lib/geo';

export const MAX_MATCHES_PER_USER = 25;
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

/**
 * Match new signals to profiles. Per user: most severe first, then newest, capped at `cap`.
 */
export function matchSignals(signals: MatchSignal[], profiles: MatchProfile[], cap = MAX_MATCHES_PER_USER): MatchRow[] {
  const out: MatchRow[] = [];
  for (const p of profiles) {
    const hits: { s: MatchSignal; distance_mi: number | null }[] = [];
    for (const s of signals) {
      const m = matchOne(s, p);
      if (m) hits.push({ s, distance_mi: m.distance_mi });
    }
    hits.sort((a, b) => b.s.severity - a.s.severity || Date.parse(b.s.occurred_at) - Date.parse(a.s.occurred_at));
    for (const h of hits.slice(0, cap)) out.push({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi });
  }
  return out;
}
