import { haversineMi } from '@/lib/geo';
import { matchScope, phraseIndex, searchText, type MatchScope } from '@/lib/plan';
import { approxReachMi, hasApproxLocation } from './approx-location';
import { OPPORTUNITY_RANK, opportunityTrades, type Opportunity } from './opportunity';
import { opportunityInputOf, type OpportunityRowFields } from './member-opportunity';

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

export interface MatchSignal extends OpportunityRowFields {
  id: number;
  /**
   * holler_signals.kind. Required: trade matching reads the record's opportunity per trade (lib/signals/opportunity.ts), and a record
   * without its kind would read as 'context' for everyone. matchSignals and matchOne throw on a row without it (a select that forgot
   * the column), rather than silently matching nothing.
   */
  kind: string;
  categories: string[];
  lat: number | null;
  lon: number | null;
  state: string | null;
  severity: number;
  occurred_at: string;
  /** data.subtype of the record ('business', 'permit', ...). Either this or data.subtype may be present. */
  subtype?: string | null;
  data?: { subtype?: unknown; loc?: unknown; [k: string]: unknown } | null;
  /** Source id: a source listed in APPROX_LOCATION_SOURCES has a stand-in position (lib/signals/approx-location.ts). */
  source?: string | null;
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
 * - records whose coordinates are a stand-in (approximate location, Cobb County) need an area within radius_mi + 15 miles of the
 *   stand-in, and carry no distance (null)
 * - records without coordinates match only an allowed area in the same state, and only at severity >= 2
 * - then the record's opportunity (lib/signals/opportunity.ts opportunityTrades) must give at least one of the profile's allowed trades
 *   a label other than 'context' (this includes downstream trades that are not in the record's categories: a re-roof permit is
 *   'soon' for siding-gutters), OR (Pro) its title or summary contains one of the keyword watches as a whole phrase, any case,
 *   accents ignored; a keyword match does not need a trade label
 * The area test runs first because it is cheap and rejects almost every pair; the text test only runs for nearby records.
 * Returns the match (distance may be null for state-level) or null.
 */
export function matchOne(signal: MatchSignal, profile: MatchProfile): { distance_mi: number | null } | null {
  return matchInScope(signal, profile, matchScope(profile));
}

function areaMatch(signal: MatchSignal, profile: MatchProfile, scope: MatchScope): { distance_mi: number | null } | null {
  if (hasCoords(signal.lat, signal.lon)) {
    // A stand-in position (Cobb County rows sit at the county seat): the real site can be up to APPROX_MATCH_SLACK_MI from it, so the
    // record matches a member within radius + that slack. No distance is kept for it: there is no real distance to show.
    const approx = hasApproxLocation(signal);
    const radius = approx ? approxReachMi(profile.radius_mi) : profile.radius_mi;
    let best = Infinity;
    for (const a of scope.areas) {
      if (!hasCoords(a.lat, a.lon)) continue;
      if (Math.abs(a.lat - signal.lat) * MI_PER_DEG_LAT_FLOOR > radius) continue; // farther north or south than the radius
      const d = haversineMi(a.lat, a.lon as number, signal.lat, signal.lon as number);
      if (d < best) best = d;
    }
    if (!(best <= radius)) return null;
    return { distance_mi: approx ? null : Math.round(best * 10) / 10 };
  }

  if (signal.severity < STATE_LEVEL_MIN_SEVERITY) return null;
  if (!signal.state) return null;
  const st = signal.state.toUpperCase();
  if (!scope.areas.some((a) => a.state && a.state.toUpperCase() === st)) return null;
  return { distance_mi: null };
}

/** The area test alone (radius, stand-in reach, state-level rule, plan areas). Exported for the match replay's old-rule baseline. */
export function matchArea(signal: MatchSignal, profile: MatchProfile): { distance_mi: number | null } | null {
  return areaMatch(signal, profile, matchScope(profile));
}

/** Throws on a row read without its kind: a missing column must never make every record 'context' without anyone noticing. */
function assertKind(signal: MatchSignal): void {
  if (typeof signal.kind !== 'string' || signal.kind === '') {
    throw new Error(`match: signal ${signal.id} has no kind; the select that read it must include kind (OPPORTUNITY_SIGNAL_COLUMNS)`);
  }
}

/** Trade to label for every trade the record gives more than 'context' (downstream trades included). */
export function signalTrades(signal: MatchSignal): Partial<Record<string, Opportunity>> {
  assertKind(signal);
  return opportunityTrades(opportunityInputOf(signal));
}

/** Best label among `trades` in a signalTrades() result, or 'context'. */
export function bestLabelIn(labels: Partial<Record<string, Opportunity>>, trades: readonly string[]): Opportunity {
  let best: Opportunity = 'context';
  for (const t of trades) {
    const l = labels[t];
    if (l && OPPORTUNITY_RANK[l] > OPPORTUNITY_RANK[best]) best = l;
  }
  return best;
}

/** The label a hit ranks by for this member: their best trade label, or 'intel' for a keyword-only match. */
export function hitLabel(signal: MatchSignal, profile: MatchProfile): Opportunity {
  const scope = matchScope(profile);
  const l = bestLabelIn(signalTrades(signal), scope.categories);
  if (l !== 'context') return l;
  return scope.phrases.length > 0 && phraseIndex(searchText(signal), scope.phrases) >= 0 ? 'intel' : 'context';
}

function matchInScope(signal: MatchSignal, profile: MatchProfile, scope: MatchScope): { distance_mi: number | null } | null {
  assertKind(signal);
  const where = areaMatch(signal, profile, scope);
  if (!where) return null;
  if (scope.categories.length > 0 && bestLabelIn(signalTrades(signal), scope.categories) !== 'context') return where;
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
  /** The member's best label for the record (hitLabel). Missing ranks as 'context' (last). */
  label?: Opportunity;
}

/** A start time in the future ranks as "now": a record dated next year never outranks a fresh one of the same severity. */
function rankTime(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.min(t, nowMs) : 0;
}

/**
 * Pick one user's rows: business rows are limited to `maxBusiness` (closest first, then newest), then everything is ordered by the
 * member's best opportunity label (act, soon, intel), then most severe first, newest first (future dates clamped to now) and cut to `cap`.
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
  const rank = (h: Hit) => OPPORTUNITY_RANK[h.label ?? 'context'];
  keep.sort(
    (a, b) => rank(b) - rank(a) || b.s.severity - a.s.severity || rankTime(b.s.occurred_at, nowMs) - rankTime(a.s.occurred_at, nowMs),
  );
  return keep.slice(0, cap);
}

/**
 * Match new signals to profiles. Per user: business rows capped, then best label, most severe, newest, capped at `cap`.
 * Each record's opportunity (trade to label) is computed at most once per call, and only for records that pass some member's area test.
 * Cost control (P1-2): the area test runs before any text test; each record's searchable text is built at most once per scan; and
 * the answer to "does record i contain phrase p" is kept for the scan, so profiles that watch the same phrase share the work.
 */
export function matchSignals(signals: MatchSignal[], profiles: MatchProfile[], cap = MAX_MATCHES_PER_USER, now: Date = new Date()): MatchRow[] {
  const out: MatchRow[] = [];
  const n = signals.length;
  const texts: (string | undefined)[] = new Array(n);
  for (const s of signals) assertKind(s);
  const labels: (Partial<Record<string, Opportunity>> | undefined)[] = new Array(n);
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
      let lab = labels[i];
      if (lab === undefined) lab = labels[i] = signalTrades(s);
      let label: Opportunity = scope.categories.length > 0 ? bestLabelIn(lab, scope.categories) : 'context';
      if (label === 'context') {
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
        label = 'intel'; // keyword-only match: shown as a Market insight, never pushed
      }
      hits.push({ s, distance_mi: where.distance_mi, label });
    }
    for (const h of pickHits(hits, now.getTime(), cap)) out.push({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi });
  }
  return out;
}
