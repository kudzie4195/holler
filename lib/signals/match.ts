import { haversineMi } from '@/lib/geo';
import { matchScope, phraseIndex, searchText, type MatchScope } from '@/lib/plan';

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
  /** holler_profiles.plan ('starter' | 'pro', migration 0004). Missing means Starter limits. */
  plan?: string | null;
  /** With plan: Pro limits apply only while this is active or past_due. Missing means the plan alone decides. */
  subscription_status?: string | null;
  /** holler_profiles.extra_areas (jsonb array of {zip, city, state, lat, lon}). Used only on Pro. */
  extra_areas?: unknown;
  /** holler_profiles.keywords. Used only on Pro. */
  keywords?: string[] | null;
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
  /** Needed for keyword watches only: a record without them can still match by trade. */
  title?: string | null;
  summary?: string | null;
}

export interface MatchRow {
  user_id: string;
  signal_id: number;
  distance_mi: number | null;
}

function hasCoords(lat: number | null | undefined, lon: number | null | undefined): lat is number {
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon);
}

/** Miles per degree of latitude, rounded down (haversine with R = 3958.76 mi gives 69.09), so the quick test never drops a real match. */
const MI_PER_DEG_LAT_FLOOR = 69;

/**
 * Decide whether one signal matches one profile, inside the limits of the profile's current plan (see lib/plan matchScope).
 * - records with coordinates need an allowed area with coordinates within radius_mi; the distance is to the nearest such area
 * - records without coordinates match only an allowed area in the same state, and only at severity >= 2
 * - then the record must share a trade with the profile's allowed trades, OR (Pro) its title or summary contains one of the
 *   keyword watches as a whole phrase, any case, accents ignored; a keyword match does not need a shared trade
 * The area test runs first because it is cheap and rejects almost every pair; the text test only runs for nearby records.
 * Returns the match (distance may be null for state-level) or null.
 */
export function matchOne(signal: MatchSignal, profile: MatchProfile): { distance_mi: number | null } | null {
  return matchInScope(signal, profile, matchScope(profile));
}

function areaMatch(signal: MatchSignal, profile: MatchProfile, scope: MatchScope): { distance_mi: number | null } | null {
  if (hasCoords(signal.lat, signal.lon)) {
    const radius = profile.radius_mi;
    let best = Infinity;
    for (const a of scope.areas) {
      if (!hasCoords(a.lat, a.lon)) continue;
      if (Math.abs(a.lat - signal.lat) * MI_PER_DEG_LAT_FLOOR > radius) continue; // farther north or south than the radius
      const d = haversineMi(a.lat, a.lon as number, signal.lat, signal.lon as number);
      if (d < best) best = d;
    }
    if (!(best <= radius)) return null;
    return { distance_mi: Math.round(best * 10) / 10 };
  }

  if (signal.severity < STATE_LEVEL_MIN_SEVERITY) return null;
  if (!signal.state) return null;
  const st = signal.state.toUpperCase();
  if (!scope.areas.some((a) => a.state && a.state.toUpperCase() === st)) return null;
  return { distance_mi: null };
}

function tradeMatch(signal: MatchSignal, scope: MatchScope): boolean {
  return signal.categories.length > 0 && scope.categories.length > 0 && signal.categories.some((c) => scope.categories.includes(c));
}

function matchInScope(signal: MatchSignal, profile: MatchProfile, scope: MatchScope): { distance_mi: number | null } | null {
  const where = areaMatch(signal, profile, scope);
  if (!where) return null;
  if (tradeMatch(signal, scope)) return where;
  if (scope.phrases.length === 0) return null;
  return phraseIndex(searchText(signal), scope.phrases) >= 0 ? where : null;
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
 * Cost control (P1-2): the area test runs before any text test; each record's searchable text is built at most once per scan; and
 * the answer to "does record i contain phrase p" is kept for the scan, so profiles that watch the same phrase share the work.
 */
export function matchSignals(signals: MatchSignal[], profiles: MatchProfile[], cap = MAX_MATCHES_PER_USER, now: Date = new Date()): MatchRow[] {
  const out: MatchRow[] = [];
  const n = signals.length;
  const texts: (string | undefined)[] = new Array(n);
  /** phrase -> per record: 0 not tested yet, 1 contains it, 2 does not. */
  const phraseCache = new Map<string, Uint8Array>();
  for (const p of profiles) {
    const scope = matchScope(p); // once per profile, not once per record
    const slots: (Uint8Array | undefined)[] = new Array(scope.phrases.length);
    const hits: Hit[] = [];
    for (let i = 0; i < n; i++) {
      const s = signals[i];
      const where = areaMatch(s, p, scope);
      if (!where) continue;
      if (!tradeMatch(s, scope)) {
        let found = false;
        for (let j = 0; j < scope.phrases.length && !found; j++) {
          let arr = slots[j];
          if (!arr) {
            const phrase = scope.phrases[j];
            arr = phraseCache.get(phrase);
            if (!arr) {
              arr = new Uint8Array(n);
              phraseCache.set(phrase, arr);
            }
            slots[j] = arr;
          }
          let v = arr[i];
          if (v === 0) {
            let t = texts[i];
            if (t === undefined) t = texts[i] = searchText(s);
            v = arr[i] = t.includes(scope.phrases[j]) ? 1 : 2;
          }
          found = v === 1;
        }
        if (!found) continue;
      }
      hits.push({ s, distance_mi: where.distance_mi });
    }
    for (const h of pickHits(hits, now.getTime(), cap)) out.push({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi });
  }
  return out;
}
