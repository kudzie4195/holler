import { haversineMi } from '@/lib/geo';
import { matchScope, phraseIndex, searchText, type MatchScope } from '@/lib/plan';
import { approxReachMi, hasApproxLocation } from './approx-location';
import { deadlineOf, isAlertLabel, isFeedLabel, labelForTrades, LABEL_RANK, type OpportunityLabel } from './lead-rules';
import { bidsEnabled, isBidSignal } from './bid-sources';

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
  data?: { subtype?: unknown; loc?: unknown } | null;
  /** Source id: a source listed in APPROX_LOCATION_SOURCES has a stand-in position (lib/signals/approx-location.ts). */
  source?: string | null;
  /**
   * Needed for keyword watches AND for the opportunity label (lib/signals/lead-rules.ts: title patterns such as public graffiti or a
   * city tree trim). A record read without a title is labelled from its source and subtype only.
   */
  title?: string | null;
  summary?: string | null;
  /** Record kind ('permit', 'civic', ...). Read by the label rules only as a fallback for the subtype. */
  kind?: string | null;
}

export interface MatchRow {
  user_id: string;
  signal_id: number;
  distance_mi: number | null;
}

/** What matchOne found: where it is, and the label this member's trades give the record (lib/signals/lead-rules.ts). */
export interface MatchResult {
  distance_mi: number | null;
  label: OpportunityLabel;
  /** Fix-by, due or response date the record publishes, or null ("No deadline published"). */
  deadline: string | null;
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
 * - then the record must share a trade with the profile's allowed trades, OR (Pro) its title or summary contains one of the
 *   keyword watches as a whole phrase, any case, accents ignored; a keyword match does not need a shared trade
 * The area test runs first because it is cheap and rejects almost every pair; the text test only runs for nearby records.
 * - last, the record's opportunity label for this member's trades (lead-rules.ts). Every label but context is matched and stored for the
 *   feed: act_now and coming_soon are alerts (pushed, emailed), market_insight (a permit in the member's own trade, an awarded
 *   contract) is feed-only (the push and the digest drop it), and context (public graffiti, city tree trims, sewer and catch-basin
 *   work, park events) is not matched at all, so it is never stored, pushed, emailed or shown.
 * Returns the match (distance may be null for state-level) or null.
 */
export function matchOne(signal: MatchSignal, profile: MatchProfile, bidsOn: boolean = bidsEnabled()): MatchResult | null {
  return matchInScope(signal, profile, matchScope(profile), bidsOn);
}

/** The label for a record given the member's allowed trades: the trades they share with the record, or the keyword case (none). */
function labelInScope(signal: MatchSignal, scope: MatchScope): OpportunityLabel {
  const shared = signal.categories.filter((c) => scope.categories.includes(c));
  return labelForTrades({ source: signal.source ?? '', kind: signal.kind ?? null, subtype: subtypeOf(signal), title: signal.title ?? null }, shared);
}

function resultFor(signal: MatchSignal, where: { distance_mi: number | null }, label: OpportunityLabel): MatchResult {
  return { distance_mi: where.distance_mi, label, deadline: deadlineOf({ source: signal.source, data: signal.data as Record<string, unknown> | null | undefined }) };
}

function areaMatch(signal: MatchSignal, profile: MatchProfile, scope: MatchScope, bidsOn: boolean): { distance_mi: number | null } | null {
  // City bids (HOLLER_BIDS_ENABLED, lib/signals/bid-sources.ts): with the flag off no bid row matches anyone, whether it was just fetched
  // or stored earlier. First test, before any area or text work.
  if (!bidsOn && isBidSignal(signal)) return null;
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

function tradeMatch(signal: MatchSignal, scope: MatchScope): boolean {
  return signal.categories.length > 0 && scope.categories.length > 0 && signal.categories.some((c) => scope.categories.includes(c));
}

function matchInScope(signal: MatchSignal, profile: MatchProfile, scope: MatchScope, bidsOn: boolean): MatchResult | null {
  const where = areaMatch(signal, profile, scope, bidsOn);
  if (!where) return null;
  if (!tradeMatch(signal, scope)) {
    if (scope.phrases.length === 0) return null;
    if (phraseIndex(searchText(signal), scope.phrases) < 0) return null;
  }
  const label = labelInScope(signal, scope);
  return isFeedLabel(label) ? resultFor(signal, where, label) : null;
}

export function subtypeOf(s: Pick<MatchSignal, 'subtype' | 'data'>): string | null {
  if (typeof s.subtype === 'string' && s.subtype) return s.subtype;
  const d = s.data?.subtype;
  return typeof d === 'string' && d ? d : null;
}

export interface Hit {
  s: MatchSignal;
  distance_mi: number | null;
  /** The record's label for this member. Absent (older callers, tests) counts as coming_soon. */
  label?: OpportunityLabel;
}

const labelRank = (h: Hit) => LABEL_RANK[h.label ?? 'coming_soon'];

/** A start time in the future ranks as "now": a record dated next year never outranks a fresh one of the same severity. */
function rankTime(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.min(t, nowMs) : 0;
}

/**
 * Pick one user's rows: business rows are limited to `maxBusiness` (closest first, then newest). What is CUT at `cap` goes by: a severe
 * (3+) alert first, then Act Now, Coming soon, Market insight, then most severe, newest (future dates clamped to now). What is KEPT is
 * returned Act Now first (item 0.3), then Coming soon, Market insight, most severe, newest. So 25 heat complaints never push a
 * severity-3 warning out of the cap, and market_insight rows are the first to go.
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
  const byLabel = (a: Hit, b: Hit) => labelRank(a) - labelRank(b) || b.s.severity - a.s.severity || rankTime(b.s.occurred_at, nowMs) - rankTime(a.s.occurred_at, nowMs);
  const severeAlert = (h: Hit) => h.s.severity >= 3 && isAlertLabel(h.label ?? 'coming_soon');
  const cutOrder = (a: Hit, b: Hit) => Number(severeAlert(b)) - Number(severeAlert(a)) || byLabel(a, b);
  return keep.sort(cutOrder).slice(0, cap).sort(byLabel);
}

/**
 * Match new signals to profiles. Per user: business rows capped, then most severe first, then newest, capped at `cap`.
 * Cost control (P1-2): the area test runs before any text test; each record's searchable text is built at most once per scan; and
 * the answer to "does record i contain phrase p" is kept for the scan, so profiles that watch the same phrase share the work.
 */
export function matchSignals(
  signals: MatchSignal[],
  profiles: MatchProfile[],
  cap = MAX_MATCHES_PER_USER,
  now: Date = new Date(),
  /** City bids on or off for this call. Defaults to the HOLLER_BIDS_ENABLED flag, read once per call. */
  bidsOn: boolean = bidsEnabled(),
): MatchRow[] {
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
      const where = areaMatch(s, p, scope, bidsOn);
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
      // Context records are left out here (item 0.2). market_insight is kept for the feed; the push and the digest drop it (item 1.1).
      const label = labelInScope(s, scope);
      if (!isFeedLabel(label)) continue;
      hits.push({ s, distance_mi: where.distance_mi, label });
    }
    for (const h of pickHits(hits, now.getTime(), cap)) out.push({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi });
  }
  return out;
}
