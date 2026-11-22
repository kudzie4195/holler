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
};

/** Labels that name no particular trade (the "generic" kinds of mapping/permit.ts). A bare "New construction" next to one still reads as a new building. */
const GENERIC_LABELS: ReadonlySet<string> = new Set(['deck', 'porch', 'accessory building', 'addition', 'tenant fit-out', 'remodel', 'structural', 'site work', 'building']);

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
 * The matrix kinds a title names, in ROUTE_KINDS order.
 * "New construction" next to a named trade ("New construction and plumbing") is NOT a new building: the structured type of those
 * permits is only "New" (a new plumbing line, a new panel), so it routes nowhere. A new building is "New home" (any company), or
 * "New construction" with nothing but generic kinds beside it.
 */
export function routeKindsOf(title: string | null | undefined): RouteKind[] {
  const labels = permitLabelsOf(title);
  if (!labels) return [];
  const hit = new Set<RouteKind>();
  for (const l of labels) {
    const k = LABEL_ROUTE[l];
    if (!k) continue;
    if (l === 'new construction' && labels.some((x) => x !== 'new construction' && x !== 'new home' && !GENERIC_LABELS.has(x))) continue;
    hit.add(k);
  }
  return ROUTE_KINDS.filter((k) => hit.has(k));
}

/** The trades that do the work this title names (they get the market insight, never the downstream route). */
export function doerTradesOf(title: string | null | undefined): Set<CategoryId> {
  const out = new Set<CategoryId>();
  for (const l of permitLabelsOf(title) ?? []) for (const t of KIND_DOERS[l] ?? []) out.add(t);
  return out;
}

/** The kind that makes `trade` downstream of this permit, or null. A trade that does the permitted work is never downstream of it. */
export function routeFor(title: string | null | undefined, trade: string | null | undefined): RouteKind | null {
  if (!trade) return null;
  const kinds = routeKindsOf(title);
  if (kinds.length === 0) return null;
  if (doerTradesOf(title).has(trade as CategoryId)) return null;
  for (const k of kinds) if ((DOWNSTREAM[k] as readonly string[]).includes(trade)) return k;
  return null;
}

/** Every trade that is downstream of this permit title (and does not do its work). */
export function downstreamTradesOf(title: string | null | undefined): CategoryId[] {
  const kinds = routeKindsOf(title);
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
  const extra = downstreamTradesOf(sig.title).filter((t) => !own.includes(t));
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
 * vendor, or that the work is certain ("may", "often"). At most 80 characters once {permit} is filled in (MAX_WHY in brief.ts; a test
 * checks every cell). {permit} is "new-home permit" or "new-construction permit", whichever the title says.
 */
export const ROUTE_WHY: Readonly<Record<string, string>> = {
  're-roof|siding-gutters': 'A re-roof permit was filed nearby; gutters and siding often come up with it.',
  're-roof|solar': 'A re-roof permit was filed nearby; a new roof is when solar is often added.',
  're-roof|junk-removal': 'A re-roof permit was filed nearby, and old roofing may need hauling.',
  'new-build|moving': 'A {permit} was filed nearby; people may move in once it is built.',
  'new-build|landscaping': 'A {permit} was filed nearby; new yards often need landscaping.',
  'new-build|fencing': 'A {permit} was filed nearby; new homes often get a fence.',
  'new-build|cleaning': 'A {permit} was filed nearby; a finished home may need a clean.',
  'new-build|security': 'A {permit} was filed nearby; new places may get security later.',
  'new-build|pool-spa': 'A {permit} was filed nearby; some new homes add a pool.',
  'new-build|windows-doors': 'A {permit} was filed nearby; windows and doors may be part of it.',
  'remodel|flooring': 'A remodel permit was filed nearby; remodels often include new floors.',
  'remodel|painting': 'A remodel permit was filed nearby; remodels often end with painting.',
  'remodel|cleaning': 'A remodel permit was filed nearby; a finished remodel may need a clean.',
  'remodel|junk-removal': 'A remodel permit was filed nearby, and remodel debris may need hauling.',
  'remodel|handyman': 'A remodel permit was filed nearby; small repair jobs may come up with it.',
  'solar|electrical': 'A solar permit was filed nearby; solar installs often need electrical work.',
  'solar|roofing': 'A solar permit was filed nearby; panels go on roofs, so the roof may be checked.',
  'demolition|junk-removal': 'A demolition permit was filed nearby, and hauling often follows.',
  'demolition|fencing': 'A demolition permit was filed nearby; a cleared site may need fencing.',
  'demolition|concrete-paving': 'A demolition permit was filed nearby; a cleared site may need concrete work.',
  'fit-out|janitorial-commercial': 'A tenant fit-out permit was filed nearby; a finished space may need cleaning.',
  'fit-out|signs-printing': 'A tenant fit-out permit was filed nearby; a new space may need signs.',
  'fit-out|security': 'A tenant fit-out permit was filed nearby; a new space may need security.',
  'fit-out|pest-control': 'A tenant fit-out permit was filed nearby; a new space may need pest control.',
  'fit-out|business-services': 'A tenant fit-out permit was filed nearby; a new space may need IT setup.',
};

/** What a "new-build" permit is called in its sentences: the title says "New home" or "New construction", and the sentence repeats it. */
export const NEW_BUILD_NOUNS = ['new-home permit', 'new-construction permit'] as const;

/** The sentence for this permit title and trade, or null when the trade is not downstream of the title. */
export function routeWhyFor(title: string | null | undefined, trade: string | null | undefined): string | null {
  const k = routeFor(title, trade);
  const text = k ? ROUTE_WHY[`${k}|${trade}`] : undefined;
  if (!text) return null;
  return text.replace('{permit}', (permitLabelsOf(title) ?? []).includes('new home') ? NEW_BUILD_NOUNS[0] : NEW_BUILD_NOUNS[1]);
}
