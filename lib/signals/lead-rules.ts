import type { CategoryId } from './categories';

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
 *   labelForMember(sig + categories, memberTrades)   what every surface calls: the member's plan trades that the record carries
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
  coming_soon: 'Coming soon',
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
  /** Tested against the record's public title. */
  title?: RegExp;
  /** Trades this rule is for. A rule with trades never fires when no trade is known (a keyword-only match). */
  trades?: readonly CategoryId[];
  /** Fires only when the member's trade is known. */
  needsTrade?: boolean;
}

const PUBLIC_POSTS = ['bluesky', 'websearch-brave', 'websearch-serper'] as const;

/**
 * Trades that act on a failed food inspection: the ones whose job is the thing that failed (pests, dirt). A repair trade (plumbing,
 * HVAC, electrical, general contractor) is only possibly needed, so it gets the source default, coming_soon (review: weak evidence).
 */
const INSPECTION_TRADES: readonly CategoryId[] = ['pest-control', 'cleaning', 'janitorial-commercial'];

/**
 * Seeded from the 14-day audit (PLAN-2.0 section 1, live data of Nov 19 to 21 2026). ORDER MATTERS: the first rule that fits wins, so
 * the specific "act now" requests come before the "context" patterns, which come before the permit rules.
 */
export const RULES: readonly LabelRule[] = [
  // ---- act_now: required repairs and people asking (item 0.3) -----------------------------------------------------------------
  {
    id: 'act-storm-report',
    label: 'act_now',
    sources: ['spc'],
    title: /damage|hail|tornado/i,
    why: 'A storm report that names damage, hail or a tornado is on record. Damage to a specific property is not confirmed.',
  },
  { id: 'soon-storm-gust', label: 'coming_soon', sources: ['spc'], why: 'A measured wind gust. No damage is reported (a gust never proves damage).' },
  { id: 'act-resident-request', label: 'act_now', sources: ['holler-request'], why: 'A resident asked for this service on Holler.' },
  { id: 'act-public-post', label: 'act_now', sources: PUBLIC_POSTS, why: 'A public post asked for this service. Who wrote it is not checked.' },
  { id: 'act-open-bid', label: 'act_now', sources: ['sam-gov'], why: 'Out for bid with a response date. Nothing is awarded.' },
  {
    id: 'act-no-heat',
    label: 'act_now',
    subtypes: ['311'],
    title: /heat\/hot water|non-residential heat|\bhot water\b|\bno heat\b/i,
    why: 'A heat or hot water complaint in a building (NYC, Cincinnati): the landlord has to repair it.',
  },
  { id: 'act-code-violation', label: 'act_now', subtypes: ['violation'], why: 'A code violation: the owner has been told to fix something.' },
  {
    id: 'act-failed-inspection',
    label: 'act_now',
    subtypes: ['inspection'],
    trades: INSPECTION_TRADES,
    why: 'A failed food inspection: the business has to fix what failed.',
  },
  {
    id: 'act-sewage-backup',
    label: 'act_now',
    subtypes: ['311'],
    title: /sew(?:er|age).*back-?\s?up/i,
    why: 'A sewage back-up was reported (SF "sewage_back-up_discharge", NYC "Sewer Maintenance / Backup", KC "Sewer Backup").',
  },
  {
    id: 'act-private-graffiti',
    label: 'act_now',
    subtypes: ['311'],
    title: /graffiti.*private|private.*graffiti/i,
    why: 'Graffiti on private property: the owner pays for the clean-up.',
  },
  {
    id: 'act-property-violation-311',
    label: 'act_now',
    subtypes: ['311'],
    title: /property violations?/i,
    why: 'A property violation reported through 311: the owner has to fix it.',
  },

  {
    id: 'soon-private-property-311',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /\bpriv(?:ate)?\b|\bprv\b/i,
    why: 'A 311 request on PRIVATE property (a dead tree, dumping, tall weeds): the owner pays, not the city. Kept ahead of the city-work patterns below.',
  },

  {
    id: 'soon-sewer-boundary',
    label: 'coming_soon',
    subtypes: ['311'],
    title: /pipe boundary/i,
    why: 'A question about where the city sewer ends and the private pipe begins: the private side is the owner\'s (Cambridge, 1 row in 14 days).',
  },
  {
    id: 'soon-flooding-restoration',
    label: 'coming_soon',
    subtypes: ['311'],
    sources: ['socrata-sf-311'],
    title: /^sewer \/ flooding/i,
    trades: ['restoration'],
    why: 'A flooding report. For restoration it is the same evidence as a flood advisory (coming_soon); for plumbing it stays public sewer work.',
  },
  {
    id: 'soon-event-organiser',
    label: 'coming_soon',
    subtypes: ['event-permit'],
    title: /^special event/i,
    trades: ['catering', 'event-services', 'food-truck'],
    why: 'A named organiser holds a Special Event permit (weddings, picnics, races in a park). Whether they hire is unknown. Security and cleaning stay context.',
  },

  // ---- context: city work and public property (item 0.2) ----------------------------------------------------------------------
  {
    id: 'ctx-graffiti',
    label: 'context',
    subtypes: ['311'],
    title: /graffiti/i,
    why: 'Graffiti removal on public property, done by the city. Private-property graffiti is act-private-graffiti above.',
  },
  {
    id: 'ctx-tree-311',
    label: 'context',
    subtypes: ['311'],
    title: /\btrees?\b|\bstump/i,
    why: 'A request to the city about a city tree (trim, planting, removal, debris). The city does the work.',
  },
  {
    id: 'ctx-sewer-public',
    label: 'context',
    subtypes: ['311'],
    title: /\bsewers?\b|manhole|catch.?basin|storm drain|stormwater/i,
    why: 'Public sewer, manhole, catch-basin and storm-drain work. The city utility does it. A back-up is act-sewage-backup above.',
  },
  {
    id: 'ctx-rodent-baiting',
    label: 'context',
    subtypes: ['311'],
    title: /rodent baiting|rat complaint/i,
    why: 'City rodent baiting on public land.',
  },
  {
    id: 'ctx-city-debris',
    label: 'context',
    subtypes: ['311'],
    title: /fly dump|illegal dump|illdump|(?:right.of.way|\brow\b).*(?:dump|trash|junk|furniture|tire)|(?:dump|trash|junk).*(?:right.of.way|\brow\b)|tire dumping|debris|bulk|missed trash|trash recycling|spillage|litter|abandon|\baban\b|vacant lot|bike lane|community bag/i,
    why: 'Debris, dumping, bulk pick-up and vacant-lot clean-up in the street, alley or right of way. The city does it. Private-property requests are soon-private-property-311 above.',
  },
  {
    id: 'ctx-streets-signs',
    label: 'context',
    subtypes: ['311'],
    title: /street ?light|flood light|street and traffic signs|traffic sign|signage|blocked street|street condition|street and sidewalk|streets?\/sidewalks|roads and streets|paving|curb|pothole|sidewalk/i,
    why: 'Streets, sidewalks, lighting and signs: public works.',
  },
  {
    id: 'ctx-city-building',
    label: 'context',
    subtypes: ['311'],
    title: /bldgmaint|city bldg|\bpark\b/i,
    why: 'City-owned buildings and parks (Oakland BLDGMAINT): city facilities staff do it.',
  },
  {
    id: 'ctx-park-events',
    label: 'context',
    subtypes: ['event-permit'],
    title: /^(?:special event|plaza event|plaza partner event|open street partner event|permit - event \d|venue rental)/i,
    why: 'A permitted park, plaza or city-venue event (a plaza or partner event, a sports-field permit, a venue rental). For catering, event services and food trucks a Special Event is soon-event-organiser above.',
  },
  {
    id: 'ctx-business-blanket',
    label: 'context',
    subtypes: ['business'],
    trades: ['locksmith', 'insurance', 'business-services'],
    why: 'New business licenses are tagged to these trades with no evidence of need. Phase 3 (business-opening playbook) fixes this properly.',
  },

  // ---- market_insight / coming_soon for permits and awards (item 1.1, first half) -------------------------------------------------
  { id: 'mi-awarded-contract', label: 'market_insight', sources: ['usaspending'], why: 'An awarded federal contract: it shows who is winning, it cannot be bid on.' },
  {
    id: 'soon-new-home-downstream',
    label: 'coming_soon',
    permit: true,
    title: /\bnew home\b/i,
    trades: ['real-estate', 'moving'],
    why: 'A new home is coming: sale and moving work follow. These trades do not do the permitted work.',
  },
  {
    id: 'soon-demolition-downstream',
    label: 'coming_soon',
    permit: true,
    title: /\bdemolition\b/i,
    trades: ['junk-removal'],
    why: 'A demolition permit: hauling follows. Junk removal does not do the permitted work.',
  },
  {
    id: 'mi-permit-own-trade',
    label: 'market_insight',
    permit: true,
    needsTrade: true,
    why: 'A permit is tagged to the trade that does the permitted work, so that trade is usually already hired. Routing a permit to OTHER trades is Phase 1 (item 1.1).',
  },
];

/** One explicit entry per registered source (lib/signals/registry.ts ALL_ADAPTERS plus holler-request). */
export const SOURCE_DEFAULTS: Readonly<Record<string, OpportunityLabel>> = {
  // Weather, hazards and travel (coming_soon: the event is on record, work is not confirmed)
  'nws': 'coming_soon',
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
  // 311 requests (coming_soon unless a rule above names the request)
  'socrata-chicago-311': 'coming_soon',
  'socrata-nyc-311': 'coming_soon',
  'socrata-sf-311': 'coming_soon',
  'socrata-austin-311': 'coming_soon',
  'socrata-dallas-311': 'coming_soon',
  'socrata-nola-311': 'coming_soon',
  'socrata-batonrouge-311': 'coming_soon',
  'socrata-cincinnati-311': 'coming_soon',
  'socrata-kansascity-311': 'coming_soon',
  'socrata-cambridge-311': 'coming_soon',
  'socrata-oakland-311': 'coming_soon',
  // Code violations (act_now: an owner has been told to fix something)
  'socrata-chicago-violations': 'act_now',
  'socrata-austin-violations': 'act_now',
  'arcgis-dekalb-violations': 'act_now',
  // Failed food inspections (coming_soon for trades the act-failed-inspection rule does not list)
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
  // Federal contracts and big events
  'usaspending': 'market_insight',
  'sam-gov': 'act_now',
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
  const t = title ?? '';
  const at = t.indexOf(': ');
  return at >= 0 ? t.slice(at + 2) : t;
}

function fits(rule: LabelRule, sig: LabelInput, trade: CategoryId | null): boolean {
  if (rule.sources && !rule.sources.includes(norm(sig.source))) return false;
  const subtype = norm(sig.subtype);
  if (rule.permit && subtype !== 'permit' && norm(sig.kind) !== 'permit') return false;
  if (rule.subtypes && !rule.subtypes.includes(subtype)) return false;
  if (rule.title && !rule.title.test(titleBody(sig.title))) return false;
  if (rule.trades && (trade === null || !rule.trades.includes(trade))) return false;
  if (rule.needsTrade && trade === null) return false;
  return true;
}

/** The rule that decides this pair, or null when only the source default applies. */
export function ruleFor(sig: LabelInput, trade: CategoryId | null): LabelRule | null {
  for (const r of RULES) if (fits(r, sig, trade)) return r;
  return null;
}

/**
 * The label for one record and one trade. `trade` is null for a keyword-watch match, where the member's trade is not what matched:
 * rules that name trades are skipped, and a permit then keeps its source default (coming_soon) instead of the own-trade rule.
 */
export function labelFor(sig: LabelInput, trade: CategoryId | null): OpportunityLabel {
  const rule = ruleFor(sig, trade);
  if (rule) return rule.label;
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
export function labelForMember(sig: LabelInput & { categories?: readonly string[] | null }, memberTrades: readonly string[]): OpportunityLabel {
  const shared = (sig.categories ?? []).filter((c) => memberTrades.includes(c));
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

/** A date-only value ("2026-12-01") is kept at noon UTC so every US time zone shows the same day. */
function isoDay(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const raw = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T12:00:00Z`);
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
  const keys: string[] = [...DEADLINE_KEYS, ...(isBidSource(source) ? BID_ONLY_KEYS : [])];
  for (const k of keys) {
    const flat = (sig as unknown as Record<string, unknown>)[k];
    const d = isoDay(flat ?? sig.data?.[k]);
    if (d) return d;
  }
  if (EXPIRY_IS_DEADLINE.has(source)) return isoDay(sig.expires_at ?? sig.expiresAt ?? null);
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

export const NO_DEADLINE_TEXT = 'No deadline published';

/** The deadline line for an act_now card: "Deadline: Dec 5, 2026" or "No deadline published". */
export function deadlineLine(deadline: string | null | undefined): string {
  const f = formatDeadlineDate(deadline);
  return f ? `Deadline: ${f}` : NO_DEADLINE_TEXT;
}
