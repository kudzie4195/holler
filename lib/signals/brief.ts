import type { CategoryId } from './categories';
import { formatDeadlineDate, labelFor, type LabelInput, type OpportunityLabel } from './lead-rules';
import { bidSourceLinkLabel } from './bid-card';
import { getSourceMeta } from './source-meta';

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
  roofing: 'roof repair or replacement',
  hvac: 'heating and cooling work',
  plumbing: 'plumbing work',
  electrical: 'electrical work',
  'tree-service': 'tree removal or trimming',
  landscaping: 'landscaping work',
  'lawn-care': 'lawn care',
  'snow-removal': 'snow and ice removal',
  'pest-control': 'pest control',
  cleaning: 'house cleaning',
  restoration: 'water, fire or storm restoration',
  'general-contractor': 'remodeling or repair work',
  painting: 'painting work',
  'pool-spa': 'pool and spa service',
  solar: 'solar installation',
  'auto-glass': 'windshield and auto glass repair',
  'auto-body': 'dent and collision repair',
  towing: 'towing and roadside help',
  'auto-repair': 'auto repair',
  moving: 'moving help',
  'junk-removal': 'junk removal and hauling',
  locksmith: 'locksmith work',
  'real-estate': 'buying or selling help',
  insurance: 'insurance help',
  'food-truck': 'food truck business',
  catering: 'catering',
  'event-services': 'event services',
  'rideshare-delivery': 'rides and deliveries',
  childcare: 'childcare',
  beauty: 'hair and beauty services',
  'janitorial-commercial': 'commercial cleaning',
  security: 'security services',
  fencing: 'fence work',
  'concrete-paving': 'concrete and paving work',
  'windows-doors': 'window and door work',
  'siding-gutters': 'siding and gutter work',
  flooring: 'flooring work',
  handyman: 'repair and odd-job work',
  'signs-printing': 'signs and printing',
  'business-services': 'bookkeeping, payroll or IT setup',
  'public-adjuster': 'insurance claim help',
};

export const GENERIC_WORK = 'work you do';

export function workFor(trade: string | null | undefined): string {
  return (trade && (TRADE_WORK as Record<string, string | undefined>)[trade]) || GENERIC_WORK;
}

// ---- table --------------------------------------------------------------------------------------------------------------------------

type WhyFn = (work: string) => string;

/** One sentence per (family, label). A family without a sentence for a label falls back to FALLBACK_WHY[label]. */
const WHY: Record<BriefFamily, Partial<Record<BriefLabel, WhyFn>>> = {
  'weather-alert': {
    coming_soon: (w) => `A weather alert is active near you, which may bring ${w} later; no damage is reported.`,
  },
  'storm-report': {
    act_now: (w) => `A hail, wind or tornado damage report was filed near you, which may mean ${w}; damage at a specific property is not confirmed.`,
    coming_soon: (w) => `A wind gust was measured near you, which may mean ${w} later; no damage is reported.`,
  },
  disaster: {
    coming_soon: (w) => `A disaster declaration is on file for an area near you, so ${w} may come up in the weeks ahead.`,
  },
  quake: {
    coming_soon: (w) => `An earthquake was recorded near you, so ${w} may come up; no damage is reported.`,
  },
  airport: {
    coming_soon: (w) => `An airport delay is listed near you, which may change demand for ${w}.`,
  },
  permit: {
    coming_soon: (w) => `A permit was filed near you, and ${w} may follow once the permitted job is under way.`,
    market_insight: (w) => `A permit for ${w} was filed near you; it shows the work is planned, not who will do it.`,
  },
  '311': {
    act_now: (w) => `A 311 report near you names a problem the owner has to fix, which may call for ${w}; nobody is confirmed as hired.`,
    coming_soon: (w) => `A 311 request near you may involve ${w}; the city has not said that anyone is hiring.`,
  },
  violation: {
    act_now: (w) => `A code violation near you means the owner has been told to fix something, which may call for ${w}; nobody is confirmed as hired.`,
  },
  inspection: {
    act_now: (w) => `A food inspection near you failed, and fixing what failed is ${w}; whether the owner has hired anyone is not known.`,
    coming_soon: (w) => `A food inspection near you failed, and the repairs it names may involve ${w}; the inspection does not say whether the owner is hiring.`,
  },
  business: {
    coming_soon: (w) => `A new business license was filed near you, and a business that is opening may buy ${w}; nothing says it will.`,
  },
  'event-permit': {
    coming_soon: (w) => `An event permit was filed near you, and an organizer may buy ${w}; the permit does not say they will.`,
  },
  'big-event': {
    coming_soon: (w) => `A big event is listed near you, which may change demand for ${w} that week.`,
  },
  'federal-bid': {
    act_now: (w) => `A federal agency has an open solicitation that matches ${w}; responses are due by the date shown, and nothing is awarded.`,
  },
  'federal-award': {
    market_insight: (w) => `A federal contract for work like ${w} was awarded; it shows who is winning, and it is closed to bids.`,
  },
  'city-bid': {
    act_now: (w) => `A city has an open bid that matches ${w}; responses are due by the date shown, and nothing is awarded.`,
  },
  'public-post': {
    act_now: (w) => `Someone posted publicly asking for ${w} near you; Holler has not checked who wrote it.`,
  },
  'resident-request': {
    act_now: (w) => `A resident asked on Holler for ${w} near you.`,
  },
  other: {},
};

const FALLBACK_WHY: Record<BriefLabel, WhyFn> = {
  act_now: (w) => `This record matches ${w} and may need action soon; it is not confirmed that anyone is hiring.`,
  coming_soon: (w) => `This record may point to ${w} later; nothing is confirmed.`,
  market_insight: (w) => `This record shows what is happening in your market for ${w}; it is not a request for your trade.`,
  context: () => 'This is a general public record, kept for context.',
};

/**
 * Cells of (label, family, trade) where the generic sentence would mislead or miss the point. Key: `${label}|${family}|${trade}`.
 * The reasons are in tests/signals/brief.test.ts and in lead-rules.ts (INSPECTION_TRADES, soon-new-home-downstream, ...).
 */
export const WHY_OVERRIDES: Readonly<Record<string, string>> = {
  'act_now|storm-report|roofing': 'A hail, wind or tornado damage report was filed near you; roofs are often checked after storms like this, but damage at a specific property is not confirmed.',
  'act_now|storm-report|siding-gutters': 'A hail, wind or tornado damage report was filed near you; siding and gutters are often checked after storms like this, but damage at a specific property is not confirmed.',
  'act_now|storm-report|auto-body': 'A hail, wind or tornado damage report was filed near you; vehicles are sometimes dented in storms like this, but damage to any one car is not confirmed.',
  'act_now|storm-report|tree-service': 'A hail, wind or tornado damage report was filed near you; fallen limbs are common after storms like this, but damage at a specific property is not confirmed.',
  'act_now|storm-report|restoration': 'A hail, wind or tornado damage report was filed near you; storm restoration can follow, but damage at a specific property is not confirmed.',
  'act_now|storm-report|insurance': 'A hail, wind or tornado damage report was filed near you; storm claims can follow, but damage at a specific property is not confirmed.',
  'act_now|storm-report|public-adjuster': 'A hail, wind or tornado damage report was filed near you; storm claims can follow, but damage at a specific property is not confirmed.',
  'act_now|inspection|pest-control': 'A food inspection near you failed; failed inspections often involve pests, which is your trade, but read the source to see what failed.',
  'act_now|inspection|cleaning': 'A food inspection near you failed; failed inspections often involve cleanliness, which is your trade, but read the source to see what failed.',
  'act_now|inspection|janitorial-commercial': 'A food inspection near you failed; failed inspections often involve cleanliness, which is your trade, but read the source to see what failed.',
  'coming_soon|permit|real-estate': 'A new-home permit was filed near you; a finished home may be sold later, but the permit does not say when or by whom.',
  'coming_soon|permit|moving': 'A new-home permit was filed near you; a finished home may be moved into later, but the permit does not say when.',
  'coming_soon|permit|junk-removal': 'A demolition permit was filed near you, and hauling often follows; the permit does not say who will haul.',
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
  'weather-alert': { base: { confidence: 'High', known: 'the alert was issued', unknown: 'whether anything was damaged is not known' } },
  'storm-report': {
    base: { confidence: 'High', known: 'a storm report was filed', unknown: 'damage at any one property is not confirmed' },
    byLabel: { coming_soon: { known: 'a wind gust was measured', unknown: 'no damage is reported' } },
  },
  disaster: { base: { confidence: 'High', known: 'the declaration exists', unknown: 'whether it brings work in your area is not known' } },
  quake: { base: { confidence: 'High', known: 'the earthquake was recorded', unknown: 'whether anything was damaged is not known' } },
  airport: { base: { confidence: 'High', known: 'the delay is listed', unknown: 'how long it lasts and whether it affects your work is not known' } },
  permit: {
    base: { confidence: 'High', known: 'the permit was filed', unknown: 'whether the owner is hiring for your trade is not known' },
    byLabel: { market_insight: { unknown: 'the permitted work may already be hired out' } },
  },
  '311': { base: { confidence: 'Medium', known: 'the request was filed', unknown: 'it is a resident report that the city has not confirmed, and whether anyone is hiring is not known' } },
  violation: { base: { confidence: 'High', known: 'the violation was recorded', unknown: 'whether the owner has hired anyone is not known' } },
  inspection: { base: { confidence: 'High', known: 'the inspection result is on file', unknown: 'whether the owner is hiring is not known' } },
  business: { base: { confidence: 'High', known: 'the license was filed', unknown: 'whether the new business needs your service is not known' } },
  'event-permit': { base: { confidence: 'High', known: 'the event permit was filed', unknown: 'whether the organizer is hiring is not known' } },
  'big-event': { base: { confidence: 'Medium', known: 'the event is listed', unknown: 'dates can change and whether it brings work is not known' } },
  'federal-bid': { base: { confidence: 'High', known: 'the solicitation is listed', unknown: 'whether your business is eligible to respond is not known' } },
  'federal-award': { base: { confidence: 'High', known: 'the award was made', unknown: 'it is closed to bids and shows past spending only' } },
  'city-bid': { base: { confidence: 'High', known: 'the bid is listed', unknown: 'the portal may not say who is allowed to respond' } },
  'public-post': { base: { confidence: 'Low', known: 'a post asked for this', unknown: 'Holler has not checked who wrote it or whether the need is still open' } },
  'resident-request': { base: { confidence: 'Medium', known: 'a resident asked on Holler', unknown: 'their details are not checked' } },
  other: { base: { confidence: 'Low', known: 'a public record exists', unknown: 'whether it means work for you is not known' } },
};

/** One concrete action per family. */
export const NEXT_STEP: Record<BriefFamily, string> = {
  'weather-alert': 'Open the source and read the alert area and times.',
  'storm-report': 'Open the source and check where the report was filed, then look at that area on a map.',
  disaster: 'Open the source and check which counties the declaration covers.',
  quake: 'Open the source and check the magnitude and how far away it was.',
  airport: 'Open the source and check which airport and how long the delay is.',
  permit: 'Open the source and check the address and permit type, then look at the address on a map before you go.',
  '311': 'Open the source and check the address and what was reported, then look at the address on a map before you go.',
  violation: 'Open the source and check the address and any fix-by date, then look at the address on a map before you go.',
  inspection: 'Open the source and check what failed and the business address, then look at the address on a map before you go.',
  business: 'Open the source and check the business name and address.',
  'event-permit': 'Open the source and check the event date and who holds the permit.',
  'big-event': 'Open the source and check the date and the venue.',
  'federal-bid': "Check the due date and the buyer's bid page.",
  'federal-award': 'Open the source and check who won and how large the contract is.',
  'city-bid': "Check the due date and the buyer's bid page.",
  'public-post': 'Open the source and read the whole post before you reply.',
  'resident-request': 'Open the request and reply through Holler if it fits what you do.',
  other: 'Open the source and check the address.',
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
  const why = WHY_OVERRIDES[`${label}|${family}|${trade}`] ?? (WHY[family][label] ?? FALLBACK_WHY[label])(workFor(trade));
  const u = UNCERTAIN[family];
  const merged: Uncertainty = { ...u.base, ...(u.byLabel?.[label] ?? {}) };
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
  /** Text of the link: "Open the source", "Open the bid portal" or "Open the request". */
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
    linkText: request ? 'Open the request' : own ? bidSourceLinkLabel(input.source) : 'Open the source home page',
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
}

export interface CardBriefInput extends BriefInput {
  label?: BriefLabel | null;
  trade?: string | null;
  url?: string | null;
  occurredAt?: string | null;
  base?: string | null;
}

/** All five parts' data for one card. An unset label counts as coming_soon (what a row without a label was before). */
export function cardBrief(input: CardBriefInput): CardBrief {
  return {
    ...briefFor({ ...input, label: input.label ?? 'coming_soon' }),
    source: briefSource(input),
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
