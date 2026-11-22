import type { CategoryId } from './categories';
import { formatDeadlineDate, labelFor, type LabelInput, type OpportunityLabel } from './lead-rules';
import { bidSourceLinkLabel } from './bid-card';
import { getSourceMeta } from './source-meta';
import { jobValueLine } from './permit-value';

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
  | 'public-post'
  | 'resident-request'
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
  'public-post',
  'resident-request',
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
};

const SUBTYPE_FAMILY: Record<string, BriefFamily> = {
  'permit': 'permit',
  '311': '311',
  'violation': 'violation',
  'inspection': 'inspection',
  'business': 'business',
  'event-permit': 'event-permit',
  'bid': 'city-bid',
};

/** Which family a record belongs to: its source first, then its data.subtype, then its kind. Unknown records are 'other'. */
export function briefFamilyOf(sig: BriefInput): BriefFamily {
  const source = norm(sig.source);
  if (SOURCE_FAMILY[source]) return SOURCE_FAMILY[source];
  if (source.startsWith('bids-')) return 'city-bid';
  // Socrata and ArcGIS ids end in what the dataset is: socrata-chicago-311, arcgis-dekalb-violations, socrata-nyc-business ...
  const tail = source.replace(/^(?:socrata|arcgis)-.*?-(permits|311|violations|inspections|business|events)$/, '$1');
  const byTail: Record<string, BriefFamily> = {
    permits: 'permit',
    '311': '311',
    violations: 'violation',
    inspections: 'inspection',
    business: 'business',
    events: 'event-permit',
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

// ---- table --------------------------------------------------------------------------------------------------------------------------

/** What the record itself says, read from its title (see permitTypeOf, awardWorkOf). */
interface WhyCtx {
  trade: string | null;
  /** Permit title: the type the title names ("HVAC"), null when it names none ("Permit in X"), undefined when no title was passed. */
  permitType: string | null | undefined;
  /** Federal contract title: the work the title names, null when it names none (only a NAICS code), undefined when no title was passed. */
  awardWork: string | null | undefined;
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
  [/\broofs?\b[^.;]{0,20}?\b(?:off|torn|blown|peeled|damage\w*)\b|\bshingles?\b[^.;]{0,20}?\b(?:torn|blown|off)\b|\bblown\s+(?:off|down)\b/gi, 'roof damage'],
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
    coming_soon: (w) => `A weather alert was issued near you; ${w} may follow.`,
  },
  'storm-report': {
    act_now: (w) => `A storm report was filed nearby; ${w} may follow.`,
    coming_soon: (w) => `A wind gust was reported nearby; ${w} may follow.`,
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
    act_now: (w) => `A code violation was recorded nearby; ${w} may be needed.`,
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
  'public-post': {
    act_now: (w) => `Someone posted publicly asking for ${w} nearby.`,
  },
  'resident-request': {
    act_now: (w) => `A resident asked on Holler for ${w} nearby.`,
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
  'act_now|inspection|pest-control': 'A food inspection nearby failed; failures often involve pests.',
  'act_now|inspection|cleaning': 'A food inspection nearby failed; failures often involve cleanliness.',
  'act_now|inspection|janitorial-commercial': 'A food inspection nearby failed; failures often involve cleanliness.',
  'coming_soon|permit|real-estate': 'A new-home permit was filed nearby; a finished home may be sold later.',
  'coming_soon|permit|moving': 'A new-home permit was filed nearby; people may move in once it is built.',
  'coming_soon|permit|junk-removal': 'A demolition permit was filed nearby, and hauling often follows.',
};

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
    base: { confidence: 'High', known: 'the permit was filed', unknown: 'hiring is not known' },
    byLabel: { market_insight: { unknown: 'the work may already be hired out' } },
  },
  '311': { base: { confidence: 'Medium', known: 'it was filed', unknown: 'the record does not show the city confirmed it' } },
  violation: { base: { confidence: 'High', known: 'the violation was recorded', unknown: 'hiring is not known' } },
  inspection: { base: { confidence: 'High', known: 'the inspection result is on file', unknown: 'hiring is not known' } },
  business: { base: { confidence: 'High', known: 'the license was filed', unknown: 'the need is not known' } },
  'event-permit': { base: { confidence: 'High', known: 'the permit was filed', unknown: 'hiring is not known' } },
  'big-event': { base: { confidence: 'Medium', known: 'the event is listed', unknown: 'dates and demand can change' } },
  'federal-bid': { base: { confidence: 'High', known: 'the bid is listed', unknown: 'your eligibility is not known' } },
  'federal-award': { base: { confidence: 'High', known: 'the award was made', unknown: 'it is closed to bids' } },
  'city-bid': { base: { confidence: 'High', known: 'the bid is listed', unknown: 'who may respond is not known' } },
  'public-post': { base: { confidence: 'Low', known: 'a post asked for this', unknown: 'the author is unchecked' } },
  'resident-request': { base: { confidence: 'Medium', known: 'a resident asked on Holler', unknown: 'details are unchecked' } },
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
  violation: 'Check the address and fix-by date, then look at it on a map.',
  inspection: 'Check what failed and the address, then decide if it is worth a visit.',
  business: 'Check the business name and address.',
  'event-permit': 'Check the event date and who holds the permit.',
  'big-event': 'Check the date and the venue.',
  'federal-bid': "Check the due date and the buyer's bid page.",
  'federal-award': 'Check who won and how large the contract is.',
  'city-bid': "Check the due date and the buyer's bid page.",
  'public-post': 'Read the whole post before you reply.',
  'resident-request': 'Reply through Holler if it fits what you do.',
  other: 'Check the address.',
};

export interface Brief {
  family: BriefFamily;
  label: BriefLabel;
  trade: string | null;
  /** Part 2: one sentence. */
  why: string;
  /** Part 3: one action. */
  next: string;
  confidence: Confidence;
  /** Part 5: "High confidence the inspection failed; whether the owner is hiring is not known." */
  uncertain: string;
}

/** The brief for one record, one label and one trade. Pure, total: any input gives a complete brief. */
export function briefFor(input: BriefInput & { label: BriefLabel; trade?: string | null }): Brief {
  const family = briefFamilyOf(input);
  const label = input.label;
  const trade = input.trade ?? null;
  const ctx: WhyCtx = {
    trade,
    permitType: family === 'permit' ? permitTypeOf(input.title) : undefined,
    awardWork: family === 'federal-award' ? awardWorkOf(input.title) : undefined,
  };
  const why = WHY_OVERRIDES[`${label}|${family}|${trade}`] ?? (WHY[family][label] ? WHY[family][label]!(workFor(trade), ctx) : FALLBACK_WHY[label](workFor(trade)));
  const u = UNCERTAIN[family];
  const merged: Uncertainty = { ...u.base, ...(u.byLabel?.[label] ?? {}) };
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
    next: NEXT_STEP[family],
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
    linkText: request ? 'Open the request form' : own ? bidSourceLinkLabel(input.source) : 'Open the source home page',
    recordLink: !!own,
    dateText: formatDeadlineDate(input.occurredAt ?? null),
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
   * "Job value on the permit: $12,500" for a permit whose record publishes a project value (data.jobValue, else the "$N job value" part
   * of its summary), else null. It is the number the city printed on the permit, not a quote and not proof that work is planned.
   */
  valueLine: string | null;
}

export interface CardBriefInput extends BriefInput {
  label?: BriefLabel | null;
  trade?: string | null;
  url?: string | null;
  occurredAt?: string | null;
  base?: string | null;
  /** data.jobValue of the record (a number, or its text form). Pass null for a locked member. */
  jobValue?: unknown;
}

/** All five parts' data for one card. An unset label counts as coming_soon (what a row without a label was before). */
export function cardBrief(input: CardBriefInput): CardBrief {
  return {
    ...briefFor({ ...input, label: input.label ?? 'coming_soon' }),
    source: briefSource(input),
    valueLine: briefFamilyOf(input) === 'permit' ? jobValueLine({ jobValue: input.jobValue, summary: input.summary }) : null,
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
      for (const title of ['Federal contract ($1K) in X: NAICS 562991', 'Federal contract ($1K) in X: Plumbing (NAICS 238220)']) {
        out.push(briefFor({ source: 'usaspending', label, trade, title }).why);
      }
      for (const src of ['nws', 'spc', 'usgs']) {
        for (const summary of [undefined, 'Nothing else.', 'Trees down on homes.', 'Power lines down.', 'Roof damage.', 'Some damage.', 'Destroyed.', 'Flooding.', 'Injuries.', 'Debris.']) {
          out.push(briefFor({ source: src, label, trade, title: 'T', summary }).uncertain);
        }
      }
    }
  }
  out.push(...Object.values(WHY_OVERRIDES), ...Object.values(TRADE_WORK), GENERIC_WORK);
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
  for (const t of memberTrades) {
    if (!(recordCategories ?? []).includes(t)) continue;
    const r = rank[labelFor(sig, t as CategoryId)];
    if (r < bestRank) {
      best = t;
      bestRank = r;
    }
  }
  return best;
}
