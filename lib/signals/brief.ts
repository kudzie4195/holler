import type { CategoryId } from './categories';
import { formatRecordDate, labelFor, ruleFor, type LabelInput, type OpportunityLabel } from './lead-rules';
import { isPaperworkOrder } from './carry';
import { bidSourceLinkLabel } from './bid-card';
import { ERATE_SOURCE_ID } from './bid-sources';
import { carriedTrades, PERMIT_NOUNS, ROUTE_WHY, routeWhyFor } from './permit-routing';
import { getSourceMeta } from './source-meta';
import { isResidentialHeatTitle, managedByLineFrom } from './managed-by';
import { jobValueLine, summaryWithoutValue } from './permit-value';
import { stageLine } from './stage';

/**
 * Brief card v1 (PLAN-2.0 item 0.4). Every alert card (web feed, email digest, mobile API) renders five parts:
 *   1. What happened      the record's own title and summary (drawn by the surface, not here)
 *   2. Why it matters     one trade-specific sentence                          Brief.why
 *   3. Next step          one concrete action for this kind of record           Brief.next
 *   4. Source and date    the link to the public source and the record's date   briefSource()
 *   5. What is uncertain  one line with a High / Medium / Low confidence        Brief.uncertain, Brief.confidence
 *
 * A pure, deterministic table: no clock, no randomness, no model. Same input, same card. The AI note (lib/ai) is separate and stays as
 * it is. Client-safe: no server imports.
 *
 * The table is keyed by (label, source family, trade):
 *   - the FAMILY says what kind of record it is (a storm report, a permit, a 311 request, an open bid, a public post, ...). Each source id
 *     in lib/signals/source-meta.ts maps to exactly one family (briefFamilyOf; tests/signals/brief.test.ts checks every source).
 *   - the LABEL (act_now, coming_soon, market_insight) picks the sentence inside a family.
 *   - the TRADE fills TRADE_WORK (what that trade does), and a few (label, family, trade) cells in WHY_OVERRIDES replace the sentence where
 *     the generic one would mislead (a roofer after a hail report, a pest-control company after a failed food inspection).
 *
 * Wording rules (owner's standing rules, tested over every string): never "lead", "they need you", "you will win" or "guaranteed", never
 * "official record", no em dash. A weather event never proves damage; a permit never proves a vendor is chosen. Every sentence says what
 * the record shows and what it does not.
 */

export type Confidence = 'High' | 'Medium' | 'Low';

export type BriefFamily =
  | 'weather-alert'
  | 'storm-report'
  | 'disaster'
  | 'quake'
  | 'airport'
  | 'permit'
  | '311'
  | 'violation'
  | 'inspection'
  | 'business'
  | 'event-permit'
  | 'big-event'
  | 'federal-bid'
  | 'federal-award'
  | 'city-bid'
  | 'school-bid'
  | 'public-post'
  | 'resident-request'
  | 'sale'
  | 'other';

export const BRIEF_FAMILIES: readonly BriefFamily[] = [
  'weather-alert',
  'storm-report',
  'disaster',
  'quake',
  'airport',
  'permit',
  '311',
  'violation',
  'inspection',
  'business',
  'event-permit',
  'big-event',
  'federal-bid',
  'federal-award',
  'city-bid',
  'school-bid',
  'public-post',
  'resident-request',
  'sale',
  'other',
];

/** The labels a card can carry. context is never shown as an alert, but the table still answers for it so nothing can throw. */
export type BriefLabel = OpportunityLabel;

export interface BriefInput {
  source: string;
  kind?: string | null;
  /** data.subtype of the record ('permit', '311', 'violation', ...). */
  subtype?: string | null;
  /**
   * The record's own title and summary. Used only to say what the record itself says (a permit's type, a contract's NAICS work, damage
   * words in a storm report). Never used to guess a job. Absent: the brief stays generic and never denies damage.
   */
  title?: string | null;
  summary?: string | null;
}

const norm = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

const SOURCE_FAMILY: Record<string, BriefFamily> = {
  'nws': 'weather-alert',
  'spc': 'storm-report',
  'fema': 'disaster',
  'usgs': 'quake',
  'faa': 'airport',
  'ticketmaster': 'big-event',
  'sam-gov': 'federal-bid',
  'usaspending': 'federal-award',
  'bluesky': 'public-post',
  'websearch-brave': 'public-post',
  'websearch-serper': 'public-post',
  'holler-request': 'resident-request',
  // Round 20 NEXT: the Houston permit report page (not a dataset id with a suffix the pattern below reads).
  'html-houston-permits': 'permit',
};

const SUBTYPE_FAMILY: Record<string, BriefFamily> = {
  'permit': 'permit',
  '311': '311',
  'violation': 'violation',
  'inspection': 'inspection',
  'business': 'business',
  'event-permit': 'event-permit',
  'bid': 'city-bid',
  // Round 20 SALES: a recorded property sale (lib/signals/adapters/sales.ts).
  'sale': 'sale',
};

/** Which family a record belongs to: its source first, then its data.subtype, then its kind. Unknown records are 'other'. */
export function briefFamilyOf(sig: BriefInput): BriefFamily {
  const source = norm(sig.source);
  if (SOURCE_FAMILY[source]) return SOURCE_FAMILY[source];
  // Round 33: an E-Rate request is a school or library asking for bids, not a city (lib/signals/adapters/erate.ts).
  if (source === ERATE_SOURCE_ID) return 'school-bid';
  if (source.startsWith('bids-')) return 'city-bid';
  // Socrata, ArcGIS and Carto ids end in what the dataset is: socrata-chicago-311, arcgis-dekalb-violations, carto-phl-business ...
  const tail = source.replace(/^(?:socrata|arcgis|carto)-.*?-(permits|311|violations|inspections|business|events|sales)$/, '$1');
  const byTail: Record<string, BriefFamily> = {
    permits: 'permit',
    '311': '311',
    violations: 'violation',
    inspections: 'inspection',
    business: 'business',
    events: 'event-permit',
    sales: 'sale',
  };
  if (tail !== source && byTail[tail]) return byTail[tail];
  const subtype = norm(sig.subtype);
  if (SUBTYPE_FAMILY[subtype]) return SUBTYPE_FAMILY[subtype];
  const kind = norm(sig.kind);
  if (kind === 'alert') return 'weather-alert';
  if (kind === 'report') return 'storm-report';
  if (kind === 'disaster') return 'disaster';
  if (kind === 'quake') return 'quake';
  if (kind === 'travel') return 'airport';
  if (kind === 'permit') return 'permit';
  if (kind === 'event') return 'big-event';
  if (kind === 'ask') return 'public-post';
  return 'other';
}

// ---- trade --------------------------------------------------------------------------------------------------------------------------

/**
 * What each trade does, as a noun phrase that fits "may bring {work}" and "matches {work}". One entry per category (the test fails when a
 * category has none). `null` (a keyword-watch match, where no trade matched) uses GENERIC_WORK.
 */
export const TRADE_WORK: Record<CategoryId, string> = {
  roofing: 'roof repair or install',
  hvac: 'heating and cooling',
  plumbing: 'plumbing work',
  electrical: 'electrical work',
  'tree-service': 'tree removal or care',
  landscaping: 'landscaping work',
  'lawn-care': 'lawn care',
  'snow-removal': 'snow and ice removal',
  'pest-control': 'pest control',
  cleaning: 'cleaning',
  restoration: 'storm or water repair',
  'general-contractor': 'remodeling or repair',
  painting: 'painting work',
  'pool-spa': 'pool and spa service',
  solar: 'solar installation',
  'auto-glass': 'auto glass repair',
  'auto-body': 'dent and body repair',
  towing: 'towing or roadside',
  'auto-repair': 'auto repair',
  moving: 'moving help',
  'junk-removal': 'junk hauling',
  locksmith: 'locksmith work',
  'real-estate': 'buying or selling help',
  insurance: 'insurance help',
  'food-truck': 'food truck business',
  catering: 'catering',
  'event-services': 'event services',
  'rideshare-delivery': 'rides and deliveries',
  childcare: 'childcare',
  beauty: 'hair and beauty work',
  'janitorial-commercial': 'commercial cleaning',
  security: 'security services',
  fencing: 'fence work',
  'concrete-paving': 'concrete or paving',
  'windows-doors': 'window and door work',
  'siding-gutters': 'siding and gutter work',
  flooring: 'flooring work',
  handyman: 'repair and odd jobs',
  'signs-printing': 'signs and printing',
  'business-services': 'bookkeeping or IT help',
  'public-adjuster': 'insurance claim help',
};

export const GENERIC_WORK = 'work you do';

export function workFor(trade: string | null | undefined): string {
  return (trade && (TRADE_WORK as Record<string, string | undefined>)[trade]) || GENERIC_WORK;
}

/** A REASON_COPY sentence with its slots filled. "{type}" without a permit type drops the bracket ("A permit was filed nearby; ..."). */
export function fillReason(text: string, work: string, permitType: string | null | undefined): string {
  const typed = text.replace('{work}', work);
  if (!typed.includes('{type}')) return typed;
  const withType = permitType ? typed.replace('{type}', permitType) : null;
  return withType && withType.length <= MAX_WHY ? withType : typed.replace(' ({type})', '');
}

// ---- table --------------------------------------------------------------------------------------------------------------------------

/** What the record itself says, read from its title (see permitTypeOf, awardWorkOf). */
interface WhyCtx {
  trade: string | null;
  /** Permit title: the type the title names ("HVAC"), null when it names none ("Permit in X"), undefined when no title was passed. */
  permitType: string | null | undefined;
  /** Federal contract title: the work the title names, null when it names none (only a NAICS code), undefined when no title was passed. */
  awardWork: string | null | undefined;
  /** Code violation: the short description after the title's ": " (40 characters or fewer), lower-cased. Null when it names nothing ("property violation"). */
  violation: string | null;
  /** Storm report: the title is a measured wind gust (isGustReport). False without a title. */
  gust?: boolean;
}
type WhyFn = (work: string, c: WhyCtx) => string;

/**
 * "HVAC permit in Montgomery County" gives "HVAC". Only a title that starts with "Permit in" (the generator's title for a permit with no
 * type) gives null, meaning the record does not say what the work is. Any other shape, including a very long type, a type with a digit
 * (an address or a permit number) or a masked title, gives undefined: the generic sentence, no claim about the type. No title gives undefined.
 */
export function permitTypeOf(title: string | null | undefined): string | null | undefined {
  if (typeof title !== 'string' || !title.trim()) return undefined;
  const t = title.trim();
  if (/^permit\s+in\s+/i.test(t)) return null;
  const m = t.match(/^(.{2,120}?)\s+permit\s+in\s+/i);
  if (!m || /\d/.test(m[1])) return undefined;
  return m[1].trim();
}

/**
 * "Code violation in Chicago: REPAIR GUTTER & DOWNSPOUT" gives "repair gutter & downspout". Only a short, plain description counts: 40
 * characters or fewer, no digits (an address or a code), not cut off ("..."), and not the fixed fallback "property violation". Anything
 * else gives null and the generic sentence. Never invents text: it is the record's own title.
 */
export function violationOrderOf(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null;
  const at = title.indexOf(': ');
  if (at < 0) return null;
  const body = title.slice(at + 2).trim();
  if (!body || body.length > 40 || /\d|\.\.\.|…/.test(body) || /^property violation$/i.test(body) || /^code violation$/i.test(body)) return null;
  // A paperwork-only order ("OR LICENSED CONTRACTOR") is not a repair: quoting it read "recorded nearby: or licensed contractor." (audit).
  if (isPaperworkOrder(title)) return null;
  return body.toLowerCase();
}

/** "Federal contract ($310K) in Cincinnati, OH: Plumbing (NAICS 238220)" gives "Plumbing". A title with only a NAICS code gives null. */
export function awardWorkOf(title: string | null | undefined): string | null | undefined {
  if (typeof title !== 'string' || !title.trim()) return undefined;
  const m = title.trim().match(/^Federal contract\b[^:]*:\s*(.+)$/i);
  if (!m) return null;
  const work = m[1].replace(/\s*\(NAICS[^)]*\)\s*$/i, '').trim();
  if (!work || /^NAICS\b/i.test(work)) return null;
  return work.length <= 26 ? work : null;
}

/**
 * Damage words a record's own text can use, each with the short phrase the card prints ("it mentions trees down"). The list only decides
 * when the card MENTIONS damage; nothing here ever denies it (the brief never prints "no damage is reported"). A miss therefore falls
 * back to "damage is not confirmed", which is true of every record.
 */
const DAMAGE_PHRASES: [RegExp, string][] = [
  [/\btrees?\b[^.;]{0,25}?\b(?:down|uprooted|snapped|fell|fallen|toppled|broken|split|blown\s+(?:over|down))\b|\b(?:downed|uprooted|snapped|fallen)\s+(?:\w+\s+){0,2}trees?\b|\blimbs?\s+(?:\w+\s+)?(?:down|snapped|broken)\b|\btrees?\s+on\s+\w+/gi, 'trees down'],
  [/\bpower\s+lines?\b[^.;]{0,20}?\b(?:down|snapped|broken)\b|\bdowned\s+(?:power\s+)?lines?\b|\blines?\s+down\b/gi, 'power lines down'],
  [/\bpower\s+poles?\b[^.;]{0,20}?\b(?:down|snapped|broken)\b|\b(?:downed|snapped)\s+(?:power\s+)?poles?\b/gi, 'power poles down'],
  [/\broofs?\b[^.;]{0,20}?\b(?:off|torn|blown|peeled|damage\w*)\b|\bshingles?\b[^.;]{0,20}?\b(?:torn|blown|off)\b/gi, 'roof damage'],
  [/\bdamag(?:e|es|ed|ing)\b/gi, 'damage'],
  [/\bdestr(?:oy|oyed|oys|uction)\b|\bcollaps\w*/gi, 'destruction'],
  [/\bflood\w*/gi, 'flooding'],
  [/\binjur\w*|\bfatal\w*|\bdeaths?\b/gi, 'injuries'],
  [/\bdebris\b/gi, 'debris'],
];

const NEGATORS = /\b(?:no|not|nor|without|neither|none|zero|never)\b|n't\b/i;
/** Wording that forecasts or conditions ("Damaging winds could blow down trees") rather than reports. */
const FORECAST = /\b(?:could|may|might|can|possible|possibly|potential|potentially|expected|likely|will|would|should|threat|capable|impacts?|hazards?|if|forecast|anticipated|expect)\b/i;

/** True when the match at [start, end) is negated ("No damage reported", "no reports of damage", "damage not reported") or forecast. */
function notAReport(text: string, start: number, end: number): boolean {
  // the sentence around the match
  const before = text.slice(0, start);
  const after = text.slice(end);
  const sStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1;
  const aEnd = after.search(/[.;!?\n]/);
  const sentence = text.slice(sStart, aEnd === -1 ? text.length : end + aEnd);
  if (FORECAST.test(sentence)) return true;
  // a negator inside the match itself ("trees were not blown down")
  if (NEGATORS.test(text.slice(start, end))) return true;
  // the clause before the match (cut at a comma or "but"), last five words: a negator there negates it
  const clauseBefore = text.slice(sStart, start).split(/,|\bbut\b/i).pop() ?? '';
  if (NEGATORS.test(clauseBefore.trim().split(/\s+/).slice(-5).join(' '))) return true;
  // the three words after it: "damage not reported", "damage was not reported"
  const clauseAfter = (aEnd === -1 ? after : after.slice(0, aEnd)).split(/,|\bbut\b/i)[0] ?? '';
  return NEGATORS.test(clauseAfter.trim().split(/\s+/).slice(0, 3).join(' '));
}

/** The first damage phrase the record's own text reports (not negated, not a forecast), or null. */
export function damagePhraseOf(text: string): string | null {
  for (const [re, phrase] of DAMAGE_PHRASES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (!notAReport(text, m.index ?? 0, (m.index ?? 0) + m[0].length)) return phrase;
    }
  }
  return null;
}

/** Trades whose work is repair after a failed inspection (the only trades the "repairs" sentences are true for). */
const INSPECTION_REPAIR_TRADES: ReadonlySet<string> = new Set(['plumbing', 'hvac', 'electrical', 'general-contractor', 'handyman', 'painting', 'flooring', 'windows-doors']);
const INSPECTION_NEUTRAL = 'A food inspection nearby failed; check if what failed fits what you do.';

/**
 * One short sentence per (family, label) saying what happened and why it may matter to the trade. What the record does NOT show
 * (damage, a hire, a winner) is said once, in UNCERTAIN, not repeated here. A family without a sentence for a label falls back to
 * FALLBACK_WHY[label]. Every sentence is at most MAX_WHY characters for any trade (tests/signals/brief.test.ts).
 */
const WHY: Record<BriefFamily, Partial<Record<BriefLabel, WhyFn>>> = {
  'weather-alert': {
    coming_soon: (w) => `A weather alert was issued for your area; ${w} may follow.`,
  },
  'storm-report': {
    act_now: (w) => `A storm report was filed nearby; ${w} may follow.`,
    // Review P2-3: "a gust" only on a gust row; a wind damage heads-up (line 39) or a card without its title says what it is.
    coming_soon: (w, c) => (c.gust ? `A wind gust was reported nearby; ${w} may follow.` : `A storm report was filed nearby; ${w} may follow.`),
  },
  disaster: {
    coming_soon: (w) => `A disaster was declared near you; ${w} may come up.`,
  },
  quake: {
    coming_soon: (w) => `An earthquake was recorded nearby; ${w} may come up.`,
  },
  airport: {
    coming_soon: (w) => `An airport delay is listed nearby; it may affect ${w}.`,
  },
  permit: {
    coming_soon: (w, c) => {
      const withType = c.permitType ? `A permit was filed nearby (${c.permitType}); ${w} may follow.` : null;
      return withType && withType.length <= MAX_WHY ? withType : `A permit was filed nearby; ${w} may follow.`;
    },
    market_insight: (_w, c) => {
      if (c.permitType === null) return 'A permit was filed nearby; the permit does not say what the work is.';
      const withType = c.permitType ? `A permit was filed nearby (${c.permitType}); work is planned.` : null;
      return withType && withType.length <= MAX_WHY ? withType : 'A permit was filed nearby; work is planned.';
    },
  },
  '311': {
    act_now: (w) => `A 311 report names a problem to fix; ${w} may be needed.`,
    coming_soon: (w) => `A 311 request nearby may involve ${w}.`,
  },
  violation: {
    // The record's own short description of what is wrong is quoted, so a gutter order is not told to a roofer as roof work.
    act_now: (w, c) => (c.violation ? `A code violation was recorded nearby: ${c.violation}.` : `A code violation was recorded nearby; ${w} may be needed.`),
  },
  inspection: {
    act_now: (w, c) => (c.trade && INSPECTION_REPAIR_TRADES.has(c.trade) ? `A food inspection nearby failed; fixing it may call for ${w}.` : INSPECTION_NEUTRAL),
    coming_soon: (w, c) => (c.trade && INSPECTION_REPAIR_TRADES.has(c.trade) ? `A food inspection nearby failed; repairs may involve ${w}.` : INSPECTION_NEUTRAL),
  },
  business: {
    coming_soon: (w) => `A new business license was filed nearby; it may need ${w}.`,
  },
  'event-permit': {
    coming_soon: (w) => `An event permit was filed nearby; it may need ${w}.`,
  },
  'big-event': {
    coming_soon: (w) => `A big event is listed nearby; it may affect ${w}.`,
  },
  'federal-bid': {
    act_now: (w) => `A federal bid matching ${w} is open; nothing is awarded.`,
  },
  'federal-award': {
    market_insight: (_w, c) => {
      if (c.awardWork === null) return 'A federal contract was awarded; the record does not name the work.';
      const named = c.awardWork ? `A federal contract was awarded for ${c.awardWork}; it is closed.` : null;
      return named && named.length <= MAX_WHY ? named : 'A federal contract was awarded; it is closed to bids.';
    },
  },
  'city-bid': {
    act_now: (w) => `A city bid matching ${w} is open; nothing is awarded.`,
  },
  // Round 33 (E-Rate): names the work the request is about (cabling), not the member's trade, and never who may bid. A heads-up: the record has
  // no bid deadline (lead-rules.ts: bids-erate is coming_soon).
  'school-bid': {
    coming_soon: () => 'A school or library is asking for bids on cabling; nothing is awarded.',
  },
  'public-post': {
    act_now: (w) => `Someone posted publicly asking for ${w} nearby.`,
  },
  'resident-request': {
    act_now: (w) => `A resident asked on Holler for ${w} nearby.`,
  },
  sale: {
    coming_soon: (w) => `A property sold nearby; ${w} may follow.`,
  },
  other: {},
};

const FALLBACK_WHY: Record<BriefLabel, (w: string) => string> = {
  act_now: (w) => `This record matches ${w} and may need action soon.`,
  coming_soon: (w) => `This record may point to ${w} later.`,
  market_insight: (w) => `This record shows market activity for ${w}.`,
  context: () => 'This is a general public record, kept for context.',
};

/** The longest "why it matters" sentence, in characters, for any (family, label, trade). A typical card stays short on a phone. */
export const MAX_WHY = 80;
export const MAX_NEXT = 72;
export const MAX_UNCERTAIN = 88;

/**
 * Cells of (label, family, trade) where the generic sentence would miss the point. Key: `${label}|${family}|${trade}`. A sentence here
 * names the trade's own work, so it is only ever shown to a member who picked that trade (the card is built for the trade the record
 * matched, lib/signals/match.ts). It never says "your trade". Reasons: lead-rules.ts (INSPECTION_TRADES, soon-new-home-downstream, ...).
 */
export const WHY_OVERRIDES: Readonly<Record<string, string>> = {
  'act_now|storm-report|roofing': 'A storm report was filed nearby; roofs are often checked after storms.',
  'act_now|storm-report|siding-gutters': 'A storm report was filed nearby; siding and gutters are often checked.',
  'act_now|storm-report|auto-body': 'A storm report was filed nearby; cars are sometimes dented in storms.',
  'act_now|storm-report|tree-service': 'A storm report was filed nearby; fallen limbs are common after storms.',
  'act_now|storm-report|restoration': 'A storm report was filed nearby, and storm restoration can follow.',
  'act_now|storm-report|insurance': 'A storm report was filed nearby, and storm claims can follow.',
  'act_now|storm-report|public-adjuster': 'A storm report was filed nearby, and storm claims can follow.',
  'coming_soon|permit|real-estate': 'A new-home permit was filed nearby; a finished home may be sold later.',
  'coming_soon|permit|moving': 'A new-home permit was filed nearby; people may move in once it is built.',
  'coming_soon|permit|junk-removal': 'A demolition permit was filed nearby, and hauling often follows.',
};

/**
 * Round 19 RULES (criterion 5): sentences for the record kinds where the audit judged engine B's "why it matters" and "next step" lines
 * more useful (review-ENGINE-compare.md section 6), keyed by the label rule that decided the pair (lead-rules.ts RULES ids), so a card says
 * what that rule saw. A cell replaces the family's sentence for that part only; the five-part card is unchanged. None states a legal duty
 * as a fact about a building, says a vendor is chosen, or claims damage. `{work}` is the trade's work (TRADE_WORK), `{type}` the permit's
 * type from its title. `labels` limits a cell to those labels.
 */
export interface ReasonCopy {
  why?: string;
  next?: string;
  unknown?: string;
  labels?: readonly BriefLabel[];
}

export const REASON_COPY: Readonly<Record<string, ReasonCopy>> = {
  'heat-per-building': {
    // the card only: a complaint before the third (owner call 11 puts it in the feed) keeps the 311 family's sentences
    labels: ['act_now'],
    why: 'Three or more heat complaints were filed at this building in 48 hours.',
    next: "Contact the building's owner or managing agent.",
    unknown: "the building's staff may already be fixing it",
  },
  'act-no-heat': {
    why: 'A no-heat complaint was filed for this building through 311.',
    next: "Contact the building's owner or managing agent.",
    unknown: "the building's staff may already be fixing it",
  },
  'heat-plumbing': {
    why: 'A heat or hot water complaint was filed for this building through 311.',
    next: 'Note the building; its owner or managing agent arranges repairs.',
    unknown: 'whether hot water is out is not clear',
  },
  'mi-heat-apartment': {
    why: 'A heat or hot water complaint was filed for one apartment through 311.',
    next: 'The super may handle it first; note the building.',
    unknown: "the building's own staff may fix it",
  },
  'act-private-graffiti': {
    why: 'Graffiti on private property was reported through 311.',
    next: 'Offer the owner removal or repainting.',
    unknown: 'the owner may clean it up without help',
  },
  'act-sewage-backup': {
    why: 'A sewage back-up was reported here; drain work and cleanup can follow.',
    next: 'Look up the property and offer help to the owner.',
    unknown: 'the city sewer, not the building, may be at fault',
  },
  'soon-sewage-restoration': {
    why: 'A sewage back-up was reported here; drain work and cleanup can follow.',
    next: 'Look up the property and offer help to the owner.',
    unknown: 'the city sewer, not the building, may be at fault',
  },
  'property-violation-311': {
    why: 'A private-property problem was reported to 311; {work} may fit.',
    next: 'Look up the owner and offer to take care of it.',
    unknown: 'the owner may handle it without help',
  },
  'soon-private-property-311': {
    why: 'A private-property problem was reported to 311; {work} may fit.',
    next: 'Look up the owner and offer to take care of it.',
    unknown: 'the owner may handle it without help',
  },
  'soon-building-pests': { why: 'A 311 report names a problem inside a building; {work} may fit.', next: 'Look up the owner or manager and offer help.' },
  'soon-building-mold': { why: 'A 311 report names a problem inside a building; {work} may fit.', next: 'Look up the owner or manager and offer help.' },
  'soon-healthy-homes': { why: 'A 311 report names a problem inside a building; {work} may fit.', next: 'Look up the owner or manager and offer help.' },
  'act-violation-named': { next: 'Look up the property owner and offer the repair.' },
  'violation-unnamed': {
    why: 'A code violation was recorded here, but it does not name the repair.',
    next: 'Look up the owner and ask what must be fixed.',
    unknown: 'the repair is not on the record',
  },
  'violation-paperwork': {
    why: 'A code violation here is about a permit or a license, not a named repair.',
    next: 'Look up the owner and ask what must be fixed.',
    unknown: 'the repair is not on the record',
  },
  'violation-abatement': {
    why: 'A property abatement case was opened here; {work} may fit.',
    next: 'Look up the owner and offer the cleanup.',
    unknown: 'the city may do the work itself',
  },
  'soon-inspection-pests': { why: 'A food business here failed a health inspection.', next: 'Contact the business and offer a visit.', unknown: 'what failed is not listed here' },
  'inspection-commercial-cleaning': { why: 'A food business here failed a health inspection.', next: 'Contact the business and offer a visit.', unknown: 'what failed is not listed here' },
  'soon-inspection-plumbing': { why: 'A food business here failed a health inspection.', next: 'Contact the business and offer a visit.', unknown: 'what failed is not listed here' },
  'remodel-finish': {
    labels: ['market_insight'],
    why: 'A permit was filed nearby ({type}); it does not name {work}.',
    next: 'Use it to see where building work is picking up near you.',
    unknown: 'follow-on work is a guess',
  },
  'addition-follow-on': {
    labels: ['market_insight'],
    why: 'A permit was filed nearby ({type}); it does not name {work}.',
    next: 'Use it to see where building work is picking up near you.',
    unknown: 'follow-on work is a guess',
  },
  'weather-table': {
    labels: ['market_insight'],
    why: 'A weather alert was issued near you; worth knowing for {work}.',
    next: 'Watch how it develops before you act.',
    unknown: 'damage is not confirmed, and it may not reach you',
  },
  'spc-wind-damage': { why: 'A wind damage report was filed nearby; {work} may be needed.', next: 'Check the area and offer help to owners on affected streets.' },
  // Review P3 item 8: the inspection step only on an alert; a feed-only hail card (auto glass and body under 1.75 inch) keeps the family's step.
  'spc-hail': { labels: ['act_now', 'coming_soon'], next: 'Check the area on a map before you offer anyone a visit.' },
  'act-storm-report': { next: 'Check the area on a map before you offer anyone a visit.' },
  'soon-storm-gust': { next: 'Watch for reports of trees or limbs down nearby.' },
  'mi-airport-delay': { why: 'An airport delay was listed nearby; it changes when arrivals land.', next: 'Watch the airport status if you work airport pickups.' },
  'soon-bid-not-open': { why: 'A federal notice for {work} was posted; it may not be open yet.', next: "Check the notice type and the buyer's page." },
  'mi-bid-statewide': { why: 'A federal bid names a state but no city; it cannot be placed near you.' },
};

/** The weather-table cell for a heads-up alert: B's next step, without presuming damage reports. Snow removal keeps it too. */
export const WEATHER_SOON_NEXT = 'Be ready in case calls come once it passes.';

/** The reason cell for this record, label and trade, or null (the family's sentences apply). Needs the title: a locked card has none. */
export function reasonCopyFor(input: BriefInput & { label: BriefLabel; trade?: string | null }): { id: string; copy: ReasonCopy } | null {
  if (typeof input.title !== 'string' || !input.title.trim()) return null;
  const sig = { source: input.source, kind: input.kind, subtype: input.subtype, title: input.title, summary: input.summary };
  const trade = (input.trade ?? null) as CategoryId | null;
  const rule = ruleFor(sig, trade);
  const copy = rule ? REASON_COPY[rule.id] : undefined;
  if (!rule || !copy || (copy.labels && !copy.labels.includes(input.label))) return null;
  // The card's label can differ from what this rule gives (a passed deadline, a stage update, another trade's label): then the family's
  // sentences fit the card better than this rule's.
  if (labelFor(sig, trade) !== input.label) return null;
  return { id: rule.id, copy };
}

interface Uncertainty {
  confidence: Confidence;
  /** What the record shows, after "{confidence} confidence ". */
  known: string;
  /** What it does not show. */
  unknown: string;
}

/**
 * Confidence comes from the source family: measurements and records kept by an agency are High, 311 requests and resident or listing
 * data are Medium, public posts are Low. It is confidence that the record says what it says, never that work exists.
 */
const UNCERTAIN: Record<BriefFamily, { base: Uncertainty; byLabel?: Partial<Record<BriefLabel, Partial<Uncertainty>>> }> = {
  'weather-alert': { base: { confidence: 'High', known: 'the alert was issued', unknown: 'damage is not confirmed' } },
  'storm-report': {
    base: { confidence: 'High', known: 'a storm report was filed', unknown: 'damage is not confirmed' },
    byLabel: { coming_soon: { known: 'a gust was reported' } },
  },
  disaster: { base: { confidence: 'High', known: 'the declaration exists', unknown: 'local work is not known' } },
  quake: { base: { confidence: 'High', known: 'it was recorded', unknown: 'damage is not confirmed' } },
  airport: { base: { confidence: 'High', known: 'the delay is listed', unknown: 'its length is not known' } },
  permit: {
    base: { confidence: 'High', known: 'the permit was filed', unknown: 'who will do the work is not known' },
    byLabel: { market_insight: { unknown: 'the work may already be hired out' } },
  },
  '311': { base: { confidence: 'Medium', known: 'it was filed', unknown: 'the record does not show the city confirmed it' } },
  violation: { base: { confidence: 'High', known: 'the violation was recorded', unknown: 'who will do the work is not known' } },
  inspection: { base: { confidence: 'High', known: 'the inspection result is on file', unknown: 'who will do the work is not known' } },
  business: { base: { confidence: 'High', known: 'the license was filed', unknown: 'the need is not known' } },
  'event-permit': { base: { confidence: 'High', known: 'the permit was filed', unknown: 'who will do the work is not known' } },
  'big-event': { base: { confidence: 'Medium', known: 'the event is listed', unknown: 'dates and demand can change' } },
  'federal-bid': { base: { confidence: 'High', known: 'the bid is listed', unknown: 'your eligibility is not known' } },
  'federal-award': { base: { confidence: 'High', known: 'the award was made', unknown: 'it is closed to bids' } },
  'city-bid': { base: { confidence: 'High', known: 'the bid is listed', unknown: 'who may respond is not known' } },
  'school-bid': { base: { confidence: 'High', known: 'the request is listed', unknown: 'only USAC-registered providers (a SPIN) are paid' } },
  'public-post': { base: { confidence: 'Low', known: 'a post asked for this', unknown: 'the author is unchecked' } },
  'resident-request': { base: { confidence: 'Medium', known: 'a resident asked on Holler', unknown: 'details are unchecked' } },
  sale: { base: { confidence: 'High', known: 'the sale was recorded', unknown: 'the need is not known' } },
  other: { base: { confidence: 'Low', known: 'a public record exists', unknown: 'the need is not known' } },
};

/**
 * One concrete action per family: what to do AFTER opening the source (the Source line already holds the link, so none of these says
 * "Open the source").
 */
export const NEXT_STEP: Record<BriefFamily, string> = {
  'weather-alert': 'Read the alert area and times, and check if it is still in effect.',
  'storm-report': 'Check where it was filed, then look at that area on a map.',
  disaster: 'Check which counties the declaration covers.',
  quake: 'Check the magnitude and how far away it was.',
  airport: 'Check which airport and how long the delay runs.',
  permit: 'Check the permit type and address, then look at it on a map.',
  '311': 'Check what was reported and where, then look at it on a map.',
  violation: 'Check the address and what must be fixed, then look at it on a map.',
  inspection: 'Check what failed and the address, then decide if it is worth a visit.',
  business: 'Check the business name and address.',
  'event-permit': 'Check the event date and who holds the permit.',
  'big-event': 'Check the date and the venue.',
  'federal-bid': "Check the due date and the buyer's bid page.",
  'federal-award': 'Check who won and how large the contract is.',
  'city-bid': "Check the due date and the buyer's bid page.",
  'school-bid': 'Read the whole request; it may cover more than cabling.',
  'public-post': 'Read the whole post before you reply.',
  'resident-request': 'Reply through Holler if it fits what you do.',
  // Review P1-2: never "check the address" (a residential sale has none, only its block), never a claim about a person.
  sale: 'A home on this block sold; homes often need work in the first months.',
  other: 'Check the address.',
};

/** A commercial sale's next step (the residential one is NEXT_STEP.sale). */
export const SALE_COMMERCIAL_NEXT = 'A commercial property here sold; cleaning and security often follow.';

/** "Commercial property sold in ..." (lib/signals/adapters/sales.ts saleTitle). Same test as lib/outreach/plan.ts. */
export function isCommercialSaleTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && /^Commercial property sold in /.test(title);
}

export interface Brief {
  family: BriefFamily;
  label: BriefLabel;
  trade: string | null;
  /** Part 2: one sentence. */
  why: string;
  /** Part 3: one action. */
  next: string;
  confidence: Confidence;
  /** Part 5: "High confidence the inspection failed; whether the owner is who will do the work is not known." */
  uncertain: string;
}

/**
 * A junk-removal Coming soon card whose permit title names no demolition (round 18 review 2, P2-1): it reaches the member through
 * lead-rules.ts soon-interior-demolition-hauling, the demolition inside an alteration (mapping/permit.ts tagOnly). Its sentence says what
 * the record is, a permit that includes demolition work, never "a demolition permit". A brief built with no title (a locked member) is
 * not one: the title is the only proof the permit is not a demolition permit.
 */
export function isInteriorDemolitionCard(label: string, family: string, trade: string | null | undefined, title: string | null | undefined): boolean {
  return label === 'coming_soon' && family === 'permit' && trade === 'junk-removal' && typeof title === 'string' && title.trim() !== '' && !/\bdemolition\b/i.test(title);
}

/** The interior-demolition sentence (English), with the permit's own type when it fits in MAX_WHY. */
export function interiorDemolitionWhy(permitType: string | null | undefined): string {
  const typed = permitType ? `A permit that includes demolition work was filed nearby (${permitType}).` : null;
  return typed && typed.length <= MAX_WHY ? typed : 'A permit that includes demolition work was filed nearby; hauling may follow.';
}

/** A storm report whose title is a measured wind gust ("60 mph wind gust reported near ..."), not a damage, hail or tornado report. */
export const isGustReport = (title: string | null | undefined): boolean => /\bwind gust\b/i.test(title ?? '');

/** The brief for one record, one label and one trade. Pure, total: any input gives a complete brief. */
export function briefFor(input: BriefInput & { label: BriefLabel; trade?: string | null }): Brief {
  const family = briefFamilyOf(input);
  const label = input.label;
  const trade = input.trade ?? null;
  const ctx: WhyCtx = {
    trade,
    permitType: family === 'permit' ? permitTypeOf(input.title) : undefined,
    awardWork: family === 'federal-award' ? awardWorkOf(input.title) : undefined,
    violation: family === 'violation' ? violationOrderOf(input.title) : null,
    gust: family === 'storm-report' && isGustReport(input.title),
  };
  // A trade downstream of the permit's type (permit-routing.ts, PLAN-2.0 item 1.1) gets one fixed sentence per (permit kind, trade). It reads
  // the record's own title, so a locked member's brief (built without the title) falls back to the generic sentence.
  const routed = family === 'permit' && label === 'coming_soon' ? routeWhyFor(input.title, trade, { summary: input.summary, source: input.source }) : null;
  const interiorDemo = !routed && isInteriorDemolitionCard(label, family, trade, input.title) ? interiorDemolitionWhy(ctx.permitType) : null;
  const reason = reasonCopyFor(input);
  const reasonWhy = reason?.copy.why ? fillReason(reason.copy.why, workFor(trade), ctx.permitType) : null;
  const why = routed ?? interiorDemo ?? reasonWhy ?? WHY_OVERRIDES[`${label}|${family}|${trade}`] ?? (WHY[family][label] ? WHY[family][label]!(workFor(trade), ctx) : FALLBACK_WHY[label](workFor(trade)));
  const u = UNCERTAIN[family];
  const merged: Uncertainty = { ...u.base, ...(u.byLabel?.[label] ?? {}) };
  // Review P2-3: "a gust was reported" is said of gust rows only (a wind damage report is a heads-up too since line 39).
  if (family === 'storm-report' && !ctx.gust) merged.known = u.base.known;
  if (reason?.copy.unknown) merged.unknown = reason.copy.unknown;
  // Damage: the brief never says "no damage is reported" (a word list cannot prove a record has no damage). A storm report or quake whose
  // own text reports damage says what it mentions, as unconfirmed. A weather alert is a forecast, so it never prints a mention.
  if (family === 'storm-report' || family === 'quake') {
    const text = [input.title, input.summary].filter((t): t is string => typeof t === 'string' && !!t.trim()).join('. ');
    const phrase = text ? damagePhraseOf(text) : null;
    if (phrase) merged.unknown = `it mentions ${phrase}, not confirmed`;
  }
  if (family === 'permit' && ctx.permitType === null) merged.unknown = 'it does not say what the work is';
  return {
    family,
    label,
    trade,
    why,
    next: reason?.copy.next ?? (family === 'weather-alert' && label === 'coming_soon' && input.title ? WEATHER_SOON_NEXT : family === 'sale' && isCommercialSaleTitle(input.title) ? SALE_COMMERCIAL_NEXT : NEXT_STEP[family]),
    confidence: merged.confidence,
    uncertain: `${merged.confidence} confidence ${merged.known}; ${merged.unknown}.`,
  };
}

// ---- part 4: source and date -------------------------------------------------------------------------------------------------------

export interface BriefSource {
  /** Plain name of the source ("Chicago open data: food inspections"). */
  label: string;
  /** http(s) link to the record, or to the dataset's own page when the record has no link of its own. Never null for a known source. */
  href: string | null;
  /** Text of the link: "Open the source", "Open the bid portal" or "Open the request form" (a resident request has no page of its own, only the /request form). */
  linkText: string;
  /** True when href is the record's own page; false when it is the dataset's home page. */
  recordLink: boolean;
  /** The record's date as the reader sees it ("Nov 20, 2026"), or null when the date is unusable. */
  dateText: string | null;
}

const RESIDENT_REQUEST = 'holler-request';

function httpOrRelative(u: string | null | undefined, base: string | null): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  const v = u.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//')) return base ? `${base.replace(/\/$/, '')}${v}` : v;
  return null;
}

/**
 * Part 4: the source name, a link and the record date. The link is the record's own page when it has one, otherwise the dataset's home
 * page (so a card never has no link). `base` makes a relative link (Holler's own /request page) absolute for email and the mobile API.
 * Pass `url: null` for a locked member: the link is then the dataset's public home page only.
 */
export function briefSource(input: { source: string; url?: string | null; occurredAt?: string | null; base?: string | null }): BriefSource {
  const meta = getSourceMeta(input.source);
  const base = input.base ?? null;
  const own = httpOrRelative(input.url, base);
  const home = httpOrRelative(meta?.sourceUrl, base);
  const request = norm(input.source) === RESIDENT_REQUEST;
  return {
    label: request ? 'Request made on Holler' : (meta?.label ?? String(input.source ?? '').replace(/[_:-]+/g, ' ')),
    href: own ?? home,
    linkText: request ? 'Open the request form' : own ? bidSourceLinkLabel(input.source) : 'Open the public source home page',
    recordLink: !!own,
    dateText: formatRecordDate(input.occurredAt ?? null, input.source),
  };
}

/** The one line for part 4 in plain text: "Source: Chicago open data: food inspections. Record date: Nov 20, 2026." */
export function sourceLine(s: Pick<BriefSource, 'label' | 'dateText'>): string {
  return `Source: ${s.label}. ${s.dateText ? `Record date: ${s.dateText}.` : 'Record date not published.'}`;
}

// ---- the whole card brief -----------------------------------------------------------------------------------------------------------

export interface CardBrief extends Brief {
  source: BriefSource;
  /**
   * NYC no-heat cards only (PLAN-2.0 2.6): "Managed by: <Company> (from the city's building registration)", or null. Company names only;
   * built from data.managerName / data.managerRole after the name is checked again (lib/signals/managed-by.ts). Null for every other record.
   */
  managedBy: string | null;
  /**
   * "Job value on the permit: $12,500" for a permit whose record publishes a project value (data.jobValue, else the "$N job value" part
   * of its summary), else null. It is the number the city printed on the permit, not a quote and not proof that work is planned.
   */
  valueLine: string | null;
  /**
   * A permit whose stage changed (PLAN-2.0 2.1): "The public source lists this permit at final inspection (seen Nov 22, 2026). The
   * building may be ready soon." Timing only. Null for every other record, and for a stage that is not a trigger. Needs migration 0025.
   */
  stageLine: string | null;
}

export interface CardBriefInput extends BriefInput {
  label?: BriefLabel | null;
  trade?: string | null;
  url?: string | null;
  occurredAt?: string | null;
  base?: string | null;
  /** data.managerName and data.managerRole of the signal (written at ingest for NYC heat rows). Ignored for any other record. */
  managerName?: string | null;
  managerRole?: string | null;
  /** data.jobValue of the record (a number, or its text form). Pass null for a locked member. */
  jobValue?: unknown;
  /** data.permitStage and data.permitStageAt of the record (migration 0025 feature). Pass null for a locked member. */
  permitStage?: unknown;
  permitStageAt?: string | null;
}

/**
 * The record's summary as a card prints it (part 1): the same summary, minus the "$N job value" part when the card also prints the
 * "Job value on the permit" line, so a value is shown once. Unchanged when no value was parsed or the record is not a permit. Display only.
 */
export function summaryForCard(input: CardBriefInput): string | null {
  let summary = input.summary ?? null;
  if (summary === null) return null;
  const permit = briefFamilyOf(input) === 'permit';
  // Rows stored before the DeKalb fix carry the field label "Issued Status Code" as a summary part: it is not a status, so it is not shown.
  if (permit && /(?:^| \| )Issued Status Code(?: \||$)/i.test(summary)) {
    summary = summary.split(' | ').filter((p) => !/^issued status code$/i.test(p.trim())).join(' | ') || null;
    if (summary === null) return null;
  }
  const shown = permit && jobValueLine({ jobValue: input.jobValue, summary }) !== null;
  return shown ? (summaryWithoutValue(summary) ?? null) : summary;
}

/** All five parts' data for one card. An unset label counts as coming_soon (what a row without a label was before). */
export function cardBrief(input: CardBriefInput): CardBrief {
  return {
    ...briefFor({ ...input, label: input.label ?? 'coming_soon' }),
    source: briefSource(input),
    managedBy: briefFamilyOf(input) === '311' && isResidentialHeatTitle(input.title) ? managedByLineFrom(input.managerName, input.managerRole) : null,
    valueLine: briefFamilyOf(input) === 'permit' ? jobValueLine({ jobValue: input.jobValue, summary: input.summary }) : null,
    stageLine: briefFamilyOf(input) === 'permit' ? stageLine(input.permitStage, input.permitStageAt) : null,
  };
}

/** Every string a brief can show, for the wording tests. */
export function allBriefStrings(): string[] {
  const out: string[] = [];
  const labels: BriefLabel[] = ['act_now', 'coming_soon', 'market_insight', 'context'];
  const trades: (string | null)[] = [null, ...(Object.keys(TRADE_WORK) as string[])];
  for (const family of BRIEF_FAMILIES) {
    out.push(NEXT_STEP[family]);
    for (const label of labels) {
      for (const trade of trades) {
        const b = briefFor({ source: sourceOfFamily(family), label, trade });
        out.push(b.why, b.uncertain);
      }
    }
  }
  // Record-aware variants: the permit type and contract work a title can name, and the damage words a record's text can use.
  for (const label of labels) {
    for (const trade of trades) {
      for (const title of ['Permit in X', 'Roof permit in X', 'HVAC permit in X', 'Window and door permit in X', 'New home permit in X']) {
        const b = briefFor({ source: 'socrata-chicago-permits', label, trade, title });
        out.push(b.why, b.uncertain);
      }
      // A violation card quotes the order's own short title (violationOrderOf); these are real orders from the fixtures and the quality gate.
      for (const title of ['Code violation in X: REPAIR GUTTER & DOWNSPOUT', 'Code violation in X: REPAIR EXTERIOR WALL', 'Code violation in X: Overgrown weeds', 'Code violation in X: property violation']) {
        out.push(briefFor({ source: 'socrata-chicago-violations', label, trade, title }).why);
      }
      for (const title of ['Federal contract ($1K) in X: NAICS 562991', 'Federal contract ($1K) in X: Plumbing (NAICS 238220)']) {
        out.push(briefFor({ source: 'usaspending', label, trade, title }).why);
      }
      for (const src of ['nws', 'spc', 'usgs']) {
        for (const summary of [undefined, 'Nothing else.', 'Trees down on homes.', 'Power lines down.', 'Roof damage.', 'Some damage.', 'Destroyed.', 'Flooding.', 'Injuries.', 'Debris.']) {
          out.push(briefFor({ source: src, label, trade, title: 'T', summary }).uncertain);
          // a measured gust (review P2-3: only these say "a gust was reported")
          if (src === 'spc') out.push(...Object.values(briefFor({ source: src, label, trade, title: '60 mph wind gust reported near X', summary })).filter((v): v is string => typeof v === 'string'));
        }
      }
    }
  }
  for (const c of Object.values(REASON_COPY)) {
    for (const trade of trades) if (c.why) out.push(fillReason(c.why, workFor(trade), null), fillReason(c.why, workFor(trade), 'Remodel'));
    if (c.next) out.push(c.next);
    if (c.unknown) {
      out.push(c.unknown);
      // the whole "What is uncertain" line, for every family's confidence and known part (the cell is used inside one family)
      for (const family of BRIEF_FAMILIES) {
        for (const label of labels) {
          const u = { ...UNCERTAIN[family].base, ...(UNCERTAIN[family].byLabel?.[label] ?? {}) };
          out.push(`${u.confidence} confidence ${u.known}; ${c.unknown}.`);
        }
      }
    }
  }
  out.push(WEATHER_SOON_NEXT);
  out.push(...Object.values(WHY_OVERRIDES), ...Object.entries(ROUTE_WHY).flatMap(([key, t]) => PERMIT_NOUNS[key.split('|')[0] as keyof typeof PERMIT_NOUNS].map((n) => t.replace('{Permit}', n))), ...Object.values(TRADE_WORK), GENERIC_WORK);
  return out;
}

/** A source id that maps to the family, for allBriefStrings. */
function sourceOfFamily(f: BriefFamily): string {
  const first = Object.entries(SOURCE_FAMILY).find(([, fam]) => fam === f)?.[0];
  if (first) return first;
  const bySubtype: Partial<Record<BriefFamily, string>> = {
    permit: 'socrata-chicago-permits',
    '311': 'socrata-chicago-311',
    violation: 'socrata-chicago-violations',
    inspection: 'socrata-chicago-inspections',
    business: 'socrata-chicago-business',
    'event-permit': 'socrata-chicago-events',
    'city-bid': 'bids-sf',
    'school-bid': 'bids-erate',
  };
  return bySubtype[f] ?? 'unknown-source';
}

/**
 * The trade a record is shown under for a member: among the member's trades that the record is tagged with, the one that gives the
 * strongest label (ties: the member's own order). Null when none of them is on the record (a keyword-watch match). Pure.
 */
export function tradeForRecord(
  sig: LabelInput,
  recordCategories: readonly string[] | null | undefined,
  memberTrades: readonly string[],
): string | null {
  const rank: Record<OpportunityLabel, number> = { act_now: 0, coming_soon: 1, market_insight: 2, context: 3 };
  let best: string | null = null;
  let bestRank = Infinity;
  const carried = carriedTrades(sig, recordCategories);
  for (const t of memberTrades) {
    if (!carried.includes(t)) continue;
    const r = rank[labelFor(sig, t as CategoryId)];
    if (r < bestRank) {
      best = t;
      bestRank = r;
    }
  }
  return best;
}
