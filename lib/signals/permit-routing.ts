import type { CategoryId } from './categories';

/**
 * Downstream permit routing (PLAN-2.0 item 1.1). A building permit tells the trade that does the permitted work that a job exists, so
 * for that trade it is a "market insight" (the job is usually already hired). It tells OTHER trades that work usually follows a
 * permit: a re-roof is followed by gutters, siding and hauling, a new home by movers, landscaping and fencing. Those trades get the
 * permit as "Coming soon". Nothing here says a hire happened or that anyone is choosing a vendor.
 *
 * Permit type is read from the permit's own title, never from a trade tag. Titles of permit signals are built from a FIXED vocabulary
 * of work-kind labels by lib/signals/mapping/permit.ts ("Roof, HVAC and plumbing permit in Chicago"), so the title is a stable,
 * public, record-derived field. The trades in `categories` are NOT read: they say who does the work, and an AI re-tag may change
 * them, while the downstream decision must not depend on either. A title that names no type ("Permit in X") or a type this file does
 * not know ("Building") routes nowhere.
 *
 * Downstream matrix (PLAN-2.0 section 4, item 1.1) mapped to this repo's real trade ids (lib/signals/categories.ts). Every matrix
 * trade has an id. Two ids cover more than one matrix word: siding-gutters is both "siding" and "gutters", and business-services is
 * "IT" (its label is "Bookkeeping, payroll and IT setup"; it has no live source today, so the picker does not offer it and no member
 * can hold it: that route exists in code and reaches nobody until Phase 3).
 *
 *   re-roof        siding-gutters (gutters, siding), solar, junk-removal
 *   new-build      moving, landscaping, fencing, cleaning, security, pool-spa, windows-doors
 *   remodel        flooring, painting, cleaning, junk-removal, handyman
 *   solar          electrical, roofing
 *   demolition     junk-removal, fencing, concrete-paving
 *   fit-out        janitorial-commercial, signs-printing, security, pest-control, business-services (IT)
 *
 * Pure and client-safe: no server imports, no clock. Same title, same answer.
 */
export type RouteKind = 're-roof' | 'new-build' | 'remodel' | 'solar' | 'demolition' | 'fit-out';

/** Priority order: when a trade is downstream of two kinds in one title, the first listed gives the sentence. */
export const ROUTE_KINDS: readonly RouteKind[] = ['re-roof', 'new-build', 'remodel', 'solar', 'demolition', 'fit-out'];

export const DOWNSTREAM: Readonly<Record<RouteKind, readonly CategoryId[]>> = {
  're-roof': ['siding-gutters', 'solar', 'junk-removal'],
  'new-build': ['moving', 'landscaping', 'fencing', 'cleaning', 'security', 'pool-spa', 'windows-doors'],
  remodel: ['flooring', 'painting', 'cleaning', 'junk-removal', 'handyman'],
  solar: ['electrical', 'roofing'],
  demolition: ['junk-removal', 'fencing', 'concrete-paving'],
  'fit-out': ['janitorial-commercial', 'signs-printing', 'security', 'pest-control', 'business-services'],
};

/**
 * The tag a permit row carries for work of this kind (what lib/signals/mapping/permit.ts writes into `categories`). Used ONLY to widen
 * a database read so downstream rows are fetched (expandCategoriesForRouting); the routing decision itself never reads tags.
 */
export const KIND_CARRIER_TAGS: Readonly<Record<RouteKind, readonly CategoryId[]>> = {
  're-roof': ['roofing'],
  'new-build': ['general-contractor', 'real-estate', 'moving'],
  remodel: ['general-contractor'],
  solar: ['solar'],
  demolition: ['junk-removal', 'general-contractor'],
  'fit-out': ['general-contractor'],
};

/**
 * Every work-kind label a permit title can name (lowercased; PERMIT_KINDS in mapping/permit.ts is the source, and
 * tests/signals/permit-routing.test.ts fails when the two differ) with the trades that DO that work. The doing trades are never
 * "downstream" of the same permit: they get the market insight. Demolition has no doing trade here: its only tag, junk removal,
 * hauls AFTER the demolition, which is why it is downstream.
 */
export const KIND_DOERS: Readonly<Record<string, readonly CategoryId[]>> = {
  'new home': ['general-contractor'],
  'new construction': ['general-contractor'],
  roof: ['roofing'],
  solar: ['solar'],
  pool: ['pool-spa'],
  'water heater': ['plumbing'],
  hvac: ['hvac'],
  plumbing: ['plumbing'],
  electrical: ['electrical'],
  demolition: [],
  'tree removal': ['tree-service'],
  fence: ['fencing'],
  'retaining wall': ['landscaping'],
  landscaping: ['landscaping'],
  concrete: ['concrete-paving'],
  window: ['windows-doors'],
  door: ['windows-doors'],
  siding: ['siding-gutters'],
  gutter: ['siding-gutters'],
  flooring: ['flooring'],
  sign: ['signs-printing'],
  painting: ['painting'],
  'damage repair': ['restoration'],
  deck: ['general-contractor'],
  porch: ['general-contractor'],
  'accessory building': ['general-contractor'],
  addition: ['general-contractor'],
  'tenant fit-out': ['general-contractor'],
  remodel: ['general-contractor'],
  structural: ['general-contractor'],
  'site work': ['general-contractor'],
  building: ['general-contractor'],
  masonry: ['general-contractor'],
  dumpster: ['general-contractor'],
  repair: ['general-contractor'],
};

/** Labels that name no particular trade (the "generic" kinds of mapping/permit.ts). A bare "New construction" next to one still reads as a new building. */
const GENERIC_LABELS: ReadonlySet<string> = new Set(['deck', 'porch', 'accessory building', 'addition', 'tenant fit-out', 'remodel', 'structural', 'site work', 'building', 'masonry', 'dumpster', 'repair']);

/** Title label to route kind, for the labels that start a route. */
const LABEL_ROUTE: Readonly<Record<string, RouteKind>> = {
  roof: 're-roof',
  'new home': 'new-build',
  'new construction': 'new-build',
  remodel: 'remodel',
  addition: 'remodel',
  solar: 'solar',
  demolition: 'demolition',
  'tenant fit-out': 'fit-out',
};

/**
 * The work-kind labels a permit title names, lowercased, or null when the title is not a typed permit title. "Roof, HVAC and plumbing
 * permit in Chicago" gives ["roof", "hvac", "plumbing"]; "Permit in Chicago" and any other shape give null. Labels not in KIND_DOERS
 * are dropped (a title never carries one today).
 */
export function permitLabelsOf(title: string | null | undefined): string[] | null {
  if (typeof title !== 'string') return null;
  const m = title.trim().match(/^(.{2,80}?)\s+permit\s+in\s+/i);
  if (!m) return null;
  const labels = m[1]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l in KIND_DOERS);
  return labels.length ? labels : null;
}

/**
 * What a record says about itself besides its title: the permit's own structured type, class and use (the summary of a permit signal is
 * "<type> | <class or use> | $N job value | <address>") and the source it came from. Both are fields of the record, never a trade tag.
 */
export interface RouteContext {
  summary?: string | null;
  source?: string | null;
}

/** Summary parts that are not type vocabulary: an address, an amount, a ZIP, a status word (same test as mapping/remap.ts). */
function isNoisePart(p: string): boolean {
  return /^\s*\d/.test(p) || /\bjob value\b|\bblock of\b|\b\d{5}\b/i.test(p) || /^\s*(?:issued|issued status code|finaled|final|active|open|closed|approved|expired|complete[d]?|permit issued)\s*$/i.test(p);
}

/** The structured type, class and use parts of a permit summary, in order ("Bldg-Addition", "1 or 2 Family Dwelling"). */
export function summaryParts(summary: string | null | undefined): string[] {
  if (typeof summary !== 'string') return [];
  return summary.split(' | ').map((p) => p.trim()).filter((p) => p && !isNoisePart(p));
}

/** Sources whose every row is a commercial permit (the Cobb commercial feed carries no use column, the dataset itself is the class). */
const COMMERCIAL_SOURCES: ReadonlySet<string> = new Set(['arcgis-cobb-commercial-permits']);

/** A part that names a building that is not a home: commercial, industrial, office, retail, warehouse, apartments, mixed use, "(C)". */
const NON_RESIDENTIAL_PART_RE = /\bcommercial\b|\bindustrial\b|\(c\)|\bbusiness\b|\boffice\b|\bmercantile\b|\bretail\b|\bwarehouse\b|multi[\s-]?family|\bapartments?\b|\bmixed[\s-]use\b/i;
const ALTER_PART_RE = /\b(?:addition|alterations?|alter|remodel\w*|renovation|repairs?)\b/i;
const ACCESSORY_PART_RE = /\baccessory\b/i;
const MASONRY_PART_RE = /\bmasonry\b|\btuck\s?point/i;
const DUMPSTER_PART_RE = /\bdumpsters?\b|\broll[\s-]?off\b/i;
const DEMOLITION_PART_RE = /\bdemoli\w*|\bwrecking\b|\braze\b/i;
const BARE_REPAIR_PART_RE = /^(?:minor\s+|small\s+)?repairs?$/i;

/**
 * Kinds after the record's own structured type and class have had their say. A title cannot see them, a summary can:
 *  - a commercial, industrial, office, retail, warehouse or apartment class sends a new build or a remodel to the fit-out row (commercial
 *    cleaning, signs, security, pest control), never to house cleaning, movers, pools, handymen or yards (round 15 review P1);
 *  - an addition or alteration is not a new building, and an accessory structure is not a new home;
 *  - a masonry permit is not a remodel, a bare repair is neither a remodel nor a re-roof, a dumpster is not a demolition, and a demolition
 *    inside an alteration permit is interior work (no fencing or concrete).
 * With no summary and no source nothing changes: the title alone decides, as before.
 */
function applyRecordClass(kinds: RouteKind[], ctx: RouteContext | null | undefined): RouteKind[] {
  if (!ctx || kinds.length === 0) return kinds;
  const parts = summaryParts(ctx.summary);
  const commercialSource = typeof ctx.source === 'string' && COMMERCIAL_SOURCES.has(ctx.source);
  if (parts.length === 0 && !commercialSource) return kinds;
  const has = (re: RegExp) => parts.some((p) => re.test(p));
  const k = new Set<RouteKind>(kinds);
  if (k.has('new-build')) {
    if (has(ACCESSORY_PART_RE)) k.delete('new-build');
    else if (has(ALTER_PART_RE)) {
      k.delete('new-build');
      k.add('remodel');
    }
  }
  if (k.has('remodel') && (has(MASONRY_PART_RE) || parts.some((p) => BARE_REPAIR_PART_RE.test(p)))) k.delete('remodel');
  if (k.has('re-roof') && parts.some((p) => BARE_REPAIR_PART_RE.test(p))) k.delete('re-roof');
  if (k.has('demolition')) {
    if (has(DUMPSTER_PART_RE)) k.delete('demolition');
    else if (has(ALTER_PART_RE) && !has(DEMOLITION_PART_RE)) k.delete('demolition');
  }
  if ((k.has('new-build') || k.has('remodel')) && (commercialSource || has(NON_RESIDENTIAL_PART_RE))) {
    k.delete('new-build');
    k.delete('remodel');
    k.add('fit-out');
  }
  return ROUTE_KINDS.filter((x) => k.has(x));
}

/**
 * The matrix kinds a title names (and the record's own class allows), in ROUTE_KINDS order.
 * "New construction" next to a named trade ("New construction and plumbing") is NOT a new building: the structured type of those
 * permits is only "New" (a new plumbing line, a new panel), so it routes nowhere. A new building is "New home" (any company), or
 * "New construction" with nothing but generic kinds beside it.
 */
export function routeKindsOf(title: string | null | undefined, ctx?: RouteContext | null): RouteKind[] {
  const labels = permitLabelsOf(title);
  if (!labels) return [];
  const hit = new Set<RouteKind>();
  for (const l of labels) {
    const k = LABEL_ROUTE[l];
    if (!k) continue;
    if (l === 'new construction' && labels.some((x) => x !== 'new construction' && x !== 'new home' && !GENERIC_LABELS.has(x))) continue;
    hit.add(k);
  }
  return applyRecordClass(
    ROUTE_KINDS.filter((k) => hit.has(k)),
    ctx,
  );
}

/** The trades that do the work this title names (they get the market insight, never the downstream route). */
export function doerTradesOf(title: string | null | undefined): Set<CategoryId> {
  const out = new Set<CategoryId>();
  for (const l of permitLabelsOf(title) ?? []) for (const t of KIND_DOERS[l] ?? []) out.add(t);
  return out;
}

/** The kind that makes `trade` downstream of this permit, or null. A trade that does the permitted work is never downstream of it. */
export function routeFor(title: string | null | undefined, trade: string | null | undefined, ctx?: RouteContext | null): RouteKind | null {
  if (!trade) return null;
  const kinds = routeKindsOf(title, ctx);
  if (kinds.length === 0) return null;
  if (doerTradesOf(title).has(trade as CategoryId)) return null;
  for (const k of kinds) if ((DOWNSTREAM[k] as readonly string[]).includes(trade)) return k;
  return null;
}

/** Every trade that is downstream of this permit title (and does not do its work). */
export function downstreamTradesOf(title: string | null | undefined, ctx?: RouteContext | null): CategoryId[] {
  const kinds = routeKindsOf(title, ctx);
  if (kinds.length === 0) return [];
  const doers = doerTradesOf(title);
  const out: CategoryId[] = [];
  for (const k of kinds) for (const t of DOWNSTREAM[k]) if (!doers.has(t) && !out.includes(t)) out.push(t);
  return out;
}

export interface RoutedRecord {
  source?: string | null;
  kind?: string | null;
  subtype?: string | null;
  title?: string | null;
  /** The permit's summary (structured type, class, use). Optional: without it the title alone decides. */
  summary?: string | null;
}

const lower = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** The record is a building permit: the same test as the `permit` flag of a label rule (data.subtype or kind is 'permit'). */
export function isPermitRecord(sig: RoutedRecord): boolean {
  return lower(sig.subtype) === 'permit' || lower(sig.kind) === 'permit';
}

/**
 * The trades that see this record: its own tags plus, for a building permit, the trades downstream of the permit type. The tags are
 * kept as they are (they say who does the work); the downstream trades are added after them. Returns `categories` itself when nothing
 * is added, so a non-permit record costs one comparison.
 */
export function carriedTrades(sig: RoutedRecord, categories: readonly string[] | null | undefined): readonly string[] {
  const own = categories ?? [];
  if (!isPermitRecord(sig)) return own;
  const extra = downstreamTradesOf(sig.title, { summary: sig.summary, source: sig.source }).filter((t) => !own.includes(t));
  return extra.length ? [...own, ...extra] : own;
}

/**
 * Trades to read from the database for a member's trades: the trades themselves plus the tags of the permit kinds that route to them,
 * so a siding member's read also fetches roof-tagged rows. A WIDER read only: matchOne decides what a member actually gets.
 */
export function expandCategoriesForRouting(trades: readonly string[]): string[] {
  const out = [...trades];
  for (const k of ROUTE_KINDS) {
    if (!DOWNSTREAM[k].some((t) => trades.includes(t))) continue;
    for (const tag of KIND_CARRIER_TAGS[k]) if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

// ---- "why it matters", one deterministic sentence per (permit kind, trade) -----------------------------------------------------

/**
 * Each sentence says what the permit shows and what may follow for this trade. None says a hire happened, that anyone is choosing a
 * vendor, or that the work is certain ("may", "often"). At most 80 characters once {Permit} is filled in (MAX_WHY in brief.ts; a test
 * checks every cell with every noun). {Permit} is the permit's own noun with its article ("A roof permit", "An addition permit", "A
 * new-home permit"): the sentence names the permit the title names, so an addition is never called a remodel and a roof permit is not
 * called a re-roof.
 */
export const ROUTE_WHY: Readonly<Record<string, string>> = {
  're-roof|siding-gutters': '{Permit} was filed nearby; gutters and siding often come up with it.',
  're-roof|solar': '{Permit} was filed nearby; a new roof is when solar is often added.',
  're-roof|junk-removal': '{Permit} was filed nearby, and old roofing may need hauling.',
  'new-build|moving': '{Permit} was filed nearby; people may move in once it is built.',
  'new-build|landscaping': '{Permit} was filed nearby; new yards often need landscaping.',
  'new-build|fencing': '{Permit} was filed nearby; new homes often get a fence.',
  'new-build|cleaning': '{Permit} was filed nearby; finished buildings may need a clean.',
  'new-build|security': '{Permit} was filed nearby; new places may get security later.',
  'new-build|pool-spa': '{Permit} was filed nearby; some new homes add a pool.',
  'new-build|windows-doors': '{Permit} was filed nearby; windows and doors may be part of it.',
  'remodel|flooring': '{Permit} was filed nearby; this kind of job often includes new floors.',
  'remodel|painting': '{Permit} was filed nearby; this kind of job often ends with painting.',
  'remodel|cleaning': '{Permit} was filed nearby; a finished job may need a clean.',
  'remodel|junk-removal': '{Permit} was filed nearby, and debris from the job may need hauling.',
  'remodel|handyman': '{Permit} was filed nearby; small repair jobs may come up with it.',
  'solar|electrical': '{Permit} was filed nearby; solar installs often need electrical work.',
  'solar|roofing': '{Permit} was filed nearby; panels go on roofs, so the roof may be checked.',
  'demolition|junk-removal': '{Permit} was filed nearby, and hauling often follows.',
  'demolition|fencing': '{Permit} was filed nearby; a cleared site may need fencing.',
  'demolition|concrete-paving': '{Permit} was filed nearby; a cleared site may need concrete work.',
  'fit-out|janitorial-commercial': '{Permit} was filed nearby; a finished space may need cleaning.',
  'fit-out|signs-printing': '{Permit} was filed nearby; a new space may need signs.',
  'fit-out|security': '{Permit} was filed nearby; a new space may need security.',
  'fit-out|pest-control': '{Permit} was filed nearby; a new space may need pest control.',
  'fit-out|business-services': '{Permit} was filed nearby; a new space may need IT setup.',
};

/** Every noun a kind's sentences can use (the permit's own name), with its article. A test fills every cell with every one of them. */
export const PERMIT_NOUNS: Readonly<Record<RouteKind, readonly string[]>> = {
  're-roof': ['A roof permit'],
  'new-build': ['A new-home permit', 'A new-construction permit'],
  remodel: ['A remodel permit', 'An addition permit'],
  solar: ['A solar permit'],
  demolition: ['A demolition permit'],
  'fit-out': ['A tenant fit-out permit', 'A commercial permit', 'An apartment permit'],
};

/** What a "new-build" permit is called in its sentences. Kept for the brief's string table. */
export const NEW_BUILD_NOUNS = ['new-home permit', 'new-construction permit'] as const;

/** The permit's noun for the sentence: its own words from the title, never the route kind's. */
function permitNounFor(kind: RouteKind, title: string | null | undefined, ctx?: RouteContext | null): string {
  const labels = permitLabelsOf(title) ?? [];
  const nouns = PERMIT_NOUNS[kind];
  switch (kind) {
    case 'new-build':
      return labels.includes('new home') ? nouns[0] : nouns[1];
    case 'remodel':
      // A new build or fit-out reached through the record's class is a remodel only when the title says so.
      return labels.includes('addition') && !labels.includes('remodel') ? nouns[1] : nouns[0];
    case 'fit-out':
      if (labels.includes('tenant fit-out')) return nouns[0];
      // "Multi Family" is housing, not a commercial space (final review P2-4): the sentence says so.
      return /\bmulti[\s-]?family\b|\bapartments?\b/i.test(ctx?.summary ?? '') ? nouns[2] : nouns[1];
    default:
      return nouns[0];
  }
}

/** The sentence for this permit title and trade, or null when the trade is not downstream of the title. */
export function routeWhyFor(title: string | null | undefined, trade: string | null | undefined, ctx?: RouteContext | null): string | null {
  const k = routeFor(title, trade, ctx);
  const text = k ? ROUTE_WHY[`${k}|${trade}`] : undefined;
  if (!k || !text) return null;
  const noun = permitNounFor(k, title, ctx);
  // "A finished building may need a clean" says "home" only when the permit's own title says a home is being built.
  const out = text.replace('{Permit}', noun);
  return k === 'new-build' && trade === 'cleaning' && noun === 'A new-home permit' ? out.replace('finished buildings', 'finished homes') : out;
}
