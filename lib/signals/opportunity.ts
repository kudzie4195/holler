import { categoryById, type CategoryId } from '@/lib/signals/categories';

/**
 * Opportunity of an alert FOR ONE TRADE: is this record something the trade can act on, or only worth knowing?
 *   act     - someone must or asked to buy, often with a deadline (a repair order, a request, an open bid, no heat in a building).
 *   soon    - evidence of likely demand for this trade (work that usually follows a permit, a storm warning, a new business).
 *   intel   - worth knowing, not a job to chase (competitor work on a permit, a contract award, a watch or advisory).
 *   context - never alert (city work on public property, generic records, records for other trades).
 *
 * The same record reads differently per trade: a re-roof permit is competitor intel for roofers (the job is taken) and a sign of
 * coming work for gutter and solar companies. opportunityTrades() lists every trade that gets more than 'context', including
 * downstream trades that are not in the record's own categories.
 *
 * Rules were written against 14 days of live rows (anchors/signals-14d.json, 21,170 rows) and are replayed by
 * scripts/opportunity-replay.ts, which checks the invariants listed there. Pure and client-safe: imports only categories.ts.
 * Unknown kinds, subtypes and sources fall back to 'context' (never alert on a record Holler has no rule for).
 *
 * Copy rules: plain and short, no hype, never says a vendor is being chosen or that damage is confirmed, never invents numbers,
 * and every brief says what is NOT known.
 */

export type Opportunity = 'act' | 'soon' | 'intel' | 'context';

export const OPPORTUNITIES: readonly Opportunity[] = ['act', 'soon', 'intel', 'context'];

export const OPPORTUNITY_RANK: Record<Opportunity, number> = { act: 3, soon: 2, intel: 1, context: 0 };

export const OPPORTUNITY_LABEL: Record<Opportunity, string> = {
  act: 'Act now',
  soon: 'Coming soon',
  intel: 'Market insight',
  context: 'Background',
};

export interface OpportunityInput {
  kind: string;
  subtype?: string | null;
  source: string;
  title?: string | null;
  summary?: string | null;
  categories: string[];
  severity?: number | null;
  data?: unknown;
}

export interface OpportunityBrief {
  label: Opportunity;
  /** Stable machine key (OPPORTUNITY_REASONS). */
  reason: string;
  /** One sentence: why this matters to THIS trade, grounded only in what the record says. */
  why: string;
  /** One practical next step. */
  next: string;
  /** What is NOT known. Always non-empty. */
  uncertain: string;
}

export const OPPORTUNITY_REASONS = [
  // act
  'asking',
  'open-bid',
  'violation-repair',
  'heat-complaint',
  'sewage-backup',
  'private-graffiti',
  'failed-inspection',
  'storm-damage-report',
  'hail-report',
  'tornado-report',
  // soon
  'bid-notice',
  'permit-downstream',
  'violation-general',
  'violation-abatement',
  'building-complaint',
  'private-property-complaint',
  'new-business',
  'storm-warning',
  'wind-gust-report',
  'disaster-declaration',
  'strong-quake',
  'event-permit',
  'big-event',
  'airport-delay',
  // intel
  'permit-own-trade',
  'contract-award',
  'weather-watch',
  'cold-weather',
  // context
  'public-works',
  'public-graffiti',
  'city-request',
  'inspection-other',
  'minor-weather',
  'minor-quake',
  'other-trades',
  'unknown',
] as const;

export type OpportunityReason = (typeof OPPORTUNITY_REASONS)[number];

/** Rule family a record fell into. 'unknown' means no explicit rule: the replay reports these. */
export type OpportunityFamily =
  | 'asking'
  | 'federal-bid'
  | 'federal-award'
  | 'permit'
  | 'violation'
  | '311'
  | 'inspection'
  | 'business'
  | 'event-permit'
  | 'weather'
  | 'storm-report'
  | 'disaster'
  | 'quake'
  | 'travel'
  | 'event'
  | 'unknown';

interface Grant {
  label: Opportunity;
  reason: OpportunityReason;
}

export interface OpportunityAssessment {
  family: OpportunityFamily;
  /** False when the record fell to a default with no explicit rule (unknown source or kind, unlisted weather event). */
  known: boolean;
  /** Trade to its label and reason. Trades not listed are 'context'. */
  grants: Partial<Record<CategoryId, Grant>>;
  /** Reason given to every trade not in grants. */
  fallback: OpportunityReason;
  /** Facts the copy may repeat (all read from the record). */
  detail: { kinds?: string[]; event?: string; publicPost?: boolean; residential?: boolean; hailInches?: number | null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Helpers

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Record text without the "<Thing> in <City>: " prefix the adapters put in front of the record's own type value. */
function typeText(sig: OpportunityInput): string {
  const t = typeof sig.title === 'string' ? sig.title : '';
  const m = /^[^:]*?\bin\s[^:]*:\s*(.+)$/.exec(t);
  const out = m ? m[1] : t || (typeof sig.summary === 'string' ? sig.summary : '');
  return out.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function dataObj(sig: OpportunityInput): Record<string, unknown> {
  return sig.data && typeof sig.data === 'object' ? (sig.data as Record<string, unknown>) : {};
}

function validCats(ids: readonly string[]): CategoryId[] {
  const out: CategoryId[] = [];
  for (const id of ids) if (categoryById(id) && !out.includes(id as CategoryId)) out.push(id as CategoryId);
  return out;
}

function grantAll(g: Partial<Record<CategoryId, Grant>>, trades: readonly CategoryId[], label: Opportunity, reason: OpportunityReason) {
  for (const t of trades) {
    const cur = g[t];
    if (!cur || OPPORTUNITY_RANK[label] > OPPORTUNITY_RANK[cur.label]) g[t] = { label, reason };
  }
}

function assess(
  family: OpportunityFamily,
  fallback: OpportunityReason,
  grants: Partial<Record<CategoryId, Grant>> = {},
  detail: OpportunityAssessment['detail'] = {},
  known = true,
): OpportunityAssessment {
  return { family, known, grants, fallback, detail };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Asking and federal

/** Sources whose rows are people asking (same list as lib/signals/intent.ts). 'holler-request' is a request made on Holler. */
const ASKING_SOURCES = new Set(['holler-request', 'bluesky', 'websearch-brave', 'websearch-serper']);
const PUBLIC_POST_SOURCES = new Set(['bluesky', 'websearch-brave', 'websearch-serper']);

/**
 * SAM.gov notice types (data.type). A solicitation is open for offers: act. A presolicitation or sources sought notice is the
 * agency asking who is out there before it buys (fixture: 'Presolicitation', 'Sources Sought'): soon, not act.
 */
const NOT_YET_BID_RE = /presolicitation|sources?\s+sought|special\s+notice|intent\s+to\s+bundle/i;

// ---------------------------------------------------------------------------------------------------------------------------------
// Permits

/**
 * Mirror of lib/signals/mapping/permit.ts PERMIT_KINDS (id and fixed title label). Not imported: that module pulls the Socrata
 * dataset tables (~60 KB of config) into the client bundle. tests/signals/opportunity.test.ts checks that both lists agree.
 */
export const PERMIT_KIND_LABELS: readonly { id: string; label: string }[] = [
  { id: 'new-home', label: 'New home' },
  { id: 'new-construction', label: 'New construction' },
  { id: 'roof', label: 'Roof' },
  { id: 'solar', label: 'Solar' },
  { id: 'pool', label: 'Pool' },
  { id: 'water-heater', label: 'Water heater' },
  { id: 'hvac', label: 'HVAC' },
  { id: 'plumbing', label: 'Plumbing' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'demolition', label: 'Demolition' },
  { id: 'tree', label: 'Tree removal' },
  { id: 'fence', label: 'Fence' },
  { id: 'retaining-wall', label: 'Retaining wall' },
  { id: 'landscape', label: 'Landscaping' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'windows', label: 'Window' },
  { id: 'doors', label: 'Door' },
  { id: 'siding', label: 'Siding' },
  { id: 'gutters', label: 'Gutter' },
  { id: 'flooring', label: 'Flooring' },
  { id: 'sign', label: 'Sign' },
  { id: 'painting', label: 'Painting' },
  { id: 'damage-repair', label: 'Damage repair' },
  { id: 'deck', label: 'Deck' },
  { id: 'porch', label: 'Porch' },
  { id: 'accessory', label: 'Accessory building' },
  { id: 'addition', label: 'Addition' },
  { id: 'fit-out', label: 'Tenant fit-out' },
  { id: 'remodel', label: 'Remodel' },
  { id: 'structural', label: 'Structural' },
  { id: 'site-work', label: 'Site work' },
  { id: 'building', label: 'Building' },
];

/**
 * Trades that DO the permitted work. Same as PERMIT_KINDS cats, except a new home: its cats also carry real-estate and moving,
 * which do not build the house; they come after it and are listed as downstream below.
 */
export const PERMIT_DOING: Record<string, CategoryId[]> = {
  'new-home': ['general-contractor'],
  'new-construction': ['general-contractor'],
  roof: ['roofing'],
  solar: ['solar'],
  pool: ['pool-spa'],
  'water-heater': ['plumbing'],
  hvac: ['hvac'],
  plumbing: ['plumbing'],
  electrical: ['electrical'],
  demolition: ['junk-removal'],
  tree: ['tree-service'],
  fence: ['fencing'],
  'retaining-wall': ['landscaping'],
  landscape: ['landscaping'],
  concrete: ['concrete-paving'],
  windows: ['windows-doors'],
  doors: ['windows-doors'],
  siding: ['siding-gutters'],
  gutters: ['siding-gutters'],
  flooring: ['flooring'],
  sign: ['signs-printing'],
  painting: ['painting'],
  'damage-repair': ['restoration'],
  deck: ['general-contractor'],
  porch: ['general-contractor'],
  accessory: ['general-contractor'],
  addition: ['general-contractor'],
  'fit-out': ['general-contractor'],
  remodel: ['general-contractor'],
  structural: ['general-contractor'],
  'site-work': ['general-contractor'],
  building: ['general-contractor'],
};

/** After a remodel, addition, structural or generic building job: finishes, cleanup and haul-away, small fixes, new circuits. */
const FINISH_TRADES: CategoryId[] = ['flooring', 'painting', 'cleaning', 'junk-removal', 'handyman', 'electrical'];

/**
 * Trades whose work usually COMES AFTER the permitted job (label 'soon'). Every kind has an entry; an empty list means the job is
 * self-contained and the record shows no follow-on work for another trade. A trade that also does the permitted work on the same
 * record stays 'intel' (own trade wins).
 */
export const PERMIT_DOWNSTREAM: Record<string, CategoryId[]> = {
  // A finished house gets bought or moved into, then a yard, fence, cleaning before move-in, an alarm, sometimes a pool, storm and
  // screen doors or a garage door opener the builder did not fit.
  'new-home': ['real-estate', 'moving', 'landscaping', 'lawn-care', 'fencing', 'cleaning', 'security', 'pool-spa', 'windows-doors'],
  // Any new building (home or commercial) needs a site finished around it, a post-construction clean and usually an alarm.
  'new-construction': ['landscaping', 'concrete-paving', 'fencing', 'cleaning', 'janitorial-commercial', 'security'],
  // A re-roof is when owners replace gutters and siding trim, add solar on the new roof, and haul off what the tear-off left.
  roof: ['siding-gutters', 'solar', 'junk-removal'],
  // Solar often needs a panel or service upgrade, and roof prep or repair before the panels go on.
  solar: ['electrical', 'roofing'],
  // Pool codes require a barrier fence; a pool also needs a deck or patio, planting around it and power for the pump.
  pool: ['fencing', 'concrete-paving', 'landscaping', 'electrical'],
  // A heater swap is self-contained.
  'water-heater': [],
  // A system swap is self-contained: the installer does its own wiring and haul-away.
  hvac: [],
  // Plumbing work is self-contained on the record (no wall or floor work named).
  plumbing: [],
  // Electrical work alone names no follow-on trade.
  electrical: [],
  // A cleared lot gets a construction fence and new flatwork (driveway, slab) before or with the next build.
  demolition: ['fencing', 'concrete-paving'],
  // Where trees come out, owners replant or regrade.
  tree: ['landscaping'],
  // A fence is a finished job.
  fence: [],
  // A retaining wall is part of a landscape job already counted as landscaping.
  'retaining-wall': [],
  // A new landscape needs regular mowing and upkeep.
  landscape: ['lawn-care'],
  // Flatwork is a finished job.
  concrete: [],
  // Windows and doors are finished jobs (the installer trims them out).
  windows: [],
  doors: [],
  // Siding and gutters are finished jobs.
  siding: [],
  gutters: [],
  // Floors are a finished job.
  flooring: [],
  // A new sign usually means a new or changed tenant setting up: cleaning contract, alarm, point of sale and IT.
  sign: ['janitorial-commercial', 'security', 'business-services'],
  // Painting is a finished job.
  painting: [],
  // After water, fire or storm mitigation comes the rebuild: floors, paint, small repairs, contents and debris haul-away.
  'damage-repair': ['general-contractor', 'flooring', 'painting', 'handyman', 'junk-removal'],
  // A new deck or porch gets stained or painted.
  deck: ['painting'],
  porch: ['painting'],
  // A shed, garage or barn needs a slab and power.
  accessory: ['concrete-paving', 'electrical'],
  // An addition is a remodel plus new rooms to heat and cool.
  addition: [...FINISH_TRADES, 'hvac'],
  // A tenant build-out opens a business: cleaning contract, sign, alarm, pest contract (food uses), POS and IT, floors and paint.
  'fit-out': ['janitorial-commercial', 'signs-printing', 'security', 'pest-control', 'business-services', 'flooring', 'painting'],
  remodel: FINISH_TRADES,
  structural: FINISH_TRADES,
  // Grading comes before flatwork and planting.
  'site-work': ['concrete-paving', 'landscaping'],
  building: FINISH_TRADES,
};

const LABEL_TO_KIND = new Map(PERMIT_KIND_LABELS.map((k) => [k.label.toLowerCase(), k.id]));

/**
 * Kind ids named by a permit title ("Roof, HVAC and plumbing permit in Austin" -> roof, hvac, plumbing). The title is built only
 * from PERMIT_KINDS labels joined by ", " and " and " (permit.ts joinLabels). Parts that are not a known label are returned apart.
 */
export function permitKindsFromTitle(title: string | null | undefined): { kinds: string[]; unparsed: string[] } {
  const m = /^(.*?)\s+permit\s+in\s/i.exec(typeof title === 'string' ? title.trim() : '');
  if (!m) return { kinds: [], unparsed: [] };
  const kinds: string[] = [];
  const unparsed: string[] = [];
  for (const part of m[1].split(/,\s+|\s+and\s+/)) {
    const id = LABEL_TO_KIND.get(part.trim().toLowerCase());
    if (id) {
      if (!kinds.includes(id)) kinds.push(id);
    } else if (part.trim()) unparsed.push(part.trim());
  }
  return { kinds, unparsed };
}

/** Own trades (do the work) and downstream trades (come after) for a permit record. */
export function permitTrades(sig: OpportunityInput): { kinds: string[]; own: CategoryId[]; downstream: CategoryId[] } {
  const { kinds } = permitKindsFromTitle(sig.title);
  const cats = validCats(sig.categories ?? []);
  const own = new Set<CategoryId>();
  const after = new Set<CategoryId>();
  for (const k of kinds) {
    (PERMIT_DOING[k] ?? []).forEach((t) => own.add(t));
    (PERMIT_DOWNSTREAM[k] ?? []).forEach((t) => after.add(t));
  }
  // A tagged trade that is not a documented downstream trade of the title's kinds is treated as doing the work (older rows).
  for (const c of cats) if (!after.has(c)) own.add(c);
  return { kinds, own: [...own], downstream: [...after].filter((t) => !own.has(t)) };
}

function permitRule(sig: OpportunityInput): OpportunityAssessment {
  const { kinds, own, downstream } = permitTrades(sig);
  const g: Partial<Record<CategoryId, Grant>> = {};
  grantAll(g, own, 'intel', 'permit-own-trade');
  grantAll(g, downstream, 'soon', 'permit-downstream');
  const labels = kinds.map((k) => PERMIT_KIND_LABELS.find((x) => x.id === k)!.label);
  return assess('permit', 'other-trades', g, { kinds: labels });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Code violations

/**
 * Repair trades named by violation text (read from the fixture: Chicago building violations such as "REPAIR EXTERIOR WALL",
 * "INSTALL SMOKE DETECTORS", "HEAT UNIT ADEQUATELY"; Austin "Structure Condition Violation(s)", "trash or debris and overgrown yard").
 * Every matching row adds its trades. Water heater words are removed before the heating test.
 */
const VIOLATION_TRADES: { re: RegExp; trades: CategoryId[]; unless?: RegExp }[] = [
  // Not when the wall or stair is only where the paint or the light is ("INT WALL/CEILING PEELING PAINT", "ILLUMINATE PUBLIC STAIR/HALL").
  { re: /exterior wall|\bwalls?\b|ceiling|porch|stair|balcon|structur|building condition|foundation|sidewalk shed|parapet|chimney/, trades: ['handyman', 'general-contractor'], unless: /paint|illuminat|lighting/ },
  { re: /\broof/, trades: ['roofing'] },
  { re: /smoke detector|carbon monoxide|co detector/, trades: ['electrical', 'handyman'] },
  { re: /electric|wiring|outlet|breaker|\bjbs?\b|junction box|illuminat|lighting|light fixture|fixtures?\b/, trades: ['electrical'] },
  { re: /plumb|water heater|toilet|\bsinks?\b|floor drain|soil\/waste|vent pipe|\bpipes?\b|\bleak|sewage|hot water|water supply/, trades: ['plumbing'] },
  { re: /\bheat|boiler|furnace|burner|cooling|hvac|ventilat/, trades: ['hvac'] },
  { re: /overgrown|weeds?\b|tall grass|\bgrass\b|\byard\b|\blawn/, trades: ['lawn-care', 'landscaping'] },
  { re: /trash|debris|junk|garbage|rubbish|litter|refuse|bulk item/, trades: ['junk-removal'] },
  { re: /rodent|\brats?\b|\bmice\b|roach|insect|\bpests?\b|vermin|bed ?bugs?|infest/, trades: ['pest-control'] },
  { re: /\bfenc/, trades: ['fencing'] },
  { re: /window|\bdoors?\b|screen|glass|\bpanes?\b|\bsills?\b|mullion|plexglas|viewing device/, trades: ['windows-doors', 'handyman'] },
  { re: /\bkeys?\b|\blocks?\b|deadbolt/, trades: ['locksmith'] },
  { re: /paint|graffiti/, trades: ['painting'] },
  { re: /gutter|downspout|siding|soffit|fascia/, trades: ['siding-gutters'] },
  { re: /\bfloor\b(?!\s*drain)|flooring/, trades: ['flooring', 'handyman'] },
  { re: /\bmold/, trades: ['restoration'] },
  { re: /\btrees?\b|\blimbs?\b/, trades: ['tree-service'] },
  { re: /\bpool/, trades: ['pool-spa'] },
  { re: /driveway|paving|concrete|sidewalk(?!\s*shed)/, trades: ['concrete-paving'] },
  { re: /vacant|open to entry|board(?:ed)? up|secure (?:the )?(?:building|structure|premises)/, trades: ['handyman', 'security'] },
];

/** "Property Abatement" (Austin): a cleanup case the city may carry out itself if the owner does not. */
const ABATEMENT_RE = /abatement/;
/** Trades a generic violation keeps from the record's own categories (set from fields Holler does not print, e.g. DeKalb case type). */
const VIOLATION_TAG_TRADES = new Set<CategoryId>(VIOLATION_TRADES.flatMap((r) => r.trades));

function violationRule(sig: OpportunityInput): OpportunityAssessment {
  const text = typeText(sig);
  const g: Partial<Record<CategoryId, Grant>> = {};
  if (ABATEMENT_RE.test(text)) {
    grantAll(g, ['junk-removal', 'lawn-care'], 'soon', 'violation-abatement');
    return assess('violation', 'other-trades', g);
  }
  const hit = new Set<CategoryId>();
  for (const r of VIOLATION_TRADES) {
    // A water heater is plumbing: its words never pick heating.
    const probe = r.trades.includes('hvac') ? text.replace(/water heaters?/g, ' ') : text;
    if (r.re.test(probe) && !(r.unless && r.unless.test(probe))) r.trades.forEach((x) => hit.add(x));
  }
  if (hit.size) {
    grantAll(g, [...hit], 'act', 'violation-repair');
  } else {
    // The notice names no repair ("property violation", "Work Without Permit", "OR LICENSED CONTRACTOR").
    const tagged = validCats(sig.categories ?? []).filter((c) => VIOLATION_TAG_TRADES.has(c));
    grantAll(g, ['handyman', 'general-contractor', ...tagged], 'soon', 'violation-general');
  }
  return assess('violation', 'other-trades', g);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 311

/**
 * 311 is city work by default. Exceptions found in the fixture, in order:
 *  - heat or hot water out in a building (NYC "HEAT/HOT WATER / ENTIRE BUILDING", "Non-Residential Heat / Inadequate or No Heat",
 *    Cincinnati "HEAT, NO HEAT HAZARD"): act.
 *  - sewage backing up (NYC "Sewer Maintenance / Backup", SF "Sewer / sewage_back-up_discharge", KC "Sewer Backup"): act.
 *  - graffiti marked private (SF "Graffiti Private / ..."): act. Graffiti without a private marker is the city's.
 *  - pests, mold or condition problems inside a private building (Cincinnati "MICE, BUILDING HAS MICE", "ROACHES - BLDG OR
 *    APARTMENT", "MOLD, BUILDING OR APARTMENT", NOLA "Healthy Homes"): soon.
 *  - code complaints on private property (KC "Property Violations / Weeds", Cincinnati "TALL GRASS/WEEDS, PRIVATE PROP",
 *    "TREE, DEAD ON PRIV PROP", "DUMPING, PRV PROP"): soon.
 */
const PRIVATE_RE = /\bprivate\b|\bpriv\b|\bprv\b/;
const CITY_BUILDING_RE = /city bldg|city building/;

const PUBLIC_WORKS_RE =
  /tree (?:trim|planting|removal|debris|emergency|maintenance|service|pruning|issue|inspection)|\btrees?\b|sewer|catch basin|manhole|culvert|storm drain|stormwater|street|pothole|paving|sidewalk|curb|missed|bulk|recycling|fly dumping|illegal dumping|illdump|dumping|rodent baiting|rodent|rat sighting|mouse sighting|mosquito|street ?light|lamp|abandoned|vehicle|junk\/aban|right of way|\brow\b|vacant lot|bike lane|debris|spillage|sign|signal|graffiti|dumpster|trash|litter|city bldg|park|water main|hydrant|alley|traffic|restoration, repair cww/;

function threeOneOneRule(sig: OpportunityInput): OpportunityAssessment {
  const t = typeText(sig);
  const g: Partial<Record<CategoryId, Grant>> = {};
  const residential = !/non.?residential|comm(?:ercial)? location/.test(t);

  if (/heat\s*\/\s*hot water|no heat|inadequate heat|lack of heat|no hot water|no water\b/.test(t) && !CITY_BUILDING_RE.test(t)) {
    // Heat out: HVAC. Hot water or water out: plumbing ("HEAT/HOT WATER" names both).
    const trades: CategoryId[] = [];
    if (/heat\b/.test(t)) trades.push('hvac');
    if (/hot water|no water/.test(t)) trades.push('plumbing');
    grantAll(g, trades, 'act', 'heat-complaint');
    return assess('311', 'other-trades', g, { residential });
  }
  if (/sewage.?back.?up|sewer.?back.?up|sewer maintenance \/ backup|\bbackup\b.*sewer|sewer.*\bbackup\b/.test(t)) {
    grantAll(g, ['plumbing', 'restoration'], 'act', 'sewage-backup');
    return assess('311', 'other-trades', g);
  }
  if (/graffiti/.test(t)) {
    if (PRIVATE_RE.test(t)) {
      grantAll(g, ['painting', 'cleaning'], 'act', 'private-graffiti');
      return assess('311', 'other-trades', g);
    }
    return assess('311', 'public-graffiti');
  }
  if (!CITY_BUILDING_RE.test(t)) {
    if (/(?:roach|mice|\bmouse\b|rodent|bed ?bug|pests?\b).*(?:bldg|building|apartment)|(?:bldg|building|apartment).*(?:roach|mice|rodent|bed ?bug)|building has mice/.test(t)) {
      grantAll(g, ['pest-control'], 'soon', 'building-complaint');
      return assess('311', 'other-trades', g);
    }
    if (/\bmold\b/.test(t) && /building|apartment|bldg|location|residen|unit/.test(t)) {
      grantAll(g, ['restoration'], 'soon', 'building-complaint');
      return assess('311', 'other-trades', g);
    }
    if (/healthy homes|structur|building condition|structure condition/.test(t)) {
      grantAll(g, ['handyman', 'general-contractor'], 'soon', 'building-complaint');
      return assess('311', 'other-trades', g);
    }
  }
  const privateProp = PRIVATE_RE.test(t) || /property violations?\b/.test(t);
  if (privateProp) {
    const trades: CategoryId[] = [];
    if (/weeds?|grass|overgrown|lawn/.test(t)) trades.push('lawn-care', 'landscaping');
    if (/\btrees?\b/.test(t)) trades.push('tree-service');
    if (/dumping|trash|litter|debris|junk/.test(t)) trades.push('junk-removal');
    if (/open to entry|vacant/.test(t)) trades.push('handyman', 'security');
    if (/other property maintenance/.test(t)) trades.push('handyman', 'general-contractor');
    if (trades.length) {
      grantAll(g, trades, 'soon', 'private-property-complaint');
      return assess('311', 'other-trades', g);
    }
  }
  if (PUBLIC_WORKS_RE.test(t)) return assess('311', 'public-works');
  // Any other 311 request: city service, no private customer named.
  return assess('311', 'city-request');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Inspections, business licences, event permits

function inspectionRule(sig: OpportunityInput): OpportunityAssessment {
  const t = `${norm(sig.title)} ${norm(sig.summary)}`;
  if (/\bfail/.test(t) && /food|restaurant|establishment|kitchen|retail food|grocery|bakery|caf[eé]/.test(t)) {
    const g: Partial<Record<CategoryId, Grant>> = {};
    grantAll(g, ['pest-control', 'janitorial-commercial'], 'act', 'failed-inspection');
    return assess('inspection', 'other-trades', g);
  }
  return assess('inspection', 'inspection-other');
}

/** Trades a business opening reliably buys (sign, books and POS, cleaning contract, alarm). Locksmith, insurance and house cleaning are not. */
const NEW_BUSINESS_TRADES: CategoryId[] = ['signs-printing', 'business-services', 'janitorial-commercial', 'security'];

function businessRule(): OpportunityAssessment {
  const g: Partial<Record<CategoryId, Grant>> = {};
  grantAll(g, NEW_BUSINESS_TRADES, 'soon', 'new-business');
  return assess('business', 'other-trades', g);
}

const EVENT_PERMIT_TRADES: CategoryId[] = ['catering', 'food-truck', 'event-services', 'security'];

function eventPermitRule(): OpportunityAssessment {
  const g: Partial<Record<CategoryId, Grant>> = {};
  grantAll(g, EVENT_PERMIT_TRADES, 'soon', 'event-permit');
  return assess('event-permit', 'other-trades', g);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Weather alerts (NWS event names, read from the fixture's data.event and title prefix)

const WIND_TRADES: CategoryId[] = ['roofing', 'tree-service', 'restoration', 'siding-gutters', 'public-adjuster'];
const WINTER_TRADES: CategoryId[] = ['snow-removal', 'plumbing', 'hvac', 'towing'];
const FLOOD_TRADES: CategoryId[] = ['restoration', 'plumbing'];
const COLD_TRADES: CategoryId[] = ['plumbing', 'hvac'];

/** Matched in order; the first hit decides. `null` trades means context. */
const WEATHER_EVENTS: { re: RegExp; trades: CategoryId[] | null; intelOnly?: 'cold' | 'heat' }[] = [
  // Never alert: marine (NWS "Storm Warning" and "Hurricane Force Wind Warning" are marine products), coastal, fire weather, air and
  // visibility notices, and plain statements or outlooks.
  { re: /coastal|lakeshore|small craft|marine|gale|hazardous seas|^storm (?:warning|watch)$|hurricane force wind|freezing spray|fog|smoke|air quality|air stagnation|beach hazard|rip current|high surf|red flag|fire weather|brisk wind|lake wind|frost|dust|ashfall|tsunami|statement|outlook|special weather|hydrologic|low water|avalanche/, trades: null },
  { re: /tornado/, trades: [...WIND_TRADES] },
  { re: /hurricane|tropical storm|storm surge|typhoon|extreme wind/, trades: [...WIND_TRADES] },
  { re: /severe thunderstorm|hail/, trades: [...WIND_TRADES] },
  { re: /high wind|wind advisory/, trades: [...WIND_TRADES] },
  // Ice weighs down limbs and lines, so tree service joins the winter trades.
  { re: /ice storm/, trades: [...WINTER_TRADES, 'tree-service'] },
  { re: /winter storm|blizzard|snow squall|winter weather|lake effect snow|heavy snow|snow/, trades: [...WINTER_TRADES] },
  { re: /flash flood|flood/, trades: [...FLOOD_TRADES] },
  { re: /hard freeze|freeze|extreme cold|cold weather|wind chill|cold/, trades: [...COLD_TRADES], intelOnly: 'cold' },
  // Heat is worth knowing for HVAC (strained cooling), not a demand signal on its own.
  { re: /excessive heat|extreme heat|heat advisory|heat warning|heat watch/, trades: ['hvac'], intelOnly: 'heat' },
];

function weatherRule(sig: OpportunityInput): OpportunityAssessment {
  const d = dataObj(sig);
  const fromTitle = typeof sig.title === 'string' ? sig.title.split(':')[0] : '';
  const event = (typeof d.event === 'string' && d.event.trim()) || fromTitle.trim();
  const e = event.toLowerCase();
  const hit = WEATHER_EVENTS.find((w) => w.re.test(e));
  if (!hit) return assess('weather', 'unknown', {}, { event }, false);
  if (!hit.trades) return assess('weather', 'minor-weather', {}, { event });
  const g: Partial<Record<CategoryId, Grant>> = {};
  if (hit.intelOnly) grantAll(g, hit.trades, 'intel', hit.intelOnly === 'cold' ? 'cold-weather' : 'weather-watch');
  else if (/warning|emergency/.test(e)) grantAll(g, hit.trades, 'soon', 'storm-warning');
  else grantAll(g, hit.trades, 'intel', 'weather-watch');
  return assess('weather', 'minor-weather', g, { event });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Storm reports (SPC), disasters, quakes, travel, ticketed events

const DAMAGE_WORDS_RE = /damage|\bdown(?:ed)?\b|blown|uproot|snapped|felled|roof|tree|limb|branch/;

function stormReportRule(sig: OpportunityInput): OpportunityAssessment {
  const d = dataObj(sig);
  const title = norm(sig.title);
  const type = norm(d.type) || (/tornado/.test(title) ? 'tornado' : /hail/.test(title) ? 'hail' : /wind/.test(title) ? 'wind' : '');
  const g: Partial<Record<CategoryId, Grant>> = {};
  if (type === 'tornado' || /^tornado reported/.test(title)) {
    grantAll(g, ['restoration', 'tree-service', 'roofing'], 'act', 'tornado-report');
    return assess('storm-report', 'other-trades', g);
  }
  if (type === 'hail') {
    const fromData = typeof d.hailInches === 'number' ? d.hailInches : NaN;
    const m = /([\d.]+)\s*inch hail/.exec(title);
    const inches = Number.isFinite(fromData) ? fromData : m ? parseFloat(m[1]) : NaN;
    const trades: CategoryId[] = ['roofing', 'siding-gutters', 'auto-body', 'auto-glass', 'public-adjuster'];
    grantAll(g, trades, Number.isFinite(inches) && inches >= 1 ? 'act' : 'intel', 'hail-report');
    return assess('storm-report', 'other-trades', g, { hailInches: Number.isFinite(inches) ? inches : null });
  }
  if (type === 'wind') {
    const comments = norm(d.comments) || norm(sig.summary);
    if (/^wind damage/.test(title) || DAMAGE_WORDS_RE.test(comments)) {
      grantAll(g, ['tree-service'], 'act', 'storm-damage-report');
      grantAll(g, ['roofing', 'restoration'], 'soon', 'storm-damage-report');
    } else {
      // A measured gust with no damage in the report: limbs are likely down, roofs are not known to be hit.
      grantAll(g, ['tree-service'], 'soon', 'wind-gust-report');
      grantAll(g, ['roofing', 'restoration'], 'intel', 'wind-gust-report');
    }
    return assess('storm-report', 'other-trades', g);
  }
  return assess('storm-report', 'unknown', {}, {}, false);
}

const DISASTER_TRADES: CategoryId[] = ['restoration', 'roofing', 'tree-service', 'public-adjuster', 'junk-removal'];

function disasterRule(): OpportunityAssessment {
  const g: Partial<Record<CategoryId, Grant>> = {};
  grantAll(g, DISASTER_TRADES, 'soon', 'disaster-declaration');
  return assess('disaster', 'other-trades', g);
}

function quakeRule(sig: OpportunityInput): OpportunityAssessment {
  const m = /\bM\s?(\d+(?:\.\d+)?)/.exec(typeof sig.title === 'string' ? sig.title : '');
  const d = dataObj(sig);
  const mag = m ? parseFloat(m[1]) : typeof d.mag === 'number' ? d.mag : NaN;
  if (Number.isFinite(mag) && mag >= 5) {
    const g: Partial<Record<CategoryId, Grant>> = {};
    grantAll(g, ['restoration'], 'soon', 'strong-quake');
    return assess('quake', 'other-trades', g);
  }
  return assess('quake', 'minor-quake');
}

function travelRule(): OpportunityAssessment {
  const g: Partial<Record<CategoryId, Grant>> = {};
  grantAll(g, ['rideshare-delivery'], 'soon', 'airport-delay');
  return assess('travel', 'other-trades', g);
}

/** Ticketed events (Ticketmaster): crowds arriving and leaving. Venues run their own catering and security. */
function eventRule(): OpportunityAssessment {
  const g: Partial<Record<CategoryId, Grant>> = {};
  grantAll(g, ['rideshare-delivery', 'food-truck'], 'soon', 'big-event');
  return assess('event', 'other-trades', g);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dispatch

/** data.subtype, or the subtype the title prefix implies for a civic row stored without one. */
function subtypeOf(sig: OpportunityInput): string {
  const s = norm(sig.subtype) || norm(dataObj(sig).subtype);
  if (s) return s;
  const t = norm(sig.title);
  if (/^311 request\b/.test(t)) return '311';
  if (/^code violation\b/.test(t)) return 'violation';
  if (/^failed inspection\b|^inspection\b/.test(t)) return 'inspection';
  if (/^new business licen[cs]e\b/.test(t)) return 'business';
  if (/^permitted event\b/.test(t)) return 'event-permit';
  return '';
}

/** The full assessment of one record (all trades). Exported for the replay and tests. */
export function assessOpportunity(sig: OpportunityInput): OpportunityAssessment {
  const kind = norm(sig.kind);
  const source = norm(sig.source);
  const subtype = subtypeOf(sig);
  const cats = validCats(sig.categories ?? []);

  if (kind === 'ask' || ASKING_SOURCES.has(source)) {
    const g: Partial<Record<CategoryId, Grant>> = {};
    grantAll(g, cats, 'act', 'asking');
    return assess('asking', 'other-trades', g, { publicPost: PUBLIC_POST_SOURCES.has(source) });
  }
  if (source === 'sam-gov') {
    // Notice type from data.type, or the first summary field ("Solicitation | INTERIOR, ... | NAICS 236220 | responses due ...").
    const type = norm(dataObj(sig).type) || norm(String(sig.summary ?? '').split('|')[0]);
    const g: Partial<Record<CategoryId, Grant>> = {};
    if (NOT_YET_BID_RE.test(type)) grantAll(g, cats, 'soon', 'bid-notice');
    else grantAll(g, cats, 'act', 'open-bid');
    return assess('federal-bid', 'other-trades', g);
  }
  if (kind === 'contract') {
    const g: Partial<Record<CategoryId, Grant>> = {};
    grantAll(g, cats, 'intel', 'contract-award');
    return assess('federal-award', 'other-trades', g, {}, source === 'usaspending');
  }
  if (subtype === 'permit' || kind === 'permit') return permitRule(sig);
  if (subtype === 'violation') return violationRule(sig);
  if (subtype === '311') return threeOneOneRule(sig);
  if (subtype === 'inspection') return inspectionRule(sig);
  if (subtype === 'business') return businessRule();
  if (subtype === 'event-permit') return eventPermitRule();
  if (kind === 'alert') return weatherRule(sig);
  if (kind === 'report') return stormReportRule(sig);
  if (kind === 'disaster') return disasterRule();
  if (kind === 'quake') return quakeRule(sig);
  if (kind === 'travel') return travelRule();
  if (kind === 'event') return eventRule();
  return assess('unknown', 'unknown', {}, {}, false);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Copy

interface CopyCtx {
  /** Trade label from categories.ts, or "your trade". */
  trade: string;
  label: Opportunity;
  detail: OpportunityAssessment['detail'];
}

type Copy = { why: string; next: string; uncertain: string };

function article(word: string): string {
  return /^(?:[aeiou]|hvac\b|fema\b)/i.test(word.trim()) ? 'an' : 'a';
}

function kindsText(kinds: string[] | undefined): string {
  const ks = (kinds ?? []).map((k) => (/^[A-Z]{2,}\b/.test(k) ? k : k.toLowerCase()));
  if (!ks.length) return '';
  if (ks.length === 1) return ks[0];
  return `${ks.slice(0, -1).join(', ')} and ${ks[ks.length - 1]}`;
}

const NO_ACTION = 'No action needed.';

const COPY: Record<OpportunityReason, (c: CopyCtx) => Copy> = {
  asking: (c) =>
    c.detail.publicPost
      ? {
          why: `A public post asked for help that fits ${c.trade}.`,
          next: 'Reply soon with what you offer and when you are free.',
          uncertain: 'Holler has not checked who wrote the post or whether the job is still open.',
        }
      : {
          why: `A resident asked for help that fits ${c.trade}.`,
          next: 'Reply soon with what you offer and when you are free.',
          uncertain: 'The size of the job and the budget are not on the record.',
        },
  'open-bid': (c) => ({
    why: `A federal agency put work that fits ${c.trade} out for bid.`,
    next: 'Read the notice on SAM.gov and note the response date.',
    uncertain: 'No contract has been awarded, and bidding may need an active SAM.gov registration.',
  }),
  'bid-notice': (c) => ({
    why: `A federal agency posted a notice about work that fits ${c.trade} before it asks for bids.`,
    next: 'Read the notice and answer it if it asks for interested companies.',
    uncertain: 'This is not an open bid yet, and the agency may not go ahead.',
  }),
  'contract-award': (c) => ({
    why: `A federal contract for work that fits ${c.trade} was awarded here.`,
    next: 'Note the agency and the company that won; it may hire local help.',
    uncertain: 'The contract already has a winner, and no subcontract work is on the record.',
  }),
  'permit-own-trade': (c) => {
    const k = kindsText(c.detail.kinds);
    return {
      why: k
        ? `The city issued ${article(k)} ${k} permit here, which is work ${c.trade} does, so another company likely has this job.`
        : `The city issued a permit here for work that fits ${c.trade}, so another company likely has this job.`,
      next: 'Use it to see where your trade is busy in your area.',
      uncertain: 'Who pulled the permit and the job details are not shown here.',
    };
  },
  'permit-downstream': (c) => {
    const k = kindsText(c.detail.kinds);
    return {
      why: `The city issued ${k ? `${article(k)} ${k}` : 'a'} permit here, and work for ${c.trade} often follows a job like this.`,
      next: 'Keep the address and check back once the main work is done.',
      uncertain: 'The owner may already have hired someone, or may not need this work.',
    };
  },
  'violation-repair': (c) => ({
    why: `The city cited this property, and the notice names a repair that fits ${c.trade}.`,
    next: 'Look up the property owner and offer the repair.',
    uncertain: 'The owner may already have hired someone, and the deadline to fix it is not shown here.',
  }),
  'violation-general': (c) => ({
    why: `The city cited this property, but the notice does not name the repair, so work for ${c.trade} is possible.`,
    next: 'Look up the owner and ask what the city asked them to fix.',
    uncertain: 'The repair needed is not on the record, and the owner may already have hired someone.',
  }),
  'violation-abatement': (c) => ({
    why: `The city opened a property abatement case here, and cleanup of this kind fits ${c.trade}.`,
    next: 'Look up the owner and offer the cleanup.',
    uncertain: 'The city may do the work itself, and the exact problem is not on the record.',
  }),
  'heat-complaint': (c) => ({
    why: c.detail.residential === false
      ? 'Someone reported no heat in this building through 311, and the owner has to get it working.'
      : 'Someone reported a heat or hot water outage in this building through 311, and landlords must restore heat and hot water.',
    next: "Contact the building's owner or managing agent today.",
    uncertain: "The building's own staff or contractor may already be fixing it.",
  }),
  'sewage-backup': () => ({
    why: 'A sewage back-up was reported here through 311, which can mean drain work and cleanup.',
    next: 'Look up the property and offer help to the owner.',
    uncertain: 'The report does not say whether a building was affected, and the city may handle it if its sewer is at fault.',
  }),
  'private-graffiti': () => ({
    why: 'Graffiti on private property was reported here, and owners are usually told to remove it.',
    next: 'Offer the owner removal or repainting.',
    uncertain: 'The owner may clean it up without help.',
  }),
  'building-complaint': (c) => ({
    why: `A resident reported a problem inside a private building that fits ${c.trade}.`,
    next: "Find the building's owner or manager and offer an inspection.",
    uncertain: 'An inspector has not confirmed the problem.',
  }),
  'private-property-complaint': (c) => ({
    why: `Someone reported a problem on private property that fits ${c.trade}.`,
    next: 'Look up the owner and offer to take care of it.',
    uncertain: 'The problem has not been confirmed, and the owner may handle it alone.',
  }),
  'failed-inspection': () => ({
    why: 'A food business here failed a health inspection and will need to pass a follow-up visit.',
    next: 'Contact the business and offer a visit before the follow-up.',
    uncertain: 'The violations are not listed here, and the business may already have a provider.',
  }),
  'new-business': (c) => ({
    why: `A new business license was issued here, and new businesses often set up services that fit ${c.trade}.`,
    next: 'Introduce yourself while the business is getting set up.',
    uncertain: 'What the business does day to day and when it opens are not on the record.',
  }),
  'storm-warning': (c) => {
    const e = c.detail.event || 'weather warning';
    return {
      why: `The weather service issued ${article(e)} ${e} for this area, and storms like this often bring work for ${c.trade}.`,
      next: 'Get ready for calls and check damage reports once it passes.',
      uncertain: 'Damage to homes is not confirmed.',
    };
  },
  'weather-watch': (c) => {
    const e = c.detail.event || 'weather notice';
    return {
      why: `${article(e) === 'an' ? 'An' : 'A'} ${e} is in effect here, which is worth knowing for ${c.trade}.`,
      next: 'Watch for warnings or damage reports before acting.',
      uncertain: 'Damage to homes is not confirmed, and conditions may not reach this area.',
    };
  },
  'cold-weather': (c) => {
    const e = c.detail.event || 'cold weather notice';
    return {
      why: `${article(e) === 'an' ? 'An' : 'A'} ${e} is in effect here, and hard cold can freeze pipes and strain heating.`,
      next: 'Keep time free for frozen pipe and no heat calls.',
      uncertain: 'No frozen pipes or heating failures have been reported.',
    };
  },
  'storm-damage-report': (c) => ({
    why:
      c.label === 'act'
        ? 'Wind damage was reported near here, and reports like this usually involve trees or limbs down.'
        : `Wind damage was reported near here, and nearby properties may need ${c.trade}.`,
    next: 'Check the area and offer help to owners on affected streets.',
    uncertain: 'The report does not say which properties were hit, and damage to homes is not confirmed.',
  }),
  'hail-report': (c) => ({
    why:
      c.label === 'act'
        ? 'Hail one inch or larger was reported near here, a size that can damage roofs, siding and cars.'
        : 'Hail was reported near here.',
    next: 'Check the area and offer inspections to owners nearby.',
    uncertain: 'Damage to homes and cars is not confirmed.',
  }),
  'tornado-report': () => ({
    why: 'A tornado was reported near here.',
    next: 'Check the area and offer help to owners on affected streets.',
    uncertain: 'The path and damage to homes are not confirmed.',
  }),
  'wind-gust-report': (c) => ({
    why: `A strong wind gust was measured near here, which is worth knowing for ${c.trade}.`,
    next: 'Watch for reports of trees or limbs down nearby.',
    uncertain: 'No damage was reported with this reading.',
  }),
  'disaster-declaration': (c) => ({
    why: `FEMA declared a disaster that covers this area, and recovery work that fits ${c.trade} often follows.`,
    next: 'Check which counties are covered and whether aid is open to homeowners.',
    uncertain: 'How many homes were damaged is not on the record.',
  }),
  'strong-quake': () => ({
    why: 'A strong earthquake was recorded near here.',
    next: 'Check local news for damage before reaching out.',
    uncertain: 'Damage to buildings is not confirmed.',
  }),
  'event-permit': (c) => ({
    why: `The city permitted an event here, and organizers of events often hire help that fits ${c.trade}.`,
    next: 'Look up the organizer and offer your service before the date.',
    uncertain: 'The organizer may already have vendors, and the event size is not on the record.',
  }),
  'big-event': () => ({
    why: 'A ticketed event is scheduled here, which brings crowds in and out.',
    next: 'Plan to be nearby before and after the event.',
    uncertain: 'Crowd size on the day is not on the record.',
  }),
  'airport-delay': () => ({
    why: 'Flights at this airport are delayed or stopped, so arrivals may bunch up later.',
    next: 'Plan to be near the airport when flights resume.',
    uncertain: 'When the delays clear is not certain.',
  }),
  'public-works': () => ({
    why: 'This is a request for city work on public property, so no private customer is named.',
    next: NO_ACTION,
    uncertain: 'Whether a private owner is involved is not on the record.',
  }),
  'public-graffiti': () => ({
    why: 'This graffiti report does not say it is on private property, so the city usually handles it.',
    next: NO_ACTION,
    uncertain: 'The type of property is not on the record.',
  }),
  'city-request': () => ({
    why: 'This 311 request is for a city service, and no private customer is named.',
    next: NO_ACTION,
    uncertain: 'Whether a private owner is involved is not on the record.',
  }),
  'inspection-other': () => ({
    why: 'This inspection record does not show a failure that calls for outside help.',
    next: NO_ACTION,
    uncertain: 'The full inspection report is not shown here.',
  }),
  'minor-weather': (c) => ({
    why: `This weather notice rarely brings work for ${c.trade}.`,
    next: NO_ACTION,
    uncertain: 'Local conditions may differ from the notice.',
  }),
  'minor-quake': () => ({
    why: 'This earthquake was too small to expect damage.',
    next: NO_ACTION,
    uncertain: 'Local effects are not on the record.',
  }),
  'other-trades': (c) => ({
    why: `This record points to other trades, not ${c.trade}.`,
    next: NO_ACTION,
    uncertain: 'The full record may hold details not shown here.',
  }),
  unknown: () => ({
    why: 'Holler does not have a rule for this kind of record yet.',
    next: NO_ACTION,
    uncertain: 'What this record means for your trade is not known.',
  }),
};

function tradeName(trade: string): string {
  return categoryById(trade)?.label ?? (trade ? trade : 'your trade');
}

/** The copy for a reason (exported for tests that check every reason). */
export function opportunityCopy(
  reason: OpportunityReason,
  trade: string,
  label: Opportunity,
  detail: OpportunityAssessment['detail'] = {},
): Copy {
  return COPY[reason]({ trade: tradeName(trade), label, detail });
}

function briefFrom(a: OpportunityAssessment, trade: string): OpportunityBrief {
  const g = a.grants[trade as CategoryId];
  const label: Opportunity = g ? g.label : 'context';
  const reason: OpportunityReason = g ? g.reason : a.fallback;
  return { label, reason, ...opportunityCopy(reason, trade, label, a.detail) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Public API

export function opportunityFor(sig: OpportunityInput, trade: string): OpportunityBrief {
  return briefFrom(assessOpportunity(sig), trade);
}

/** Every trade that gets a label other than 'context' for this record, with its label (downstream trades included). */
export function opportunityTrades(sig: OpportunityInput): Partial<Record<string, Opportunity>> {
  const out: Partial<Record<string, Opportunity>> = {};
  const a = assessOpportunity(sig);
  for (const [t, g] of Object.entries(a.grants)) if (g && g.label !== 'context') out[t] = g.label;
  return out;
}

/** Best label across a member's trades (highest rank; ties go to the first trade in the given order). */
export function bestOpportunity(sig: OpportunityInput, trades: string[]): { trade: string | null; brief: OpportunityBrief } {
  const a = assessOpportunity(sig);
  let best: { trade: string; brief: OpportunityBrief } | null = null;
  for (const t of trades) {
    const b = briefFrom(a, t);
    if (b.label === 'context') continue;
    if (!best || OPPORTUNITY_RANK[b.label] > OPPORTUNITY_RANK[best.brief.label]) best = { trade: t, brief: b };
  }
  if (best) return best;
  return { trade: null, brief: briefFrom(a, trades[0] ?? '') };
}
