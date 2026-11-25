import type { CategoryId } from './categories';
import {
  ABATEMENT_RE,
  FINISHED_STAGES,
  FINISHED_STAGE_TRADES,
  HEATING_ENCLOSURE_RE,
  hasHeatMark,
  SEWAGE_BACKUP_RE,
  hailInchesOf,
  isHailReport,
  isPaperworkOrder,
  isTornadoReport,
  isWindDamageReport,
  kcPropertyTrades,
  nwsEventOf,
  orderText,
  titleBodyOf,
  violationTradeRoles,
  violationTrades,
  weatherRowFor,
  windDamageLevel,
} from './carry';
import { carriedTrades, permitLabelsOf, routeFor, routeKindsOf, type RouteKind } from './permit-routing';
import { jobValueOf } from './permit-value';
import { ruleChoice, type RuleChoices } from './rule-choices';
import { isSoleSourceSetAside, samLabelsEnabled } from './sam-labels-switch';

/**
 * Opportunity labels (PLAN-2.0 section 3, items 0.1 to 0.3). Every (signal, trade) pair gets exactly one label, and the label decides
 * delivery:
 *   act_now         someone must or has asked to buy: a code violation, a no-heat building, a failed food inspection, a sewage
 *                   back-up, a damage or hail report, a private-property graffiti request, a resident request on Holler, an open
 *                   federal bid. Delivered at once, shown first, with a deadline or "No deadline published".
 *   coming_soon     evidence of likely future demand (weather alerts, measured wind gusts, other 311 requests, new-home permits for
 *                   real estate and movers). Delivered in the digest.
 *   market_insight  a trend or competitor activity: a permit in the member's OWN trade (the job is already won), an awarded contract.
 *                   FEED ONLY: stored, shown in the app feed after every alert with the "Market insight" chip, never pushed and never
 *                   emailed. (Round 13 review P0-2: without it a roofer near Smyrna, the only live member, would see nothing.)
 *   context         city work, public property, generic records. Never alerted and never shown. Public pages may still use the rows.
 *
 * This file extends lib/signals/intent.ts (demand / spending / asking says what the record IS; the label says what to DO with it).
 * It is a typed code table, not the `holler_lead_rules` database table PLAN-2.0 named: no live migration is needed, the table is
 * pure and client-safe, and every rule is unit-tested and reviewed in a pull request. Moving it to a table later changes only where
 * RULES is read from.
 *
 * Wording: a weather event never proves damage and a permit never proves a vendor is being chosen, so no label or reason here says so.
 * Pure and client-safe: no server imports, no clock, no randomness. Same input, same label.
 *
 * How a label is chosen (first hit wins):
 *   1. RULES, in order: source, kind or subtype, a title pattern, and the member's trade. A title pattern is tested against the part
 *      of the title AFTER the first ": " ("311 request in Oak Park: Graffiti" is tested as "Graffiti"), so a city name never fires it.
 *   2. SOURCE_DEFAULTS: one explicit entry for every registered source (tests/signals/lead-rules.test.ts fails when one is missing).
 *   3. FALLBACK_LABEL for a source nobody listed: coming_soon, which is what such a row was before (it was alerted), so an unknown
 *      never silently disappears. act_now and context are given only by an explicit rule.
 *
 * STABLE API (other units build on it; change the signatures only with the callers):
 *   labelFor(sig, trade | null)                 one record, one trade
 *   labelForTrades(sig, trades)                 best label across trades (act_now beats coming_soon beats market_insight beats context)
 *   labelForMember(sig + categories, memberTrades)   what every surface calls: the member's plan trades that the record carries (a building
 *                                                    permit also "carries" the trades downstream of its type, lib/signals/permit-routing.ts)
 *   isAlertLabel(label)      act_now | coming_soon: pushed and emailed.  isFeedLabel(label): anything but context: shown in the app feed.
 *   orderByLabel(items, labelOf)                stable, Act Now first
 *   demoteExpired(label, deadline, nowMs)       an Act Now whose published deadline has passed becomes coming_soon
 *   deadlineOf(row)  DEADLINE_SELECT  deadlineLine(deadline)   the deadline and its card line (accepted fields: see DEADLINE_KEYS)
 *   tradeNoLiveSource(trade)                    locksmith and business-services: no source can reach them yet
 * ADDING A SOURCE (for example r13-bids): add one SOURCE_DEFAULTS entry with the registered adapter id (the registry test fails until
 * you do). A solicitation that is open for bids is act_now; list any new data key that holds a real response date in DEADLINE_KEYS.
 */
export type OpportunityLabel = 'act_now' | 'coming_soon' | 'market_insight' | 'context';

export const OPPORTUNITY_LABELS: readonly OpportunityLabel[] = ['act_now', 'coming_soon', 'market_insight', 'context'];

/** Chip text on cards and in the digest. Context has no chip because it is never shown as an alert. */
export const OPPORTUNITY_CHIP: Record<OpportunityLabel, string> = {
  act_now: 'Act now',
  coming_soon: 'Work may follow',
  market_insight: 'Market insight',
  context: 'Context',
};

/** One plain line under the chip: what the label means, never more than the record says. */
export const OPPORTUNITY_NOTE: Record<OpportunityLabel, string> = {
  act_now: 'Someone has to act on this or has asked for help.',
  coming_soon: 'This points to work that may come later. Nothing is confirmed.',
  market_insight: 'This shows what is happening in your market. It is not a request for your trade.',
  context: 'General public record.',
};

/** Smaller sorts first. */
export const LABEL_RANK: Record<OpportunityLabel, number> = { act_now: 0, coming_soon: 1, market_insight: 2, context: 3 };

/** Labels that are alerts (matched, pushed, emailed). Market insight waits for the weekly email; context is never alerted. */
export function isAlertLabel(label: OpportunityLabel): boolean {
  return label === 'act_now' || label === 'coming_soon';
}

/** Labels shown in the app feed: everything but context. market_insight is feed-only (never pushed or emailed). */
export function isFeedLabel(label: OpportunityLabel): boolean {
  return label !== 'context';
}

export interface LabelInput {
  source: string;
  kind?: string | null;
  /** data.subtype of the record ('permit', '311', 'violation', ...). */
  subtype?: string | null;
  title?: string | null;
  /** The record's summary. A permit's holds its structured type and class, which routing reads (permit-routing.ts). Optional. */
  summary?: string | null;
  /** Federal notices: data.setAside (round 33). Read only with HOLLER_SAM_LABELS_ENABLED on: a sole-source notice is a heads-up. Optional. */
  setAside?: string | null;
  /**
   * An SPC storm report's own structured fields (lib/signals/wind-damage.ts stormFactsOf, from data.type, data.hailInches and the wind
   * damage flag). When present the storm rule reads only these; absent (a row read without its data), it falls back to the title.
   */
  storm?: StormFacts | null;
  /**
   * Where the record is, for the one question a label must agree with delivery on: can ANY member ever receive it (cannotBeDelivered)?
   * Pass all four from a stored row (the replay, the matcher). Leave them out (undefined) when the caller already holds a delivered match:
   * the check is then skipped, because a delivered record was deliverable.
   */
  lat?: number | null;
  lon?: number | null;
  state?: string | null;
  severity?: number | null;
  /**
   * data.permitStage of a permit (lib/signals/stage.ts, migration 0025 feature): every surface that labels a stored match passes it from
   * STAGE_SELECT, so a stage update keeps the label it had before round 19 (rule stage-finished-downstream). Absent: no stage known.
   */
  permitStage?: unknown;
}

/** What the SPC adapter stored about a storm report (round 18 integration). */
export interface StormFacts {
  type: 'hail' | 'wind' | 'torn';
  /** Hail size in inches; the adapter stores only 1.00 in and larger. */
  hailInches?: number | null;
  /** A wind report whose remark names damage to a thing (remarkNamesWindDamage): the adapter's damage flag. */
  windDamage?: boolean | null;
}

export interface LabelRule {
  id: string;
  label: OpportunityLabel;
  /** Why, in one line (shown in tests and the replay report, never to members). */
  why: string;
  /** Source ids this rule is for. Absent means any source. */
  sources?: readonly string[];
  /** The record is a building permit (data.subtype or kind is 'permit'). */
  permit?: boolean;
  /** data.subtype values this rule is for. Absent means any. */
  subtypes?: readonly string[];
  /** Tested against the record's public title (the part after "Place: ", see titleBody). */
  title?: RegExp;
  /**
   * The storm-report rule (round 18 integration): the report's structured fields decide (a tornado, hail of 1.00 in or more, a wind report
   * whose remark names damage); a row without them falls back to STORM_TITLE_WORDS on the title's event part (before " near "), with word
   * boundaries, so a place name ("Hailey", "Haile", "Tornado Rd", "Damascus") never makes a report urgent.
   */
  storm?: true;
  /** Test `title` against the whole title instead: for sources whose title starts with the event name ("Flood Advisory: Los Angeles, CA"). */
  wholeTitle?: boolean;
  /** Trades this rule is for. A rule with trades never fires when no trade is known (a keyword-only match). */
  trades?: readonly CategoryId[];
  /** Fires only when the member's trade is known. */
  needsTrade?: boolean;
  /**
   * Fires only when the permit's own TITLE makes this trade downstream of the permit (lib/signals/permit-routing.ts routeFor: a re-roof
   * for gutters, a new building for landscaping). Never reads a trade tag.
   */
  routed?: boolean;
  /** Fires only when the trade is downstream of the permit through one of these route kinds (implies `routed`). */
  routes?: readonly RouteKind[];
  /**
   * The label comes from another trade's permit, not from the member's own trade's work. Read by the deterministic score
   * (lib/signals/score.ts): a downstream pair is not an exact trade fit.
   */
  downstream?: boolean;
  /** Any other test on the record's own fields. All the tests above must pass first. */
  when?: (sig: LabelInput, trade: CategoryId | null) => boolean;
  /** A label read from the record (a table cell, a size). Returning null means the rule does not fire. Overrides `label`. */
  pick?: (sig: LabelInput, trade: CategoryId | null) => OpportunityLabel | null;
  /** The line(s) of the round 19 audit list this rule implements (review-ENGINE-compare.md section 5). Report and tests only. */
  line?: number | readonly number[];
  /** The owner's call this rule reads (lib/signals/rule-choices.ts). Report and tests only. */
  choice?: keyof RuleChoices;
}

const PUBLIC_POSTS = ['bluesky', 'websearch-brave', 'websearch-serper'] as const;

// ---- record facts the rules read ------------------------------------------------------------------------------------------------

const lc = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * Line 5 (engine B's CLOSED_RE): a summary part that is a closing status. Read from the live rows: "Healthy Homes | Closed", Austin
 * "CLOS-*" case statuses, DeKalb "Complied". Matches a whole " | " part only, so "Closed Captioning" in a name never fires.
 */
const CLOSED_RE = /(?:^|\|)\s*(?:closed|clos-[a-z]+|clos|complied|resolved|compliance achieved|case closed|no violation|cancell?ed|duplicate)\s*(?:\||$)/i;
export const isClosedCase = (sig: LabelInput) => CLOSED_RE.test(sig.summary ?? '');

/** Line 2: the body names hot water alone. No live row does; tests/signals/rules-audit.test.ts has a fixture. */
const HOT_WATER_ONLY_RE = /no hot water|hot water only|water only/i;
const NYC_HEAT_RE = /^heat\/hot water\b/i;

/** Line 64: a fire-protection work type in the permit's structured summary (live rows 764, 817, 9559 "Sprinklers", 3174 "Sprinkler and Standpipe"). */
// Review P3 item 16: a bare "Sprinkler System" may be a lawn system, so only "fire sprinkler(s) (system(s))", "sprinkler(s) and standpipe(s)",
// a standpipe or fire suppression/protection is a fire job; the bare base-era "Sprinkler(s)" type stays one, as the mapping has it.
export const FIRE_PROTECTION_PART_RE = /^sprinklers?$|^fire\s+sprinklers?(?:\s+systems?)?$|^(?:fire\s+)?sprinklers?\s+and\s+standpipes?$|^(?:fire\s+)?standpipes?(?:\s+systems?)?$|^fire\s+(?:suppression|protection)(?:\s+systems?)?$/i;

const sumParts = (summary: string | null | undefined) => (summary ?? '').split(' | ').map((p) => p.trim()).filter(Boolean);
export const isFireProtectionPermit = (sig: LabelInput) => sumParts(sig.summary).some((p) => FIRE_PROTECTION_PART_RE.test(p));

/** Trade sub-permits under a bigger job (lines 50, 57, 61): the follow-on work is on the main permit, not this one. */
const SUB_PERMIT_LABELS = ['hvac', 'plumbing', 'electrical', 'water heater'];
/** Line 56: a summary that states a residential class. */
const RESIDENTIAL_CLASS_RE = /\bresidential\b|single[\s-]?family|\bduplex\b|\btownho(?:me|use)s?\b|\bdwelling\b|\(r\)/i;
/**
 * Round 28 review: Austin (permit_class_mapped) and Raleigh (permitclassmapped) print a bare "Residential" on EVERY residential permit, a
 * pool, carport, retaining wall or porch included (Austin permit classes R-329, R-330 and R-438: 69 of the 250 new residential building
 * permits issued in the 30 days to 2026-11-24). On these sources that bare part does not state a new home; a part that names a dwelling
 * ("New Residential Dwelling") still does. "Non-Residential" never states one.
 */
const MAPPED_CLASS_SOURCES: ReadonlySet<string> = new Set(['socrata-austin-permits', 'arcgis-raleigh-permits']);
const BARE_MAPPED_CLASS_RE = /^(?:non[\s-]?)?residential$/i;
const statesResidentialClass = (s: LabelInput) =>
  MAPPED_CLASS_SOURCES.has(s.source ?? '')
    ? sumParts(s.summary).some((p) => !BARE_MAPPED_CLASS_RE.test(p) && RESIDENTIAL_CLASS_RE.test(p))
    : RESIDENTIAL_CLASS_RE.test(s.summary ?? '');
/** Line 61: a pool permit whose structured type is site grading is not a pool build (live row 2482, a $92 grading permit). */
const NOT_A_POOL_PART_RE = /^(?:grading|engineering|earth\s?work|site\s?work)$/i;

interface PermitFacts {
  labels: string[];
  kinds: RouteKind[];
  value: number | null;
  subPermit: boolean;
}

function permitFacts(sig: LabelInput): PermitFacts {
  const labels = permitLabelsOf(sig.title) ?? [];
  return {
    labels,
    kinds: routeKindsOf(sig.title, { summary: sig.summary, source: sig.source }),
    value: jobValueOf({ summary: sig.summary }),
    subPermit: labels.some((l) => SUB_PERMIT_LABELS.includes(l)),
  };
}

const routeOf = (sig: LabelInput, trade: CategoryId | null) => routeFor(sig.title, trade, { summary: sig.summary, source: sig.source });
/** The trade is downstream of this permit and the permit's route kinds include `kind` (a trade can be downstream of two kinds in one title). */
const downstreamVia = (sig: LabelInput, trade: CategoryId | null, kind: RouteKind) => !!routeOf(sig, trade) && permitFacts(sig).kinds.includes(kind);
const isAdditionOnly = (f: PermitFacts) => f.labels.includes('addition') && !f.labels.includes('remodel');
const isNewBuildTitle = (f: PermitFacts) => f.labels.includes('new home') || f.labels.includes('new construction');

/**
 * Line 23 and owner call 4: new licences whose NAME is a storefront where customers come in, per source, exact names from the live rows.
 * Every other licence (a contractor, a home office, a vendor, a consultant, "Limited Business License") names no premises: feed only for
 * signs, security and commercial cleaning. `kind` says which owner call decides it.
 */
export type StorefrontKind = 'shop' | 'food' | 'parking' | 'storage';

export const STOREFRONT_LICENCES: Readonly<Record<string, ReadonlyArray<{ re: RegExp; kind: StorefrontKind }>>> = {
  'socrata-nyc-business': [
    // NOT "Electronics" (review P2-7): owner call 4 is about NEW storefronts, and a NYC licence row cannot say whether it is new. The
    // rows carry only business_category (data keys cat_v, dataset, domain, subtype, approxLocation); the adapter reads
    // license_creation_date with license_status = 'Active' and no application type, status change or original issue date
    // (lib/signals/adapters/socrata-datasets.ts, socrata-nyc-business). 257 "Electronics" rows in nine working days (59% of NYC
    // licences) look like a renewal cycle, so they are feed only for signs, security and commercial cleaning.
    { re: /^secondhand dealer\b/i, kind: 'shop' },
    { re: /^pawnbroker$/i, kind: 'shop' },
    { re: /^dealer in products for the disabled$/i, kind: 'shop' },
    { re: /^(?:tobacco retail dealer|electronic cigarette dealer)$/i, kind: 'shop' },
    { re: /^(?:laundries|laundry|laundry jobber)$/i, kind: 'shop' },
    { re: /^garage(?: & parking lot)?$|^parking lot$/i, kind: 'parking' },
    // a storage building: security only (review P3 item 5, row 131662)
    { re: /^self-storage facility$/i, kind: 'storage' },
  ],
  'socrata-chicago-business': [
    { re: /^retail food establishment$/i, kind: 'food' },
    { re: /^tobacco$/i, kind: 'shop' },
    // review P3 item 5: a bar (row 4653), a liquor store (row 4679), an amusement venue (row 4650)
    { re: /^(?:tavern|package goods|public place of amusement)$/i, kind: 'shop' },
    { re: /^motor vehicle services license$/i, kind: 'shop' },
    { re: /^(?:commercial garage|public garage)$/i, kind: 'parking' },
  ],
  'socrata-sf-business': [
    { re: /^retail(?: trade)?$/i, kind: 'shop' },
    { re: /^food service(?: and lodging)?$/i, kind: 'food' },
  ],
  'socrata-la-business': [
    { re: /\b(?:stores?|retailers?)\b/i, kind: 'shop' },
    { re: /^(?:beauty salons|barber shops|nail salons|dry ?cleaning and laundry services.*)$/i, kind: 'shop' },
    { re: /\brestaurants?\b|^drinking places\b|^bakeries\b/i, kind: 'food' },
    { re: /^parking lots (?:&|and) garages$/i, kind: 'parking' },
  ],
  'socrata-orlando-business': [
    { re: /^(?:beauty parlor|health spa|barber shop|retail variety|retail \w+)$/i, kind: 'shop' },
    { re: /^(?:restaurant|take out restau\w*)$/i, kind: 'food' },
    { re: /^parking (?:lot|garage)$/i, kind: 'parking' },
  ],
  'carto-phl-business': [],
};

/** The licence name a business row carries: the title body ("New business license in Chicago: Tobacco" gives "Tobacco"). */
const licenceName = (sig: LabelInput) => titleBodyOf(sig.title).trim();

export function storefrontKindOf(sig: LabelInput): StorefrontKind | null {
  const list = STOREFRONT_LICENCES[lc(sig.source)] ?? [];
  const name = licenceName(sig);
  return list.find((e) => e.re.test(name))?.kind ?? null;
}

/** Line 24: a food premises a pest-control company can serve. Shared kitchens, liquor-only, event liquor and mobile licences are not. */
const isFoodPremises = (sig: LabelInput) => storefrontKindOf(sig) === 'food';
const MOBILE_LICENCE_RE = /mobile food|food truck|peddl|\bcarts?\b|vending|stoop line stand|general vendor/i;

/** Line 27: an event permit that names an event people are hired for (engine B's list). */
const NAMED_EVENT_RE = /festival|fair\b|market|concert|parade|\brace\b|marathon|\b5k\b|wedding|block party|street fair|carnival|expo|tournament/i;
const VENUE_EVENT_RE = /^(?:plaza event|plaza partner event|open street partner event|permit - event \d|venue rental|event \d+ cluster)/i;

/** "M4.6 earthquake ..." gives 4.6 (line 42). */
const quakeMagnitude = (title: string | null | undefined) => {
  const m = /\bM\s?(\d+(?:\.\d+)?)/.exec(title ?? '');
  return m ? parseFloat(m[1]) : NaN;
};

/** Line 44: SAM.gov notices that are not yet a solicitation (the notice type is the summary's first part). */
export const NOT_YET_BID_RE = /presolicitation|sources?\s+sought|special\s+notice|intent\s+to\s+bundle/i;
/**
 * Round 33 (only with HOLLER_SAM_LABELS_ENABLED on): the hyphenated spelling of a presolicitation, and a sole-source notice (the agency names
 * the one business it means to buy from, so it is not open for offers). Both are heads-ups. Off, the rule is exactly what it was.
 */
const EARLY_VARIANT_RE = /pre[-\s]+solicitation/i;
const notYetBid = (s: LabelInput) =>
  NOT_YET_BID_RE.test(sumParts(s.summary)[0] ?? '') || (samLabelsEnabled() && (EARLY_VARIANT_RE.test(sumParts(s.summary)[0] ?? '') || isSoleSourceSetAside(s.setAside)));
/** A bid whose place of performance has a real city name before the state ("Federal bid in Denver, CO: ..."). "0, MI" is not a city. */
const PLACED_BID_RE = /^Federal bid in (?!0,)[^,:]*[A-Za-z][^,:]*, [A-Z]{2}:/;
/** Round 19 UNIFY review, defect 2: a notice that names a state and no city ("Federal bid in GA: ..."). */
const STATEWIDE_BID_RE = /^Federal bid in [A-Z]{2}: /;

// ---- undeliverable rows (criterion 4) -----------------------------------------------------------------------------------------------

/** Records without coordinates match only by state and only at this severity or more (lib/signals/match.ts reads it from here). */
export const STATE_LEVEL_MIN_SEVERITY = 2;

const hasPoint = (lat: unknown, lon: unknown) => typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon);

/**
 * A record no member can ever receive, by the matcher's own area rules (lib/signals/match.ts areaMatch uses this same test): no point, and
 * either an NWS zone alert (never matched by state), or below the state-level severity, or no state. On the live rows: 1,555 NWS zone rows'
 * pairs, every Orlando permit (774 rows) and 587 Austin permits. Its label is context, so a pair on it is never counted as an alert by the
 * replay, the scorecard or the quality dashboard (those two count delivered cards, which such a row never makes).
 */
export function cannotBeDelivered(sig: { source?: string | null; lat?: number | null; lon?: number | null; state?: string | null; severity?: number | null }): boolean {
  if (hasPoint(sig.lat, sig.lon)) return false;
  if (lc(sig.source) === 'nws') return true;
  if (!(typeof sig.severity === 'number' && sig.severity >= STATE_LEVEL_MIN_SEVERITY)) return true;
  return !(typeof sig.state === 'string' && sig.state.trim());
}

/** The caller passed where the record is (any of the four fields). */
const locationGiven = (sig: LabelInput) => sig.lat !== undefined || sig.lon !== undefined;

/**
 * Round 19 RULES: the audited rule list (review-ENGINE-compare.md section 5, 65 lines; `line` on each rule). ORDER MATTERS: the first rule
 * that fits wins. Undeliverable and closed records come first, then each source family's specific rules, then the general ones.
 */
export const RULES: readonly LabelRule[] = [
  // ---- never an alert ------------------------------------------------------------------------------------------------------------
  {
    id: 'ctx-undeliverable',
    label: 'context',
    when: (s) => locationGiven(s) && cannotBeDelivered(s),
    why: 'No member can ever receive this record (no point, and an NWS zone alert, below the state-level severity, or no state), so it is not counted as an alert anywhere.',
  },
  {
    id: 'closed-case',
    label: 'context',
    subtypes: ['311', 'violation', 'inspection'],
    when: (s) => isClosedCase(s),
    // Owner call 8 "no" moves a closed case to the feed, and does nothing else: a record the later rules hide (city work, another
    // trade's order) stays hidden (review P2-4).
    pick: (s, t) => (ruleChoice('closedCaseHidden') || labelAfter('closed-case', s, t) === 'context' ? 'context' : 'market_insight'),
    line: 5,
    choice: 'closedCaseHidden',
    why: 'The case is closed, complied, resolved, cancelled or a duplicate: no job is left. Owner call 8: it disappears, feed included.',
  },

  // ---- federal bids (line 44 and the UNIFY review) ---------------------------------------------------------------------------------
  {
    id: 'mi-bid-statewide',
    label: 'market_insight',
    sources: ['sam-gov'],
    title: STATEWIDE_BID_RE,
    wholeTitle: true,
    why: 'Out for bid, but the notice names a state and no city, so it cannot be placed near the member.',
  },
  {
    // Review P3 item 18: SAM's place of performance names a city the gazetteer could not place, so the row has no point and is matched
    // to the whole state. Whether or not the title names a city, the bid cannot be placed near the member: feed only. Needs the location
    // (every surface that labels a stored match passes it: recordLabelInput).
    id: 'mi-bid-unplaced',
    label: 'market_insight',
    sources: ['sam-gov'],
    when: (s) => locationGiven(s) && !hasPoint(s.lat, s.lon),
    line: 44,
    why: 'A federal bid with no coordinates reaches a whole state: it cannot be placed near the member, so it is feed only.',
  },
  {
    id: 'soon-bid-not-open',
    label: 'coming_soon',
    sources: ['sam-gov'],
    when: (s) => notYetBid(s) || !PLACED_BID_RE.test(s.title ?? ''),
    line: 44,
    why: 'A presolicitation, sources sought, special notice or intent to bundle is not yet open for offers, and a bid with no city of performance cannot be placed: a heads-up, not act now.',
  },
  { id: 'act-open-bid', label: 'act_now', sources: ['sam-gov'], why: 'Out for bid with a response date. Nothing is awarded.' },

  // ---- storm reports (lines 38 to 41) ---------------------------------------------------------------------------------------------
  {
    id: 'spc-insurance',
    label: 'market_insight',
    sources: ['spc'],
    trades: ['insurance', 'public-adjuster'],
    pick: (s) => {
      if (isWindDamageReport(s.title) || isTornadoReport(s.title)) return 'market_insight';
      const inches = isHailReport(s.title) ? hailInchesOf(s.title) : null;
      return inches !== null && inches >= 1 ? 'market_insight' : 'context';
    },
    line: 38,
    why: 'Insurance agents and adjusters see claims after real damage; a storm report is worth knowing, never act now. A measured gust or small hail is nothing for them.',
  },
  {
    id: 'spc-hail',
    label: 'act_now',
    sources: ['spc'],
    trades: ['auto-body', 'auto-glass', 'restoration', 'siding-gutters'],
    when: (s) => isHailReport(s.title),
    pick: (s, t) => {
      const inches = hailInchesOf(s.title) ?? 0;
      if (t === 'restoration') return 'context';
      if (t === 'siding-gutters') return inches >= 1 ? 'act_now' : null;
      return inches >= 1.75 ? 'act_now' : 'market_insight';
    },
    line: 41,
    why: 'Hail: cars are dented by golf-ball size (1.75 inches) and up; siding and gutters from 1 inch; hail is not water or fire damage for restoration.',
  },
  {
    id: 'spc-gust',
    label: 'market_insight',
    sources: ['spc'],
    trades: ['roofing', 'restoration'],
    when: (s) => /wind gust/i.test(s.title ?? ''),
    line: 40,
    why: 'A measured wind gust names no damage: roofs and buildings are not known to be hit. Feed only.',
  },
  {
    id: 'spc-wind-damage',
    label: 'act_now',
    sources: ['spc'],
    trades: ['roofing', 'restoration', 'tree-service'],
    when: (s) => isWindDamageReport(s.title),
    pick: (s, t) => windDamageLevel(s.summary, t as 'roofing' | 'restoration' | 'tree-service'),
    line: 39,
    why: 'A wind damage report is act now for a trade only when its remark names that trade\'s work (trees, a roof, a home); a tree on a road is the road crew\'s.',
  },
  {
    id: 'act-storm-report',
    label: 'act_now',
    sources: ['spc'],
    storm: true,
    why: 'A storm report that names damage, hail or a tornado is on record. Damage to a specific property is not confirmed.',
  },
  { id: 'soon-storm-gust', label: 'coming_soon', sources: ['spc'], why: 'A measured wind gust. No damage is reported (a gust never proves damage).' },

  // ---- people asking ---------------------------------------------------------------------------------------------------------------
  { id: 'act-resident-request', label: 'act_now', sources: ['holler-request'], why: 'A resident asked for this service on Holler.' },
  { id: 'act-public-post', label: 'act_now', sources: PUBLIC_POSTS, why: 'A public post asked for this service. Who wrote it is not checked.' },

  // ---- 311: heat (lines 1 to 4) ---------------------------------------------------------------------------------------------------
  {
    id: 'ctx-no-heat-plumbing',
    label: 'context',
    subtypes: ['311'],
    title: /non-residential heat|heat, no heat|\bno heat\b/i,
    trades: ['plumbing'],
    when: (s) => !/hot water/i.test(titleBodyOf(s.title)),
    line: 4,
    why: 'A no-heat complaint that names no hot water (NYC "Non-Residential Heat", Cincinnati "HEAT, NO HEAT HAZARD") is heating work, not plumbing.',
  },
  {
    id: 'heat-per-building',
    label: 'act_now',
    sources: ['socrata-nyc-311'],
    subtypes: ['311'],
    title: /^heat\/hot water \/ entire building/i,
    // HVAC, and a keyword-watch match (no trade known, review P2-1): a watch on "heat" gets the same one card per building.
    when: (_s, t) => ruleChoice('heatPerBuilding') && (t === null || t === 'hvac'),
    pick: (s) => (hasHeatMark(s.summary) ? 'act_now' : ruleChoice('heatFirstComplaintsInFeed') ? 'market_insight' : 'context'),
    line: 3,
    choice: 'heatPerBuilding',
    why: 'NYC whole-building heat: one card per building, at the third complaint there within 48 hours (marked at ingest, lib/signals/repeat-marks.ts). Other complaints make no card; owner call 11 puts them in the feed.',
  },
  {
    id: 'mi-heat-apartment',
    label: 'market_insight',
    subtypes: ['311'],
    title: /^heat\/hot water \/ apartment only/i,
    when: (_s, t) => t === null || t === 'hvac',
    line: 1,
    why: 'One apartment without heat means the building\'s plant runs; the super usually fixes it. Feed only.',
  },
  {
    id: 'heat-plumbing',
    label: 'market_insight',
    subtypes: ['311'],
    title: NYC_HEAT_RE,
    trades: ['plumbing'],
    pick: (s) => (HOT_WATER_ONLY_RE.test(titleBodyOf(s.title)) ? 'act_now' : 'market_insight'),
    line: 2,
    why: '"HEAT/HOT WATER" is one NYC complaint type for both; most are heat. Plumbing is act now only when the complaint names hot water alone.',
  },
  {
    id: 'act-no-heat',
    label: 'act_now',
    subtypes: ['311'],
    title: /heat\/hot water|non-residential heat|\bhot water\b|\bno heat\b/i,
    why: 'A heat or hot water complaint in a building (NYC non-residential, Cincinnati). The record does not show who is responsible for the repair.',
  },

  // ---- 311: named requests (lines 6 to 12). Every other 311 request is city work: the 311 sources default to context (line 10). ---------
  {
    id: 'ctx-graffiti-cleaning',
    label: 'context',
    subtypes: ['311'],
    title: /graffiti.*private|private.*graffiti/i,
    trades: ['cleaning'],
    line: 6,
    why: 'Graffiti removal is painting work, not house cleaning.',
  },
  {
    id: 'act-private-graffiti',
    label: 'act_now',
    subtypes: ['311'],
    title: /graffiti.*private|private.*graffiti/i,
    why: 'Graffiti on private property: the owner pays for the clean-up.',
  },
  {
    id: 'soon-sewage-restoration',
    label: 'coming_soon',
    subtypes: ['311'],
    title: SEWAGE_BACKUP_RE,
    trades: ['restoration'],
    line: 8,
    why: 'A sewage back-up is water damage inside a building: restoration may be called after the line is cleared.',
  },
  {
    id: 'act-sewage-backup',
    label: 'act_now',
    subtypes: ['311'],
    title: SEWAGE_BACKUP_RE,
    why: 'A sewage back-up was reported (SF "sewage_back-up_discharge", NYC "Sewer Maintenance / Backup", KC "Sewer Backup").',
  },
  {
    id: 'property-violation-311',
    label: 'coming_soon',
    subtypes: ['311'],
    sources: ['socrata-kansascity-311'],
    title: /^property violations?\b/i,
    pick: (s, t) => (t && (kcPropertyTrades(lc(s.source), s.title) ?? []).includes(t) ? 'coming_soon' : 'context'),
    line: 9,
    why: 'A property violation reported through 311 (Kansas City): the trades its subtype names (weeds, trash, open to entry, upkeep) get a heads-up; any other tag is context.',
  },
  {
    id: 'rodent-311',
    label: 'context',
    subtypes: ['311'],
    title: /rodent|\brats?\b|\bmice\b|\bmouse\b|mosquito|termite|possum|\bpests?\b/i,
    trades: ['pest-control'],
    when: (s) => !/(?:bldg|building|apartment)/i.test(titleBodyOf(s.title)),
    pick: (s) => (lc(s.source) === 'socrata-nyc-311' && /^rodent\b/i.test(titleBodyOf(s.title)) ? (ruleChoice('ratSightingAlerts') ? 'coming_soon' : 'market_insight') : 'context'),
    line: 11,
    choice: 'ratSightingAlerts',
    why: 'A rodent sighting names no building and is the city\'s to inspect (NYC: feed only, owner call 5). Mosquito, possum and trash-can requests are city tasks.',
  },
  {
    id: 'soon-building-pests',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /(?:roach|mice|\bmouse\b|rodent|bed ?bug|pests?\b).*(?:bldg|building|apartment)|(?:bldg|building|apartment).*(?:roach|mice|rodent|bed ?bug)|building has mice/i,
    trades: ['pest-control'],
    line: 10,
    why: 'Mice or roaches inside a building (Cincinnati): the owner or tenant hires pest control.',
  },
  {
    id: 'soon-building-mold',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /\bmold\b.*(?:building|apartment|bldg|location|residen|unit)|(?:building|apartment|bldg).*\bmold\b/i,
    trades: ['restoration'],
    line: 10,
    why: 'Mold in a building or apartment: remediation is private work.',
  },
  {
    id: 'soon-healthy-homes',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /healthy homes/i,
    trades: ['handyman', 'general-contractor'],
    line: 10,
    why: 'A New Orleans Healthy Homes complaint is about a home\'s condition: repairs are private work.',
  },
  {
    id: 'soon-private-property-311',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /\bpriv(?:ate)?\b|\bprv\b/i,
    why: 'A 311 request on PRIVATE property (a dead tree, dumping, tall weeds): the owner pays, not the city.',
  },
  {
    id: 'soon-sewer-boundary',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /pipe boundary/i,
    line: 12,
    why: 'A question about where the city sewer ends and the private pipe begins: the private side is the owner\'s (Cambridge, 1 row in 14 days).',
  },
  {
    id: 'soon-flooding-restoration',
    label: 'coming_soon',
    subtypes: ['311'],
    sources: ['socrata-sf-311'],
    title: /^sewer \/ flooding/i,
    trades: ['restoration'],
    pick: (s) => (sumParts(s.summary).some((p) => /^on_property$/i.test(p)) ? 'coming_soon' : 'context'),
    line: 7,
    why: 'SF flooding: only a report marked on_property is the owner\'s; a street or unplaced report is city sewer work.',
  },

  // ---- code violations (lines 13 to 18) ------------------------------------------------------------------------------------------
  {
    id: 'ctx-heating-enclosure',
    label: 'context',
    subtypes: ['violation'],
    trades: ['hvac'],
    when: (s) => HEATING_ENCLOSURE_RE.test(orderText(s.title)) && !violationTrades(s.title, s.summary).includes('hvac'),
    line: 18,
    why: 'A heating plant ENCLOSURE order is a fire-separation repair, not heating work.',
  },
  {
    id: 'violation-abatement',
    label: 'coming_soon',
    subtypes: ['violation'],
    needsTrade: true,
    when: (s) => ABATEMENT_RE.test(orderText(s.title)),
    pick: (_s, t) => (t === 'junk-removal' || t === 'lawn-care' ? 'coming_soon' : 'context'),
    line: 17,
    why: 'Austin Property Abatement: the city may clean up itself if the owner does not, and the record does not say weeds or trash. A heads-up for hauling and lawn care only.',
  },
  {
    id: 'act-violation-named',
    label: 'act_now',
    subtypes: ['violation'],
    needsTrade: true,
    when: (s, t) => !!t && violationTrades(s.title, s.summary).includes(t),
    pick: (s, t) => (ruleChoice('handymanSecondToSpecialist') && violationTradeRoles(s.title, s.summary).get(t as CategoryId) === 'secondary' ? 'coming_soon' : 'act_now'),
    line: 13,
    choice: 'handymanSecondToSpecialist',
    why: 'The order names a repair this trade does (engine B\'s violation vocabulary): the owner has been told to fix it. A handyman named next to the specialist for the repair (a general contractor, windows and doors, flooring) gets a heads-up.',
  },
  {
    id: 'ctx-violation-other-trade',
    label: 'context',
    subtypes: ['violation'],
    needsTrade: true,
    when: (s) => violationTrades(s.title, s.summary).length > 0,
    line: 14,
    why: 'The order names a repair, and not this trade\'s: the tag came from elsewhere.',
  },
  {
    id: 'violation-paperwork',
    label: 'coming_soon',
    subtypes: ['violation'],
    needsTrade: true,
    when: (s) => isPaperworkOrder(s.title, s.summary),
    pick: (_s, t) => (t === 'general-contractor' ? 'coming_soon' : 'context'),
    line: 15,
    why: 'A paperwork-only order (licensed contractor, work without a permit): a contractor may be hired to pull the permit; it names no repair for anyone else.',
  },
  {
    id: 'violation-unnamed',
    label: 'coming_soon',
    subtypes: ['violation'],
    needsTrade: true,
    pick: (_s, t) => (t === 'general-contractor' ? 'market_insight' : 'coming_soon'),
    line: 16,
    why: 'The order names no repair (Austin "Structure Condition Violation(s)", DeKalb "property violation"): the tagged trades get a heads-up, the general contractor the feed. Nothing is carried onto untagged trades.',
  },
  { id: 'act-code-violation', label: 'act_now', subtypes: ['violation'], why: 'A code violation: the owner has been told to fix something.' },

  // ---- failed food inspections (lines 19 to 22) ------------------------------------------------------------------------------------
  {
    id: 'ctx-inspection-house-cleaning',
    label: 'context',
    subtypes: ['inspection'],
    trades: ['cleaning'],
    why: 'A failed restaurant or food inspection is not a house-cleaning job (round 15 quality gate).',
  },
  {
    id: 'ctx-inspection-other-trades',
    label: 'context',
    subtypes: ['inspection'],
    trades: ['food-truck', 'childcare', 'catering', 'signs-printing', 'painting', 'landscaping', 'windows-doors', 'junk-removal', 'business-services', 'general-contractor'],
    line: 21,
    why: 'These tags come from the establishment type or the hidden violation text; a failed inspection is not their job.',
  },
  {
    id: 'soon-inspection-pests',
    label: 'coming_soon',
    subtypes: ['inspection'],
    trades: ['pest-control'],
    line: 19,
    why: 'A failed food inspection: the public record does not say pests were cited, so a heads-up, not act now.',
  },
  {
    id: 'inspection-commercial-cleaning',
    label: 'coming_soon',
    subtypes: ['inspection'],
    trades: ['janitorial-commercial'],
    pick: () => (ruleChoice('failedInspectionAlertsCommercialCleaners') ? 'coming_soon' : 'market_insight'),
    line: 20,
    choice: 'failedInspectionAlertsCommercialCleaners',
    why: 'A failed food inspection may mean a deep clean. Owner call 6: a heads-up for commercial cleaners.',
  },
  {
    id: 'soon-inspection-plumbing',
    label: 'coming_soon',
    subtypes: ['inspection'],
    trades: ['plumbing'],
    line: 22,
    why: 'The plumbing tag is set from the violation text at ingest: a plumbing defect is cited, though the card cannot print it.',
  },

  // ---- business licences and event permits (lines 23 to 28) ------------------------------------------------------------------------
  {
    id: 'ctx-mobile-business',
    label: 'context',
    subtypes: ['business'],
    title: /mobile food|food truck|peddl|\bcarts?\b|vending/i,
    trades: ['hvac', 'pest-control', 'cleaning', 'janitorial-commercial', 'security', 'signs-printing'],
    line: 26,
    why: 'A mobile food, cart, peddler or vending licence has no building to heat, clean, guard or put a sign on.',
  },
  {
    id: 'ctx-liquor-licence',
    label: 'context',
    subtypes: ['business'],
    // a liquor, patio or on-premises consumption licence with no food-premises word in it (a restaurant that also sells liquor keeps its cards)
    title: /^(?!.*\b(?:restau|cafe|bakery|kitchen|food|deli|pizza|diner|bistro|grill))(?=.*(?:liquor|consumption on premises|outdoor patio))/i,
    trades: ['hvac'],
    why: 'A liquor, patio or on-premises consumption licence is an activity of an existing business, not a space to heat or cool.',
  },
  {
    id: 'ctx-business-blanket',
    label: 'context',
    subtypes: ['business'],
    trades: ['locksmith', 'insurance', 'business-services', 'cleaning'],
    why: 'New business licenses are tagged to these trades with no evidence of need. Commercial cleaning keeps its storefront licence alerts.',
  },
  {
    id: 'ctx-licence-hvac',
    label: 'context',
    subtypes: ['business'],
    trades: ['hvac'],
    line: 25,
    why: 'A new licence (a restaurant, a bar, or any other business) opens in an existing space: the licence says nothing about heating or cooling. Line 25 names food premises; the same reason holds for every licence (the audit\'s corrected volume, Chicago HVAC 40+0, assumes it).',
  },
  {
    id: 'business-pests',
    label: 'coming_soon',
    subtypes: ['business'],
    trades: ['pest-control'],
    pick: (s) => (isFoodPremises(s) && !MOBILE_LICENCE_RE.test(licenceName(s)) ? 'coming_soon' : 'context'),
    line: 24,
    why: 'A food premises opening may set up a pest contract. Shared kitchens, liquor-only, event liquor and mobile licences, and every other licence, are not pest work.',
  },
  {
    id: 'business-storefront',
    label: 'coming_soon',
    subtypes: ['business'],
    trades: ['janitorial-commercial', 'security', 'signs-printing'],
    pick: (s, t) => {
      const kind = storefrontKindOf(s);
      if (kind === 'food') return 'coming_soon';
      if (kind === 'shop') return ruleChoice('shopLicenceAlerts') ? 'coming_soon' : 'market_insight';
      if (kind === 'storage') return t === 'security' && ruleChoice('shopLicenceAlerts') ? 'coming_soon' : 'market_insight';
      if (kind === 'parking') return ruleChoice('parkingLicenceAlerts') ? 'coming_soon' : 'market_insight';
      return 'market_insight';
    },
    line: 23,
    choice: 'shopLicenceAlerts',
    why: 'A licence whose name is a storefront (a shop, a restaurant: STOREFRONT_LICENCES) is a heads-up for signs, security and commercial cleaning; any other licence names no premises and is feed only. Owner call 4.',
  },
  {
    id: 'ctx-venue-events',
    label: 'context',
    subtypes: ['event-permit'],
    title: VENUE_EVENT_RE,
    why: 'A plaza, partner, cluster or city-venue event: the venue runs its own services.',
  },
  {
    id: 'ctx-event-blanket',
    label: 'context',
    subtypes: ['event-permit'],
    trades: ['cleaning', 'security'],
    line: 28,
    why: 'Event permits were tagged to cleaning and security with no evidence of need; a park event hires no guards.',
  },
  {
    id: 'event-organiser',
    label: 'coming_soon',
    subtypes: ['event-permit'],
    trades: ['catering', 'event-services', 'food-truck'],
    pick: (s) => (NAMED_EVENT_RE.test(`${s.title ?? ''} ${s.summary ?? ''}`) ? 'coming_soon' : 'market_insight'),
    line: 27,
    why: 'Only an event permit that names a festival, fair, market, concert, parade, race, wedding or similar is a heads-up; a bare "Special Event at <park>" names no organiser or size, so it is feed only.',
  },

  // ---- weather, quakes, travel (lines 29 to 37, 42, 43) ----------------------------------------------------------------------------
  {
    id: 'weather-table',
    label: 'context',
    sources: ['nws'],
    pick: (s, t) => {
      const row = weatherRowFor(s.title);
      if (!row) return 'context';
      // A keyword-watch match (no trade): the strongest cell the event has, so a watch for "flood" still sees a Flood Warning.
      if (!t) return Object.values(row.cells).includes('coming_soon') ? 'coming_soon' : Object.values(row.cells).length ? 'market_insight' : 'context';
      if (t === 'towing' && row.id === 'flood-warning' && /flash flood warning/i.test(nwsEventOf(s.title))) return ruleChoice('towingOnFlashFloodWarning') ? 'coming_soon' : 'context';
      return row.cells[t] ?? 'context';
    },
    line: [29, 30, 31, 32, 33, 34, 35, 36, 37],
    choice: 'towingOnFlashFloodWarning',
    why: 'The NWS event-to-trades table (lib/signals/carry.ts WEATHER_EVENTS): an event and trade not in it alert nobody.',
  },
  {
    id: 'quake',
    label: 'context',
    sources: ['usgs'],
    wholeTitle: true,
    pick: (s, t) => (t === 'restoration' && quakeMagnitude(s.title) >= 5 ? 'coming_soon' : 'context'),
    line: 42,
    why: 'A quake under magnitude 5 rarely damages buildings; at 5 or more, restoration gets a heads-up and no one else.',
  },
  {
    id: 'mi-airport-delay',
    label: 'market_insight',
    sources: ['faa'],
    trades: ['rideshare-delivery'],
    line: 43,
    why: 'An airport delay or ground stop shifts ride demand for hours; worth knowing, not a job.',
  },

  // ---- federal awards -------------------------------------------------------------------------------------------------------------
  { id: 'mi-awarded-contract', label: 'market_insight', sources: ['usaspending'], why: 'An awarded federal contract: it shows who is winning, it cannot be bid on.' },

  // ---- building permits (lines 45 to 65) -------------------------------------------------------------------------------------------
  {
    id: 'stage-finished-downstream',
    label: 'coming_soon',
    permit: true,
    trades: FINISHED_STAGE_TRADES,
    routed: true,
    when: (s) => typeof s.permitStage === 'string' && FINISHED_STAGES.includes(s.permitStage),
    downstream: true,
    why: 'A permit at final inspection, finished or with a certificate of occupancy: the building is ready, so the trades that work on a finished building get the stage update as a heads-up (unchanged by round 19; the feed-only demotions of new builds are about the time before this).',
  },
  {
    id: 'ctx-fire-sprinkler-yard',
    label: 'context',
    permit: true,
    trades: ['landscaping', 'lawn-care'],
    when: (s) => isFireProtectionPermit(s),
    line: 64,
    why: 'A fire sprinkler or standpipe job is not landscaping or lawn care (rows stored before the mapping fix still carry the landscaping tag).',
  },
  {
    id: 'mi-demolition-junk',
    label: 'market_insight',
    permit: true,
    trades: ['junk-removal'],
    when: (s) => permitFacts(s).labels.includes('demolition'),
    downstream: true,
    line: [53, 47],
    why: 'The demolition contractor hauls its own debris: the permit is market insight for junk removal (clears engine B\'s I1).',
  },
  {
    id: 'ctx-demolition-site',
    label: 'context',
    permit: true,
    trades: ['fencing', 'concrete-paving'],
    routes: ['demolition'],
    downstream: true,
    line: 52,
    why: 'A demolition permit, often interior, names no fence or flatwork.',
  },
  {
    id: 'remodel-finish',
    label: 'market_insight',
    permit: true,
    trades: ['flooring', 'painting', 'cleaning', 'junk-removal', 'handyman'],
    routes: ['remodel'],
    when: (s) => !isAdditionOnly(permitFacts(s)),
    pick: () => (ruleChoice('remodelFeedOnly') ? 'market_insight' : 'coming_soon'),
    downstream: true,
    line: [45, 47],
    choice: 'remodelFeedOnly',
    why: 'A remodel permit names no finish work and the general contractor usually carries the finishes. Owner call 2: feed only, no value exception.',
  },
  {
    id: 'addition-follow-on',
    label: 'context',
    permit: true,
    trades: ['cleaning', 'junk-removal', 'handyman', 'painting', 'flooring', 'hvac'],
    routes: ['remodel'],
    when: (s) => isAdditionOnly(permitFacts(s)),
    pick: (_s, t) => {
      if (t === 'cleaning' || t === 'junk-removal' || t === 'handyman') return 'context';
      return ruleChoice('additionAlertsFollowOnTrades') ? 'coming_soon' : t === 'hvac' ? 'context' : 'market_insight';
    },
    downstream: true,
    line: [46, 62],
    choice: 'additionAlertsFollowOnTrades',
    why: 'An addition: cleaning, hauling and odd jobs are the builder\'s. Owner call 3 (NO): painting and flooring are feed only, as on a remodel, and HVAC gets nothing.',
  },
  {
    id: 'ctx-roof-junk',
    label: 'context',
    permit: true,
    trades: ['junk-removal'],
    routes: ['re-roof'],
    downstream: true,
    line: 47,
    why: 'Roofers haul their own tear-off.',
  },
  {
    id: 'mi-roof-solar',
    label: 'market_insight',
    permit: true,
    trades: ['solar'],
    routes: ['re-roof'],
    downstream: true,
    line: 48,
    why: 'A new roof is a solar sales angle, not a request: feed only.',
  },
  {
    id: 'roof-siding',
    label: 'coming_soon',
    permit: true,
    trades: ['siding-gutters'],
    routes: ['re-roof'],
    pick: (s) => {
      const f = permitFacts(s);
      if (f.labels.includes('solar')) return 'context';
      if (f.subPermit || (f.value !== null && f.value < 5000)) return 'market_insight';
      return null;
    },
    downstream: true,
    line: [49, 50],
    why: 'A roof permit with solar is a rooftop install (nothing for gutters); a roof permit under $5,000 or with a trade sub-permit (a rooftop unit) is feed only.',
  },
  {
    id: 'ctx-solar-trades',
    label: 'context',
    permit: true,
    trades: ['electrical', 'roofing'],
    routes: ['solar'],
    downstream: true,
    line: 51,
    why: 'The solar installer holds the job, wiring and roof work included.',
  },
  {
    id: 'ctx-new-build-windows-pool',
    label: 'context',
    permit: true,
    trades: ['windows-doors', 'pool-spa'],
    routes: ['new-build'],
    downstream: true,
    line: 54,
    why: 'Windows and doors come with the build; a pool is not on the permit.',
  },
  {
    id: 'mi-new-build-security',
    label: 'market_insight',
    permit: true,
    trades: ['security'],
    routes: ['new-build'],
    downstream: true,
    line: 55,
    why: 'A house 6 to 12 months from finished: security is worth knowing, not a heads-up.',
  },
  {
    id: 'new-build-fencing',
    label: 'market_insight',
    permit: true,
    trades: ['fencing'],
    routes: ['new-build'],
    when: () => !ruleChoice('newHomeAlertsFencing'),
    downstream: true,
    line: 57,
    choice: 'newHomeAlertsFencing',
    why: 'Owner call 7: a new-home permit is feed only for fence companies; the final-inspection stage update covers the timing.',
  },
  {
    id: 'mi-new-build-small',
    label: 'market_insight',
    permit: true,
    trades: ['real-estate', 'moving', 'landscaping', 'cleaning', 'fencing', 'lawn-care'],
    when: (s) => {
      const f = permitFacts(s);
      return isNewBuildTitle(f) && (f.subPermit || (f.value !== null && f.value < 5000));
    },
    downstream: true,
    line: 57,
    why: 'A new build with a trade sub-permit, or under $5,000, names no new building being finished: feed only (lawn care too, the same guard engine B applies to every new-home trade).',
  },
  {
    id: 'mi-new-construction-unclassed',
    label: 'market_insight',
    permit: true,
    trades: ['fencing', 'cleaning', 'moving'],
    routes: ['new-build'],
    when: (s) => {
      const f = permitFacts(s);
      return f.labels.includes('new construction') && !f.labels.includes('new home') && !statesResidentialClass(s);
    },
    downstream: true,
    line: 56,
    why: '"New construction" with no residential class stated may be anything from a garage to a warehouse: feed only. A stated residential class is treated as a new home.',
  },
  {
    id: 'new-home-lawn',
    label: 'coming_soon',
    permit: true,
    trades: ['lawn-care'],
    routes: ['new-build'],
    pick: (s) => (permitFacts(s).labels.includes('new home') ? 'coming_soon' : 'context'),
    downstream: true,
    line: 58,
    why: 'A new home gets a new lawn to keep up.',
  },
  {
    id: 'fit-out-class',
    label: 'market_insight',
    permit: true,
    trades: ['janitorial-commercial', 'signs-printing', 'security', 'pest-control', 'business-services'],
    routes: ['fit-out'],
    pick: (s, t) => {
      const titled = permitFacts(s).labels.includes('tenant fit-out');
      if (t === 'pest-control' || t === 'business-services') return 'context';
      return titled ? null : 'market_insight';
    },
    downstream: true,
    line: [59, 60],
    why: 'A commercial or apartment addition, remodel or new build is not a new tenant: feed only for cleaning, signs and security. Pest control and IT are no one\'s follow-on work, fit-out or not.',
  },
  {
    id: 'pool-follow-on',
    label: 'market_insight',
    permit: true,
    trades: ['fencing', 'concrete-paving', 'landscaping', 'electrical'],
    routes: ['pool'],
    pick: (s, t) => {
      if (t !== 'fencing') return 'market_insight';
      const f = permitFacts(s);
      const isPool = !sumParts(s.summary).some((p) => NOT_A_POOL_PART_RE.test(p));
      return (f.value === null || f.value >= 5000) && !f.subPermit && isPool ? 'coming_soon' : 'market_insight';
    },
    downstream: true,
    line: 61,
    why: 'Pool codes require a barrier fence: a heads-up for fencing on a real pool build ($5,000 or more, or no value, no trade sub-permit, not a grading permit). The deck, planting and pump power are feed only.',
  },
  {
    id: 'mi-damage-repair',
    label: 'market_insight',
    permit: true,
    trades: ['general-contractor', 'flooring', 'painting'],
    routes: ['damage-repair'],
    downstream: true,
    line: 63,
    why: 'A damage repair permit is usually pulled by the contractor doing the rebuild: feed only for the rebuild trades.',
  },
  {
    id: 'deck-painting',
    label: 'coming_soon',
    permit: true,
    trades: ['painting'],
    routes: ['deck'],
    pick: (s) => {
      const v = permitFacts(s).value;
      return v === null || v >= 5000 ? 'coming_soon' : 'market_insight';
    },
    downstream: true,
    line: 65,
    why: 'A new deck or porch gets stained or painted: a heads-up at $5,000 or more (or no value stated), feed only below.',
  },
  {
    id: 'soon-new-home-downstream',
    label: 'coming_soon',
    permit: true,
    title: /\bnew home\b/i,
    trades: ['real-estate', 'moving'],
    downstream: true,
    why: 'A new home is coming: sale and moving work follow. These trades do not do the permitted work.',
  },
  {
    id: 'soon-permit-downstream',
    label: 'coming_soon',
    permit: true,
    routed: true,
    downstream: true,
    why: 'PLAN-2.0 item 1.1: the permit type in the title is followed by work for other trades (permit-routing.ts DOWNSTREAM). The trade that does the permitted work keeps the market insight below.',
  },
  {
    id: 'soon-interior-demolition-hauling',
    label: 'coming_soon',
    permit: true,
    title: /^(?!.*\bdemolition\b)/i,
    trades: ['junk-removal'],
    downstream: true,
    why: 'Round 18 review P2-4: an alteration whose description mentions demolition is titled by the alteration ("Remodel permit"), and keeps junk-removal as a tag for the debris (mapping/permit.ts tagOnly). Junk removal does not do the permitted work, so it gets Coming soon, never the own-trade market insight.',
  },
  {
    id: 'mi-permit-own-trade',
    label: 'market_insight',
    permit: true,
    needsTrade: true,
    why: 'A permit is tagged to the trade that does the permitted work, so that trade is usually already hired. Other trades get it through the downstream rules above.',
  },
];

/** One explicit entry per registered source (lib/signals/registry.ts ALL_ADAPTERS plus holler-request). */
export const SOURCE_DEFAULTS: Readonly<Record<string, OpportunityLabel>> = {
  // Weather alerts: context (line 29). An alert reaches a trade only through the event-to-trades table (rule weather-table).
  'nws': 'context',
  // Hazards and travel (coming_soon: the event is on record, work is not confirmed)
  'fema': 'coming_soon',
  'usgs': 'coming_soon',
  'faa': 'coming_soon',
  // Storm reports (act_now: a hail or wind report is on record; damage is not confirmed)
  'spc': 'act_now',
  // Building permits (coming_soon only when no trade is known; with a trade, the own-trade rule makes it market_insight first)
  'socrata-chicago-permits': 'coming_soon',
  'socrata-nyc-permits': 'coming_soon',
  'socrata-sf-permits': 'coming_soon',
  'socrata-austin-permits': 'coming_soon',
  'socrata-seattle-permits': 'coming_soon',
  'socrata-la-permits': 'coming_soon',
  'socrata-nola-permits': 'coming_soon',
  'socrata-batonrouge-permits': 'coming_soon',
  'socrata-cincinnati-permits': 'coming_soon',
  'socrata-cambridge-permits': 'coming_soon',
  'socrata-norfolk-permits': 'coming_soon',
  'socrata-buffalo-permits': 'coming_soon',
  'socrata-montgomery-permits': 'coming_soon',
  'socrata-orlando-permits': 'coming_soon',
  'arcgis-dekalb-permits': 'coming_soon',
  'arcgis-raleigh-permits': 'coming_soon',
  'arcgis-dc-permits': 'coming_soon',
  'arcgis-mecklenburg-permits': 'coming_soon',
  'arcgis-atlanta-permits': 'coming_soon',
  'arcgis-johnscreek-permits': 'coming_soon',
  'arcgis-cobb-residential-permits': 'coming_soon',
  'arcgis-cobb-commercial-permits': 'coming_soon',
  'arcgis-cobb-multiunit-permits': 'coming_soon',
  // 311 requests: context (line 10). A 311 request is city work unless a named rule above says otherwise (heat, sewage back-up, private
  // graffiti, private property, property violations, pests or mold in a building, Healthy Homes, the pipe boundary, SF on-property flooding).
  'socrata-chicago-311': 'context',
  'socrata-nyc-311': 'context',
  'socrata-sf-311': 'context',
  'socrata-austin-311': 'context',
  'socrata-dallas-311': 'context',
  'socrata-nola-311': 'context',
  'socrata-cincinnati-311': 'context',
  'socrata-kansascity-311': 'context',
  'socrata-cambridge-311': 'context',
  'socrata-oakland-311': 'context',
  // Code violations (act_now: an owner has been told to fix something)
  'socrata-chicago-violations': 'act_now',
  'socrata-austin-violations': 'act_now',
  'arcgis-dekalb-violations': 'act_now',
  // Failed food inspections (coming_soon for trades the inspection rules do not list)
  'socrata-chicago-inspections': 'coming_soon',
  'socrata-nyc-inspections': 'coming_soon',
  'socrata-austin-inspections': 'coming_soon',
  // New business licenses (coming_soon; locksmith, insurance and business-services are context by rule)
  'socrata-chicago-business': 'coming_soon',
  'socrata-sf-business': 'coming_soon',
  'socrata-la-business': 'coming_soon',
  'socrata-nyc-business': 'coming_soon',
  'socrata-orlando-business': 'coming_soon',
  // Permitted events (coming_soon; park and plaza events are context by rule)
  'socrata-nyc-events': 'coming_soon',
  'socrata-chicago-events': 'coming_soon',
  // Philadelphia (Carto, lib/signals/adapters/carto.ts). ON PROBATION: their rows go to holler_source_samples only, so no member sees a
  // label for them yet. The entries say what each record kind gets once a source is put live: the same defaults as the Socrata sources of
  // the same kind (a permit coming_soon before the own-trade rule, a code violation act_now, a new business licence coming_soon).
  'carto-phl-permits': 'coming_soon',
  'carto-phl-violations': 'act_now',
  'carto-phl-business': 'coming_soon',
  // Federal contracts and big events
  'usaspending': 'market_insight',
  'sam-gov': 'act_now',
  // City open bids (lib/signals/adapters/city-bids.ts; bids-nyc is configured but not registered, so it has no entry until it is):
  // a solicitation is open for bids with a due date, nothing is awarded. Behind HOLLER_BIDS_ENABLED.
  'bids-sf': 'act_now',
  'bids-la': 'act_now',
  'bids-batonrouge': 'act_now',
  // Atlanta-area agency pages read with Firecrawl (lib/signals/adapters/bids-local.ts): open solicitations with a due date. Behind the same
  // flag and FIRECRAWL_API_KEY.
  'bids-gwinnett': 'act_now',
  'bids-rockdale': 'act_now',
  'bids-tucker': 'act_now',
  'bids-dunwoody': 'act_now',
  'ticketmaster': 'coming_soon',
  // People asking (act_now: someone asked)
  'bluesky': 'act_now',
  'websearch-brave': 'act_now',
  'websearch-serper': 'act_now',
  'holler-request': 'act_now',
};

/** A source nobody listed. coming_soon is what such a row was before this table existed (it was alerted). */
export const FALLBACK_LABEL: OpportunityLabel = 'coming_soon';

/** data.subtype values the Socrata and ArcGIS datasets write. Each is handled by at least one rule above or by SOURCE_DEFAULTS. */
export const HANDLED_SUBTYPES = ['permit', '311', 'violation', 'inspection', 'business', 'event-permit'] as const;

const norm = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** The part of a title a rule pattern is tested against: after the first ": ", so "311 request in Oak Park: ..." never fires on "Park". */
function titleBody(title: string | null | undefined): string {
  return titleBodyOf(title);
}

/** The title fallback of the storm rule: whole words only, and only in the event part of an SPC title ("X reported near PLACE"). */
const STORM_TITLE_WORDS = /\b(?:damage|hail|tornado)\b/i;

/** Does a storm report name damage, hail or a tornado? From its structured fields when it has them, else from its title (see LabelRule.storm). */
export function stormReportIsUrgent(sig: Pick<LabelInput, 'title' | 'storm'>): boolean {
  const f = sig.storm;
  if (f && (f.type === 'hail' || f.type === 'wind' || f.type === 'torn')) {
    if (f.type === 'torn') return true;
    if (f.type === 'hail') return f.hailInches == null || f.hailInches >= 1;
    return f.windDamage === true;
  }
  const event = titleBody(sig.title).split(/\s+near\s+/i)[0];
  return STORM_TITLE_WORDS.test(event);
}

function fits(rule: LabelRule, sig: LabelInput, trade: CategoryId | null): boolean {
  if (rule.sources && !rule.sources.includes(norm(sig.source))) return false;
  if (rule.storm && !stormReportIsUrgent(sig)) return false;
  const subtype = norm(sig.subtype);
  if (rule.permit && subtype !== 'permit' && norm(sig.kind) !== 'permit') return false;
  if (rule.subtypes && !rule.subtypes.includes(subtype)) return false;
  if (rule.title && !rule.title.test(rule.wholeTitle ? (sig.title ?? '') : titleBody(sig.title))) return false;
  if (rule.trades && (trade === null || !rule.trades.includes(trade))) return false;
  if (rule.needsTrade && trade === null) return false;
  if (rule.routed && !routeOf(sig, trade)) return false;
  if (rule.routes && !rule.routes.some((k) => downstreamVia(sig, trade, k))) return false;
  if (rule.when && !rule.when(sig, trade)) return false;
  return true;
}

/** The rule that decides this pair and its label, or null when only the source default applies. */
function decide(sig: LabelInput, trade: CategoryId | null): { rule: LabelRule; label: OpportunityLabel } | null {
  for (const r of RULES) {
    if (!fits(r, sig, trade)) continue;
    const label = r.pick ? r.pick(sig, trade) : r.label;
    if (label) return { rule: r, label };
  }
  return null;
}

/** The label the rules AFTER rule `id` give (the source default when none fits): what the record is without that rule. */
function labelAfter(id: string, sig: LabelInput, trade: CategoryId | null): OpportunityLabel {
  const at = RULES.findIndex((r) => r.id === id);
  for (const r of RULES.slice(at + 1)) {
    if (!fits(r, sig, trade)) continue;
    const label = r.pick ? r.pick(sig, trade) : r.label;
    if (label) return label;
  }
  return SOURCE_DEFAULTS[norm(sig.source)] ?? FALLBACK_LABEL;
}

/** The rule that decides this pair, or null when only the source default applies. */
export function ruleFor(sig: LabelInput, trade: CategoryId | null): LabelRule | null {
  return decide(sig, trade)?.rule ?? null;
}

/**
 * The label for one record and one trade. `trade` is null for a keyword-watch match, where the member's trade is not what matched:
 * rules that name trades are skipped, and a permit then keeps its source default (coming_soon) instead of the own-trade rule.
 */
export function labelFor(sig: LabelInput, trade: CategoryId | null): OpportunityLabel {
  const d = decide(sig, trade);
  if (d) return d.label;
  return SOURCE_DEFAULTS[norm(sig.source)] ?? FALLBACK_LABEL;
}

/**
 * The best label across the trades that matched (act_now beats coming_soon beats market_insight beats context). A member with two
 * trades sees a record once, under its strongest label. No trades (a keyword-only match) is labelled with the trade unknown.
 */
export function labelForTrades(sig: LabelInput, trades: readonly (CategoryId | string)[]): OpportunityLabel {
  if (trades.length === 0) return labelFor(sig, null);
  let best: OpportunityLabel = 'context';
  let bestRank = LABEL_RANK.context;
  for (const t of trades) {
    const l = labelFor(sig, t as CategoryId);
    if (LABEL_RANK[l] < bestRank) {
      best = l;
      bestRank = LABEL_RANK[l];
    }
  }
  return best;
}

/**
 * The label for a record seen by a member: the member's trades that the record is tagged with. A record tagged with none of them
 * (a keyword-watch match) is labelled with the trade unknown.
 */
/**
 * The label input of a stored record as a surface reads it (the feeds, the digest, the push, the admin reports). The location (point,
 * state, severity) is passed when the surface selected it (`lat` and `severity` present in the row), so the rules that need it (ctx-undeliverable,
 * mi-bid-unplaced) decide the same on every surface as at match time.
 */
export function recordLabelInput(s: {
  source?: string | null;
  kind?: string | null;
  subtype?: string | null;
  title?: string | null;
  summary?: string | null;
  /** data.setAside of a federal notice (the feed's samSetAside alias). */
  samSetAside?: string | null;
  permitStage?: unknown;
  lat?: number | null;
  lon?: number | null;
  state?: string | null;
  severity?: number | null;
}): LabelInput {
  const base: LabelInput = { source: s.source ?? '', kind: s.kind ?? null, subtype: s.subtype ?? null, title: s.title ?? null, summary: s.summary ?? null, permitStage: s.permitStage, ...(s.samSetAside ? { setAside: s.samSetAside } : {}) };
  return s.lat === undefined || s.severity === undefined ? base : { ...base, lat: s.lat ?? null, lon: s.lon ?? null, state: s.state ?? null, severity: s.severity ?? null };
}

/** Match statuses the member set that keep a match in their feed whatever its label is now (review P2-6). */
export const KEPT_MATCH_STATUSES: readonly string[] = ['saved', 'done'];

/**
 * Review P2-6 (owner decision a): a match the member saved or marked done stays in their feed whatever its label is now. When the rules
 * would hide it (context), it is shown as a feed item (market insight), without an alert chip it no longer earns; any other label is kept.
 */
export function keptMatchLabel(label: OpportunityLabel, status: string | null | undefined): OpportunityLabel {
  return label === 'context' && typeof status === 'string' && KEPT_MATCH_STATUSES.includes(status) ? 'market_insight' : label;
}

export function labelForMember(sig: LabelInput & { categories?: readonly string[] | null }, memberTrades: readonly string[]): OpportunityLabel {
  const shared = carriedTrades(sig, sig.categories).filter((c) => memberTrades.includes(c));
  return labelForTrades(sig, shared);
}

/** Stable sort: act_now first, then coming_soon, market_insight, context; inside a label the given order is kept. Does not mutate. */
export function orderByLabel<T>(items: readonly T[], labelOf: (item: T) => OpportunityLabel): T[] {
  return items
    .map((item, i) => ({ item, i, r: LABEL_RANK[labelOf(item)] }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

// ---- trades with no live source ---------------------------------------------------------------------------------------------------

/**
 * Trades no live source can reach today: every locksmith and business-services record is a blanket business license (tobacco dealers,
 * wholesale, video gaming terminals) and has no evidence of need (14-day audit; the live table holds 0 members for either). The trade
 * picker, the profile save and the mobile config mark them "No live source yet" until Phase 3 (business-opening playbook), so no one
 * pays for an empty feed. Resident requests and public posts may still name them; this is about what Holler can find on its own.
 */
export const NO_LIVE_SOURCE_TRADES: readonly string[] = ['locksmith', 'business-services'];

export function tradeNoLiveSource(trade: string): boolean {
  return NO_LIVE_SOURCE_TRADES.includes(trade);
}

// ---- deadline ------------------------------------------------------------------------------------------------------------------

export interface DeadlineInput {
  source?: string | null;
  /** holler_signals.expires_at. For an open federal bid this is the response date. */
  expires_at?: string | null;
  expiresAt?: string | null;
  data?: { [k: string]: unknown } | null;
  /** The same keys read flat, as DEADLINE_SELECT aliases them in a PostgREST select. */
  deadline?: string | null;
  fixBy?: string | null;
  dueDate?: string | null;
  responseDeadline?: string | null;
}

/**
 * The fields accepted as a deadline, and why. A deadline is a date by which the buyer or the owner has to act or reply:
 *   deadline          a fix-by or compliance date an adapter read from the record (a code violation's correct-by date).
 *   fixBy             the same, named for a violation.
 *   responseDeadline  the date responses to a solicitation are due.
 *   dueDate           accepted ONLY for bid sources (source id starting "bids-"): there it is the solicitation's closing date.
 * NOT accepted, ever:
 *   NYC 311 `due_date` (dataset erm2-nwe9): its own description is "Date when responding agency is expected to update the SR". It is
 *   the city's service target for itself, not a landlord's fix-by, so it must never read as "Deadline". Any `-311` source returns no
 *   deadline whatever its data holds; so does anything not listed here (created, closed, violation_date, issued dates).
 * expires_at counts only for sam-gov, where it is the response date (EXPIRY_IS_DEADLINE).
 */
export const DEADLINE_KEYS = ['deadline', 'fixBy', 'responseDeadline'] as const;
const BID_ONLY_KEYS = ['dueDate'] as const;
const isBidSource = (source: string) => source.startsWith('bids-');
const isThreeOneOne = (source: string) => /-311$/.test(source);
/** Sources whose expires_at IS the response date (not just the end of a listing). */
const EXPIRY_IS_DEADLINE = new Set(['sam-gov']);

/** PostgREST select aliases for the four keys above, read from holler_signals.data. Add to any select that feeds a card. */
export const DEADLINE_SELECT = 'deadline:data->>deadline,fixBy:data->>fixBy,responseDeadline:data->>responseDeadline,dueDate:data->>dueDate';

/** A date-only value ("2026-12-01"), or the same day written as midnight UTC ("2026-12-01T00:00:00Z"), which a portal's date column produces. */
const MIDNIGHT_UTC = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:00)$/;

/**
 * A bare date ("2026-12-01") is kept at noon UTC so every US time zone shows the same day. Midnight UTC is read as that same day ONLY when
 * dateOnly is true (the source publishes a calendar date, see DATE_ONLY_SOURCES); for any other source 00:00Z is a real instant (a 7 PM
 * Eastern deadline is 00:00Z) and is kept as is.
 */
function isoDay(v: unknown, dateOnly = false): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const raw = v.trim();
  const mid = dateOnly ? MIDNIGHT_UTC.exec(raw) : null;
  if (mid || /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const day = mid ? mid[1] : raw;
    const t = Date.parse(`${day}T12:00:00Z`);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * The date by which something has to happen, when the record publishes one (accepted fields: DEADLINE_KEYS, dueDate for bids, expires_at
 * for sam-gov). Null otherwise. Today's stored violations, NYC heat complaints and failed inspections carry none (checked on live rows,
 * Nov 21 2026: data keys are only cat_v, dataset, domain, subtype), so they show "No deadline published".
 */
export function deadlineOf(sig: DeadlineInput): string | null {
  const source = norm(sig.source);
  if (isThreeOneOne(source)) return null;
  const dateOnly = DATE_ONLY_SOURCES.has(source);
  const keys: string[] = [...DEADLINE_KEYS, ...(isBidSource(source) ? BID_ONLY_KEYS : [])];
  for (const k of keys) {
    const flat = (sig as unknown as Record<string, unknown>)[k];
    const d = isoDay(flat ?? sig.data?.[k], dateOnly);
    if (d) return d;
  }
  if (EXPIRY_IS_DEADLINE.has(source)) return isoDay(sig.expires_at ?? sig.expiresAt ?? null, dateOnly);
  return null;
}

/**
 * An Act Now whose published deadline has passed is no longer "act now": it drops to coming_soon (the chip then shows no deadline line).
 * Takes the clock as an argument so this file stays pure; every surface calls it with its own `now`.
 */
export function demoteExpired(label: OpportunityLabel, deadline: string | null | undefined, nowMs: number): OpportunityLabel {
  if (label !== 'act_now' || !deadline) return label;
  const t = Date.parse(deadline);
  return Number.isFinite(t) && t < nowMs ? 'coming_soon' : label;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEADLINE_TZ = 'America/New_York';
const DAY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: DEADLINE_TZ, year: 'numeric', month: 'numeric', day: 'numeric' });

/** "Dec 5, 2026" as the day in US Eastern time, or null for no usable date. A 9 PM Eastern deadline is that evening's date, not the next. */
export function formatDeadlineDate(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const parts = DAY_PARTS.formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${MONTHS[get('month') - 1]} ${get('day')}, ${get('year')}`;
}

/**
 * Sources whose occurred_at is a calendar day stored as midnight UTC (the portal publishes a date, not a time). Printed as that day, not
 * as the evening before in New York. Keep in step with ArcgisDataset.dateOnly (tests/signals/date-only.test.ts). FEMA's declarationDate
 * ("2026-10-27T00:00:00.000Z") is the same kind of value.
 */
export const DATE_ONLY_SOURCES: ReadonlySet<string> = new Set([
  'arcgis-atlanta-permits',
  'arcgis-cobb-residential-permits',
  'arcgis-cobb-commercial-permits',
  'arcgis-cobb-multiunit-permits',
  'arcgis-johnscreek-permits',
  'fema',
]);

/**
 * The record date for the Source line: "Nov 16, 2026". A date-only source stored at midnight UTC prints that calendar day; every other
 * record (and a date-only source with a real time of day) keeps the Eastern-time day of formatDeadlineDate.
 */
export function formatRecordDate(iso: string | null | undefined, source?: string | null): string | null {
  const m = typeof iso === 'string' ? MIDNIGHT_UTC.exec(iso.trim()) : null;
  if (m && typeof source === 'string' && DATE_ONLY_SOURCES.has(source)) return formatDeadlineDate(`${m[1]}T12:00:00Z`);
  return formatDeadlineDate(iso);
}

export const NO_DEADLINE_TEXT = 'No deadline published';

/** The deadline line for an act_now card: "Deadline: Dec 5, 2026" or "No deadline published". */
export function deadlineLine(deadline: string | null | undefined): string {
  const f = formatDeadlineDate(deadline);
  return f ? `Deadline: ${f}` : NO_DEADLINE_TEXT;
}
