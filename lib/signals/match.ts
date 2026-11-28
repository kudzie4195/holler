import { haversineMi } from '@/lib/geo';
import { matchScope, phraseIndex, searchText, type MatchScope } from '@/lib/plan';
import { approxReachMi, hasApproxLocation, hasApproxReach } from './approx-location';
import { cannotBeDelivered, deadlineOf, isAlertLabel, isFeedLabel, labelFor, LABEL_RANK, pwDecides, pwMemberLabel, pwRuleOf, STATE_LEVEL_MIN_SEVERITY, type LabelInput, type OpportunityLabel } from './lead-rules';
import { isPwMember, PW_TRADE } from './pw-switch';
import { stormFactsOf } from './wind-damage';
import { weatherFactsOf } from './weather-hazard';
import { bidsEnabled, erateHidden, isBidSignal } from './bid-sources';
import { carriedTrades } from './permit-routing';
import { isExactTradeFit, scoreOf, valueUsdOf } from './score';
import type { CategoryId } from './categories';
import { alertHoldFor, type AlertHold, type ContactPath, type GateInput } from './alert-gate';
import { propertyDrops, workTypeDrops, workProfileOf, type WorkColumns, type WorkProfile } from './work-profile';
import { isProbationSource } from './probation';
import { businessTagFixEnabled } from './mapping/business-flag';

export const MAX_MATCHES_PER_USER = 25;
/**
 * New-business license rows are tagged for six trades at once, so on a busy city a cleaning or insurance user would fill the whole
 * 25-row cap with licenses. At most this many `business` rows per user per scan (and per backfill), nearest first.
 */
export const MAX_BUSINESS_PER_USER = 5;
/** State-level (no coordinates) signals only match when severity is at least this. Defined with the labels (lead-rules.ts cannotBeDelivered). */
export { STATE_LEVEL_MIN_SEVERITY };

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
  /**
   * Work profile (migration 0027, lib/signals/work-profile.ts): property focus, minimum job value, work type. Absent (before 0027, or
   * left at the defaults) means matching exactly as before.
   */
  work_property?: WorkColumns['work_property'];
  work_min_value?: WorkColumns['work_min_value'];
  work_type?: WorkColumns['work_type'];
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
  data?: { subtype?: unknown; loc?: unknown; approxLocation?: unknown; alertId?: unknown; projectOf?: unknown; type?: unknown; hailInches?: unknown; windDamage?: unknown; comments?: unknown; permitStage?: unknown; setAside?: unknown; maxHailSizeIn?: unknown; maxWindGustMph?: unknown } | null;
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
  /** A company or site is on file for this record (holler_signal_contacts). Read by the score (+30) only; absent counts as no contact. */
  hasContact?: boolean | null;
  /**
   * How a member can act on this record (lib/signals/alert-gate.ts contactPathOf): a named business, a job-site street address, or null
   * for neither. Set by the scan for the permits it just stored. undefined = not known: never held by the contact gate.
   */
  contactPath?: ContactPath | null;
}

export interface MatchRow {
  user_id: string;
  signal_id: number;
  distance_mi: number | null;
  /**
   * Set only when the card is feed-only (lib/signals/alert-gate.ts): written to holler_matches.alert_hold (migration 0027). Absent on every
   * card that goes out as before, so those rows are byte-for-byte the rows of earlier rounds.
   */
  alert_hold?: AlertHold;
  /** Set by the scan on a held row only (round 18 review P3-4): stored as already handled, so the email and push reads never see it. */
  notified?: boolean;
  pushed_at?: string;
}

/** What matchOne found: where it is, and the label this member's trades give the record (lib/signals/lead-rules.ts). */
export interface MatchResult {
  distance_mi: number | null;
  label: OpportunityLabel;
  /** Fix-by, due or response date the record publishes, or null ("No deadline published"). */
  deadline: string | null;
  /** The member trade that gave the label (null: a keyword-only match). */
  trade: string | null;
  /** Deterministic score v1 (lib/signals/score.ts) without the competition term: this path does not hold the member list. */
  score: number;
  /** Feed-only reason (lib/signals/alert-gate.ts). Absent: the card goes out as an alert as its label says. */
  hold?: AlertHold;
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
export function matchOne(signal: MatchSignal, profile: MatchProfile, bidsOn: boolean = bidsEnabled(), nowMs: number = Date.now()): MatchResult | null {
  return matchInScope(signal, profile, matchScope(profile), bidsOn, nowMs);
}

const labelInputOf = (signal: MatchSignal): LabelInput => ({
  source: signal.source ?? '',
  kind: signal.kind ?? null,
  subtype: subtypeOf(signal),
  title: signal.title ?? null,
  summary: signal.summary ?? null,
  // An SPC report's own fields decide its storm label when the row carries its data (round 18 integration).
  storm: stormFactsOf(signal.source, signal.data),
  // Round 33: an alert's hail size and gust (null while HOLLER_HAIL_ROUTING_ENABLED is off, so nothing changes then).
  weather: weatherFactsOf({ source: signal.source, title: signal.title, summary: signal.summary, data: signal.data as Record<string, unknown> | null | undefined }),
  permitStage: signal.data?.permitStage,
  // Federal notices (round 33): a sole-source set-aside is a heads-up, read only while HOLLER_SAM_LABELS_ENABLED is on.
  ...(typeof signal.data?.setAside === 'string' ? { setAside: signal.data.setAside } : {}),
  // Where the record is (review P3 item 18: a federal bid with no point is feed only): the same rules decide here as on every surface.
  lat: signal.lat,
  lon: signal.lon,
  state: signal.state,
  severity: signal.severity,
});

/**
 * The trades that see a record: its own tags plus, for a building permit, the trades downstream of the permit type read from its TITLE
 * (lib/signals/permit-routing.ts, PLAN-2.0 item 1.1). Computed once per record per scan.
 */
function seenBy(signal: MatchSignal): readonly string[] {
  const weather = weatherFactsOf({ source: signal.source, title: signal.title, summary: signal.summary, data: signal.data as Record<string, unknown> | null | undefined });
  return carriedTrades({ source: signal.source, kind: signal.kind, subtype: subtypeOf(signal), title: signal.title, summary: signal.summary, weather }, signal.categories);
}

/**
 * The label for a record given the member's allowed trades: the trades they share with the record (its tags and the trades downstream
 * of its permit type), or the keyword case (none). Also returns the trade that gave the strongest label (null for a keyword match).
 */
function labelInScope(signal: MatchSignal, cats: readonly string[], scope: MatchScope): { label: OpportunityLabel; trade: string | null } {
  const input = labelInputOf(signal);
  const shared = cats.filter((c) => scope.categories.includes(c));
  // Round 35 (HOLLER_PW_RULES_ENABLED): a pressure-washing member's record is labelled by the pw rules (lead-rules.ts pwMemberLabel).
  if (isPwMember(scope.categories) && pwDecides(input)) return pwMemberLabel(input, shared);
  if (shared.length === 0) return { label: labelFor(input, null), trade: null };
  let label: OpportunityLabel = 'context';
  let trade: string | null = null;
  let rank = LABEL_RANK.context;
  for (const t of shared) {
    const l = labelFor(input, t as CategoryId);
    if (LABEL_RANK[l] < rank) {
      label = l;
      trade = t;
      rank = LABEL_RANK[l];
    }
  }
  return { label, trade };
}

/** Score v1 for one hit. `competitors` is the member count of the trade near the record (the member included), or null when unknown. */
function scoreHit(signal: MatchSignal, trade: string | null, nowMs: number, competitors: number | null): number {
  return scoreOf({
    hasContact: signal.hasContact,
    valueUsd: valueUsdOf({ summary: signal.summary, data: signal.data as { [k: string]: unknown } | null | undefined }),
    occurredAt: signal.occurred_at,
    nowMs,
    tradeFit: isExactTradeFit(labelInputOf(signal), signal.categories, trade),
    competitors,
  }).score;
}

function resultFor(signal: MatchSignal, where: { distance_mi: number | null }, label: OpportunityLabel, trade: string | null, nowMs: number, hold: AlertHold | null): MatchResult {
  return {
    distance_mi: where.distance_mi,
    label,
    deadline: deadlineOf({ source: signal.source, data: signal.data as Record<string, unknown> | null | undefined }),
    trade,
    score: scoreHit(signal, trade, nowMs, null),
    ...(hold ? { hold } : {}),
  };
}

/**
 * The area test alone (no trade, no label): is this record inside one of the member's areas, by the feed's own rules (radius, stand-in
 * reach, the state-level rule for records without coordinates). Read-only helpers use it (lib/builders/load.ts); matching itself
 * calls areaMatch through matchInScope.
 */
export function matchArea(signal: MatchSignal, profile: MatchProfile, bidsOn: boolean = bidsEnabled()): { distance_mi: number | null } | null {
  if (isProbationSource(signal.source)) return null; // probation rows are never shown, the builders panel included
  return areaMatch(signal, profile, matchScope(profile), bidsOn);
}

/** What the work profile and the alert gate read from a record. */
function gateInputOf(signal: MatchSignal): GateInput {
  return {
    source: signal.source ?? '',
    kind: signal.kind ?? null,
    subtype: subtypeOf(signal),
    title: signal.title ?? null,
    summary: signal.summary ?? null,
    data: (signal.data as { [k: string]: unknown } | null | undefined) ?? null,
    contactPath: signal.contactPath,
  };
}

/**
 * The work-type filter (migration 0027) for this card: only when the member's trade does the permitted work (the record carries the trade
 * as its own tag and the label rule is not a downstream route, score.ts isExactTradeFit). Downstream trades and keyword matches are never
 * filtered by the kind of work on the record.
 */
function workTypeFilters(signal: MatchSignal, trade: string | null, gate: GateInput, work: WorkProfile | null): boolean {
  if (!work || work.workType === 'both') return false;
  return isExactTradeFit(labelInputOf(signal), signal.categories, trade) && workTypeDrops(gate, work);
}

/** The member's work profile (migration 0027), or null when there is none or it is all defaults. */
export function workOfProfile(profile: MatchProfile): WorkProfile | null {
  return workProfileOf(profile);
}

/** The profile without its work settings: what the stale-match prune reads, so a new setting never removes a card a member already has. */
export function withoutWorkProfile<P extends MatchProfile>(profile: P): P {
  if (!('work_property' in profile) && !('work_min_value' in profile) && !('work_type' in profile)) return profile;
  const copy = { ...profile };
  delete copy.work_property;
  delete copy.work_min_value;
  delete copy.work_type;
  return copy;
}

function areaMatch(signal: MatchSignal, profile: MatchProfile, scope: MatchScope, bidsOn: boolean): { distance_mi: number | null } | null {
  // City bids (HOLLER_BIDS_ENABLED, lib/signals/bid-sources.ts): with the flag off no bid row matches anyone, whether it was just fetched
  // or stored earlier. First test, before any area or text work.
  if (isBidSignal(signal) && (!bidsOn || erateHidden(signal))) return null;
  if (hasCoords(signal.lat, signal.lon)) {
    // A stand-in position (Cobb County rows sit at the county seat): the real site can be up to APPROX_MATCH_SLACK_MI from it, so the
    // record matches a member within radius + that slack. No distance is kept for it: there is no real distance to show.
    const approx = hasApproxLocation(signal);
    // The reach slack is for a stand-in that can be up to a county away from the real site (data.loc = 'approx', the Cobb feeds, city bids). A city-centre
    // row flagged only data.approxLocation keeps the member's own radius: it hides the distance, it does not widen the match (round 15 review P2-4).
    const radius = approx && hasApproxReach(signal) ? approxReachMi(profile.radius_mi) : profile.radius_mi;
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

  // A National Weather Service alert with no coordinates is a zone alert (a park, a mountain range, a coastal strip), not a statewide one:
  // matched by state it reached members 100+ miles away (round 15 quality gate: Joshua Tree and Inyo County alerts for Los Angeles).
  // A real statewide record (a FEMA declaration) keeps this branch.
  // The same test the labels use (lead-rules.ts cannotBeDelivered), so a record the matcher can never deliver is never counted as an alert.
  if (cannotBeDelivered(signal)) return null;
  const st = (signal.state as string).toUpperCase();
  if (!scope.areas.some((a) => a.state && a.state.toUpperCase() === st)) return null;
  return { distance_mi: null };
}

function tradeMatch(cats: readonly string[], scope: MatchScope): boolean {
  return cats.length > 0 && scope.categories.length > 0 && cats.some((c) => scope.categories.includes(c));
}

/**
 * Round 35 (HOLLER_PW_RULES_ENABLED): a pressure-washing member also sees a record that carries none of their trades when the pw rules want
 * it (a painting, fence or deck permit, a storefront licence, a wind damage report). Off, or for any other member, always false.
 */
function pwSees(signal: MatchSignal, scope: MatchScope): boolean {
  if (!isPwMember(scope.categories)) return false;
  const input = labelInputOf(signal);
  return pwDecides(input) && pwRuleOf(input).label !== 'context';
}

/**
 * A record stored as the same project as an earlier record (data.projectOf = "source:external id" of that record, written at insert by
 * lib/signals/projects.ts) never makes a card of its own: the earlier record is the project's card. Read by every matching path (scan,
 * onboarding and settings backfill, rematch), so a second listing of one project cannot reach a member as a second card.
 */
export function isFollower(s: Pick<MatchSignal, 'data'>): boolean {
  const v = s.data?.projectOf;
  return typeof v === 'string' && v.length > 0;
}

function matchInScope(signal: MatchSignal, profile: MatchProfile, scope: MatchScope, bidsOn: boolean, nowMs: number): MatchResult | null {
  // A source on probation (round 19) never makes a card, whatever its row says; checked before the contact gate, which it never reads.
  if (isFollower(signal) || isProbationSource(signal.source)) return null;
  const where = areaMatch(signal, profile, scope, bidsOn);
  if (!where) return null;
  const cats = seenBy(signal);
  if (!tradeMatch(cats, scope) && !pwSees(signal, scope)) {
    if (scope.phrases.length === 0) return null;
    if (phraseIndex(searchText(signal), scope.phrases) < 0) return null;
  }
  // Work profile (migration 0027): property focus and work type rule a record out only when the record states them.
  const work = workOfProfile(profile);
  const gate = gateInputOf(signal);
  if (propertyDrops(gate, work)) return null;
  const { label, trade } = labelInScope(signal, cats, scope);
  if (workTypeFilters(signal, trade, gate, work)) return null;
  return isFeedLabel(label) ? resultFor(signal, where, label, trade, nowMs, alertHoldFor(gate, label, trade, work)) : null;
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
  /** Deterministic score v1 (lib/signals/score.ts). Absent counts as 0, so a caller that never scores keeps the old order. */
  score?: number;
  /** The member trade that gave the label (null: keyword-only match). */
  trade?: string | null;
  /** Feed-only reason (lib/signals/alert-gate.ts). A held card ranks with the market insights: it is not an alert. Absent: none. */
  hold?: AlertHold | null;
}

const labelRank = (h: Hit) => (h.hold ? LABEL_RANK.market_insight : LABEL_RANK[h.label ?? 'coming_soon']);
const scoreOfHit = (h: Hit) => h.score ?? 0;

/** A start time in the future ranks as "now": a record dated next year never outranks a fresh one of the same severity. */
function rankTime(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.min(t, nowMs) : 0;
}

/**
 * Pick one user's rows: business rows are limited to `maxBusiness` (closest first, then newest; with HOLLER_BUSINESS_TAG_FIX_ENABLED on, rows that go out as alerts before feed-only ones). What is CUT at `cap` goes by: a severe
 * (3+) alert first, then Act Now, Coming soon, Market insight, then the score (item 2.7, high first), then most severe, newest (future
 * dates clamped to now). What is KEPT is returned Act Now first (item 0.3), then Coming soon, Market insight, score, most severe, newest. So 25 heat complaints never push a
 * severity-3 warning out of the cap, and market_insight rows are the first to go.
 */
export function pickHits(hitsIn: Hit[], nowMs: number, cap = MAX_MATCHES_PER_USER, maxBusiness = MAX_BUSINESS_PER_USER): Hit[] {
  // One alert that covers several counties is stored as one row per county (adapters/nws.ts data.alertId). A member near two of them gets the
  // alert once: the first county row that matched.
  const alerts = new Set<string>();
  const hits = hitsIn.filter((h) => {
    const id = h.s.data?.alertId;
    if (typeof id !== 'string' || !id) return true;
    const key = `${h.s.source ?? ''}|${id}`;
    if (alerts.has(key)) return false;
    alerts.add(key);
    return true;
  });
  const isBiz = (h: Hit) => subtypeOf(h.s) === 'business';
  // Round 33 (review 3, P2-1): with the switch on, a feed-only licence (hold) never takes one of the business places from a licence that
  // names a business and goes out as an alert: un-held rows come first, then nearest, then newest. Switch off: nearest first, as before.
  const holdLast = businessTagFixEnabled();
  const biz = hits
    .filter(isBiz)
    .sort(
      (a, b) =>
        (holdLast ? Number(!!a.hold) - Number(!!b.hold) : 0) ||
        (a.distance_mi ?? Infinity) - (b.distance_mi ?? Infinity) ||
        rankTime(b.s.occurred_at, nowMs) - rankTime(a.s.occurred_at, nowMs),
    )
    .slice(0, maxBusiness);
  const keep = [...hits.filter((h) => !isBiz(h)), ...biz];
  const byLabel = (a: Hit, b: Hit) => labelRank(a) - labelRank(b) || scoreOfHit(b) - scoreOfHit(a) || b.s.severity - a.s.severity || rankTime(b.s.occurred_at, nowMs) - rankTime(a.s.occurred_at, nowMs);
  const severeAlert = (h: Hit) => h.s.severity >= 3 && !h.hold && isAlertLabel(h.label ?? 'coming_soon');
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
  const nowMs = now.getTime();
  const texts: (string | undefined)[] = new Array(n);
  /** Trades that see each record (its tags and the trades downstream of its permit type), computed once per record. */
  const seen: (readonly string[] | undefined)[] = new Array(n);
  /** phrase -> per record: 0 not tested yet, 1 contains it, 2 does not. */
  const phraseCache = new Map<string, Uint8Array>();
  /** Per profile: its hits, kept until every profile has been read so the competition count (members per record and trade) is complete. */
  const perProfile: { p: MatchProfile; hits: Hit[]; idx: number[] }[] = [];
  /** `${record index}\u0000${trade}` -> members of that trade who see the record (score v1, low competition). */
  const members = new Map<string, number>();
  const gates: (GateInput | undefined)[] = new Array(n);
  for (const p of profiles) {
    const scope = matchScope(p); // once per profile, not once per record
    const pwOn = isPwMember(scope.categories);
    const work = workOfProfile(p);
    const slots: (Uint8Array | undefined)[] = new Array(scope.phrases.length);
    const hits: Hit[] = [];
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = signals[i];
      if (isFollower(s) || isProbationSource(s.source)) continue; // probation: samples only, never a card (round 19)
      const where = areaMatch(s, p, scope, bidsOn);
      if (!where) continue;
      const cats = (seen[i] ??= seenBy(s));
      if (!tradeMatch(cats, scope) && !(pwOn && pwSees(s, scope))) {
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
      const gate = (gates[i] ??= gateInputOf(s));
      // Work profile (migration 0027): a record that states a class the member does not take is not matched.
      if (work && propertyDrops(gate, work)) continue;
      // Context records are left out here (item 0.2). market_insight is kept for the feed; the push and the digest drop it (item 1.1).
      const { label, trade } = labelInScope(s, cats, scope);
      if (!isFeedLabel(label)) continue;
      if (work && workTypeFilters(s, trade, gate, work)) continue;
      const mine = cats.filter((c) => scope.categories.includes(c));
      if (trade === PW_TRADE) mine.push(PW_TRADE); // round 35: pw members compete with each other for a pw card
      for (const t of mine) members.set(`${i}\u0000${t}`, (members.get(`${i}\u0000${t}`) ?? 0) + 1);
      const hold = alertHoldFor(gate, label, trade, work);
      hits.push({ s, distance_mi: where.distance_mi, label, trade, ...(hold ? { hold } : {}) });
      idx.push(i);
    }
    perProfile.push({ p, hits, idx });
  }
  for (const { p, hits, idx } of perProfile) {
    for (let k = 0; k < hits.length; k++) {
      const h = hits[k];
      const competitors = h.trade ? (members.get(`${idx[k]}\u0000${h.trade}`) ?? null) : null;
      h.score = scoreHit(h.s, h.trade ?? null, nowMs, competitors);
    }
    for (const h of pickHits(hits, nowMs, cap)) out.push({ user_id: p.user_id, signal_id: h.s.id, distance_mi: h.distance_mi, ...(h.hold ? { alert_hold: h.hold } : {}) });
  }
  return out;
}

/**
 * How many of `profiles` see this record under `trade` (area, plan limits and label all pass, and the trade is one they hold and the
 * record carries). The member counts themselves. Same rules as matchSignals' own tally, for the admin score report: it holds the member
 * list already, so this is arithmetic over memory, never a query.
 */
export function membersOfTrade(signal: MatchSignal, trade: string, profiles: readonly MatchProfile[], bidsOn: boolean = bidsEnabled()): number {
  if (isProbationSource(signal.source)) return 0;
  const cats = seenBy(signal);
  if (!cats.includes(trade)) return 0;
  let n = 0;
  for (const p of profiles) {
    const scope = matchScope(p);
    if (!scope.categories.includes(trade)) continue;
    if (!areaMatch(signal, p, scope, bidsOn)) continue;
    const work = workOfProfile(p);
    const gate = gateInputOf(signal);
    if (propertyDrops(gate, work)) continue;
    const { label, trade: t } = labelInScope(signal, cats, scope);
    if (isFeedLabel(label) && !workTypeFilters(signal, t, gate, work)) n++;
  }
  return n;
}
