import type { CategoryId } from '@/lib/signals/categories';
import { NEW_HOME_RE } from '@/lib/signals/adapters/socrata-datasets';

/**
 * ONE classification for a building permit: the trades it is tagged with AND the work label its public title uses come from the same
 * list of matched work kinds, so a title can never name one trade while the row carries another ("HVAC permit" with plumbing).
 *
 * Inputs are the record's field values, split in two:
 *  - structured: the dataset's own type, class, category or use columns (short values from the portal's vocabulary)
 *  - free: description columns typed by applicants. They may PICK work kinds but are never printed: the title is built only from the
 *    fixed labels below (round 5 rule: public text comes from fixed vocabulary).
 *
 * Precedence (simple on purpose):
 *  1. An admin-only structured value (owner change, renewal, extension, void) means no work: no categories, the row is dropped.
 *  2. Specific kinds from the structured fields decide alone ("Residential Air Conditioning" is HVAC whatever the description says),
 *     except that a description of a new house turns a structured "New construction" into "New home".
 *  3. Otherwise specific kinds from the free text, plus the first generic kind in the free text ("Plumbing and remodel permit").
 *  4. Otherwise the first generic kind (a plain "Building permit" is general-contractor ONLY, never landscaping or cleaning).
 * A kind whose trades are already covered by an earlier kind is skipped, and the title names at most 4 kinds and at most
 * MAX_TITLE_CHARS; kinds that do not fit are dropped together with their trades, so title and categories always agree.
 */

export interface PermitKind {
  id: string;
  /** Fixed title word(s): "<label> permit in <city>". */
  label: string;
  cats: CategoryId[];
  /** Generic kinds name no particular trade (building, remodel, addition): they map to general-contractor only. */
  generic?: boolean;
  /**
   * Tags its trades but is left out of the title (round 18 review P2-4): the interior demolition inside an alteration. The permit is titled
   * by its other kinds ("Remodel permit"); its hauling trade (junk-removal) still sees the card.
   */
  tagOnly?: boolean;
  /** Tested against each field value on its own. */
  test: (value: string) => boolean;
}

const re = (r: RegExp) => (v: string) => r.test(v);

/**
 * Text as the kind tests read it: hyphens and dashes become spaces and runs of white space collapse to one ("Water-heater" and
 * "WATER  HEATER" read "water heater"). Every pattern below is written for this form.
 */
export function normalizeWorkText(v: string): string {
  return String(v ?? '')
    .replace(/[‐-―−-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Values that record paperwork, not work. A record with one of these in a structured field gets no trade. */
export const ADMIN_ONLY_RE =
  /\bowner(?:ship)?\s+change\b|\bchange\s+of\s+(?:owner|contractor|address)|\bcontractor\s+change\b|\bname\s+change\b|\brenewal\b|\bextension\s+of\s+(?:time|permit)|\bpermit\s+extension\b|\bvoid(?:ed)?\b|\bwithdrawn\b|\bre\s?issue\b|\bduplicate\s+permit\b|^\s*zoning\b|\bvariance\b/i;

/**
 * Work types that are paperwork or temporary protection, not trade work: a sidewalk shed or scaffold, a construction fence, a site-safety
 * plan ("Protection and Mechanical Methods"), a fire sprinkler or standpipe job, a curb cut. When a STRUCTURED type column holds one of
 * them the row gets no trade and is dropped (as an admin-only value is), because the description then names the building's other work,
 * not this permit's (round 15 quality gate: a sidewalk shed read "Roof and window", a fire-sprinkler job at a bank read "Landscaping").
 */
export const NO_TRADE_WORK_TYPES = ['sidewalk shed', 'supported scaffold', 'construction fence', 'protection and mechanical methods', 'sprinkler', 'standpipe', 'curb cut'] as const;
// Round 19 RULES (review line 64): a fire-protection type written as a pair or a system ("Sprinkler and Standpipe", Cambridge row 3174; "Fire
// Sprinkler System") is the same no-trade work; before, only a bare "Sprinkler(s)" or "Standpipe" matched and row 3174 stayed "Landscaping".
// A bare "Sprinkler System" is not (review P3 item 16): it may be a lawn system, so it is mapped from its words like any other type.
export const NO_TRADE_WORK_TYPE_RE =
  /^(?:sidewalk shed|supported scaffold|construction fence|protection and mechanical methods|sprinklers?|fire\s+sprinklers?(?:\s+systems?)?|(?:fire\s+)?sprinklers?\s+and\s+standpipes?|(?:fire\s+)?standpipes?(?:\s+systems?)?|curb cut)$/i;

/** Street suffixes and business words: a trade noun right before one of these names a street or a company, not work. */
const NOT_WORK_AHEAD =
  '(?!\\s+(?:st|street|dr|drive|rd|road|ln|lane|ave|avenue|blvd|boulevard|ct|court|cir|circle|pkwy|parkway|trl|trail|ter|terrace|hwy|highway|pl|place|way|row|pike|xing|crossing|bend|cove|point|valley|hill|hills|park|village|lake|creek|supply|supplies|co|company|inc|llc|corp|corporation|store|depot|outlet|center|centre|wholesale|distributors?|group|church)\\b)';
const nw = (src: string) => new RegExp(`(?:${src})${NOT_WORK_AHEAD}`, 'i');

/**
 * A street address that starts with a house number ("456 Pine Tree Dr NE", "12 Solar Dr"): never work vocabulary. The words between
 * the number and the suffix may not be little words, so "remove 3 trees along the road" is not read as an address.
 */
const STREET_ADDRESS_RE =
  /\b\d+[a-z]?\s+(?:[nsew]\s+)?(?:(?!(?:the|a|an|along|near|on|by|to|from|and|of|in|at|with|for|behind|beside)\s)[a-z'.]+\s+){1,3}(?:st|street|dr|drive|rd|road|ln|lane|ave|avenue|blvd|boulevard|ct|court|cir|circle|pkwy|parkway|trl|trail|ter|terrace|hwy|highway|pl|place|way|row)\b\.?(?:\s+(?:ne|nw|se|sw|n|s|e|w)\b)?/gi;

/**
 * A water heater in any common wording, with the words that only describe the heater ("50 gal", "electric", "gas", "heat pump",
 * "hybrid", "tankless", "hot"). Once a water heater is matched this whole phrase is removed before the other kinds are tested, so
 * "electric water heater" is not electrical and "heat pump water heater" is not HVAC.
 */
const WATER_HEATER_PHRASE_RE =
  /\b(?:(?:\d+(?:\.\d+)?\s*(?:gal(?:lon)?s?\.?)?|electric(?:al)?|gas|natural gas|propane|lp|heat pump|hybrid|tankless|hot|new|power vent(?:ed)?|direct vent)\s+)*(?:water\s?heaters?|hot\s?water\s?(?:heaters?|tanks?))\b(?:\s*,?\s*\(?(?:electric(?:al)?|gas|natural gas|propane|heat pump|hybrid|tankless)\)?)?|\btankless(?:\s+(?:water\s+)?heaters?)?\b/gi;
const WATER_HEATER_TEST = /\bwater\s?heaters?\b|\btankless\b|\bhot\s?water\s?(?:heater|tank)s?\b/i;

/** "on the existing roof", "to roof": the roof is where something else goes (solar panels on the roof), not roof work. */
const ROOF_AS_PLACE_RE = /\b(?:on|onto|to|through|thru|above|over|from)\s+(?:the\s+|an?\s+|existing\s+|flat\s+|main\s+|house\s+|garage\s+|building\s+|low\s+slope\s+)*roofs?\b/gi;
const ROOF_RE = new RegExp(
  `\\bre\\s?roof\\w*|\\broof(?:s|ing|er)?\\b(?!\\s*(?:mount|top|deck|drain))${NOT_WORK_AHEAD}|\\bshingles?\\b|\\btear\\s?off\\b`,
  'i',
);

const HVAC_RE =
  /\bhvac\b|\bmechanical\b(?!\s*methods)|\bfurnaces?\b|\bair\s?condition\w*|\ba\/c\b|\bheat\s?pumps?\b|\bductwork\b|\bducts?\b|\bboilers?\b|\bheating\b|(?<!water\s)(?<!water)\bheaters?\b|\bmini\s?splits?\b|\bcondens(?:er|ing\s+unit)s?\b|\brooftop\s+units?\b|\broof\s+top\s+units?\b|\brtus?\b/i;

/** Priority order: the title lists kinds in this order, and the last ones are dropped first when the title is too long. */
export const PERMIT_KINDS: PermitKind[] = [
  { id: 'new-home', label: 'New home', cats: ['general-contractor', 'real-estate', 'moving'], test: re(NEW_HOME_RE) },
  {
    id: 'new-construction',
    label: 'New construction',
    cats: ['general-contractor'],
    test: (v) => /^\s*new\s*$/i.test(v) || /\bnew\s+(?:construction|building|structure|commercial|multi\s?family|single\s?family|residential|dwelling|home|house)\b|\bnew\s+bldg\b|\bnew\s+res\b/i.test(v),
  },
  {
    id: 'roof',
    label: 'Roof',
    cats: ['roofing'],
    // "roof mounted solar", "rooftop unit", "roof top unit", "roof deck", "roof drain" and "panels on the roof" are not roof work.
    test: (v) => ROOF_RE.test(v.replace(ROOF_AS_PLACE_RE, ' ')),
  },
  { id: 'solar', label: 'Solar', cats: ['solar'], test: re(nw('\\bsolar\\b|photovoltaic|\\bpv\\b')) },
  {
    id: 'pool',
    label: 'Pool',
    cats: ['pool-spa'],
    // A nail, day or med spa is a shop, not a spa build.
    test: re(nw('\\b(?:swimming\\s+)?pools?\\b|(?<!(?:nail|day|med|medical|beauty|massage|hair|salon|skin|foot|facial|wellness|brow|lash)\\s)\\bspas?\\b|\\bhot\\s?tubs?\\b')),
  },
  { id: 'water-heater', label: 'Water heater', cats: ['plumbing'], test: re(WATER_HEATER_TEST) },
  {
    id: 'hvac',
    label: 'HVAC',
    cats: ['hvac'],
    // A water heater is plumbing: its phrase is removed before this test runs (kindsIn).
    test: re(HVAC_RE),
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    cats: ['plumbing'],
    // A condensate drain line belongs to the air conditioner.
    test: re(nw('\\bplumb(?:ing|er|ers)?\\b|\\bsewers?\\b|\\bbackflow\\b|\\bgas\\s?(?:lines?|piping|pipes?|service)\\b|\\bwater\\s?(?:lines?|service|mains?)\\b|\\bre\\s?pip\\w*|\\bseptic\\b|\\bsump\\s?pumps?\\b|(?<!condensate\\s)\\bdrain\\s?lines?\\b')),
  },
  {
    id: 'electrical',
    label: 'Electrical',
    cats: ['electrical'],
    test: re(
      nw('\\belectric\\w*|\\bwiring\\b|\\brewir\\w*|\\bpanel\\s?(?:upgrade|change|replace\\w*)\\b|\\b(?:upgrade|replace|new)\\s+(?:service\\s+)?panel\\b|\\b\\d{2,3}\\s?amps?\\b|\\bservice\\s?(?:upgrade|change)\\b|\\bev\\s?charg\\w*|\\bcar\\s?charg\\w*|\\bgenerators?\\b|\\blow\\s?voltage\\b|\\btemp(?:orary)?\\s?(?:power|pole)\\b'),
    ),
  },
  { id: 'demolition', label: 'Demolition', cats: ['junk-removal'], test: re(nw('\\bdemolition\\b|\\bdemolish\\w*|\\bdemo\\b|\\bwrecking\\b|\\braze\\b')) },
  { id: 'tree', label: 'Tree removal', cats: ['tree-service'], test: re(nw('(?<!dollar\\s)\\btrees?\\b|\\barborist\\b|\\bstumps?\\b')) },
  { id: 'fence', label: 'Fence', cats: ['fencing'], test: re(nw('\\bfenc(?:e|es|ing)\\b|\\bfendrive\\b')) },
  { id: 'retaining-wall', label: 'Retaining wall', cats: ['landscaping'], test: re(/\bretaining\s+walls?\b/i) },
  { id: 'landscape', label: 'Landscaping', cats: ['landscaping'], test: re(nw('\\blandscap\\w*|\\birrigation\\b|\\bhardscap\\w*')) },
  {
    id: 'concrete',
    label: 'Concrete',
    cats: ['concrete-paving'],
    // A "sidewalk shed" is scaffolding over a sidewalk, not concrete work.
    test: re(nw('\\bdriveways?\\b|\\bconcrete\\b|\\bpaving\\b|\\bpavers?\\b|\\bsidewalks?\\b(?!\\s*sheds?)|\\basphalt\\b(?!\\s*shingles?)|\\bflatwork\\b|\\bcurb\\s?cuts?\\b|\\bfendrive\\b')),
  },
  // Two kinds per trade so the title says which: "Window permit", "Door permit". A record with both reads "Window" (same trade).
  { id: 'windows', label: 'Window', cats: ['windows-doors'], test: re(nw('\\bwindows?\\b|\\bstorefronts?\\b')) },
  { id: 'doors', label: 'Door', cats: ['windows-doors'], test: re(nw('\\bdoors?\\b')) },
  { id: 'siding', label: 'Siding', cats: ['siding-gutters'], test: re(nw('\\bsiding\\b|\\bsoffits?\\b|\\bfascia\\b')) },
  { id: 'gutters', label: 'Gutter', cats: ['siding-gutters'], test: re(nw('\\bgutters?\\b|\\bdownspouts?\\b')) },
  {
    id: 'flooring',
    label: 'Flooring',
    cats: ['flooring'],
    test: re(nw('\\bflooring\\b|\\bhardwood\\b|\\bfloor\\s+(?:replacement|installation|covering|refinish\\w*)|\\b(?:replace|install|new)\\s+floors?\\b')),
  },
  { id: 'sign', label: 'Sign', cats: ['signs-printing'], test: re(/\bsigns?\b|\bsignage\b|\bbillboards?\b/i) },
  { id: 'painting', label: 'Painting', cats: ['painting'], test: re(nw('\\bpainting\\b|\\brepaint\\w*')) },
  {
    id: 'damage-repair',
    label: 'Damage repair',
    cats: ['restoration'],
    // "restoration" alone is often a business name ("Restoration Hardware"): only a named kind of damage counts.
    test: re(
      /\bfire\s?(?:damage|repair|restoration)\b|\b(?:water|flood|storm|smoke)\s?damage\b|\b(?:water|flood|storm|smoke|mold)\s+(?:damage\s+)?(?:restoration|remediation)\b|\bmold\b/i,
    ),
  },
  // ---- generic kinds: general-contractor only ----
  // "pool deck" is the pool's surround, not a deck build.
  { id: 'deck', label: 'Deck', cats: ['general-contractor'], generic: true, test: re(/(?<!pool\s)\bdecks?\b|\bpatio\s?covers?\b|\bpergolas?\b|\bgazebos?\b/i) },
  { id: 'porch', label: 'Porch', cats: ['general-contractor'], generic: true, test: re(/\bporch(?:es)?\b/i) },
  { id: 'accessory', label: 'Accessory building', cats: ['general-contractor'], generic: true, test: re(/\baccessory\b|(?<!sidewalk\s)\bsheds?\b|\bdetached\s+garage\b|\bbarns?\b|\bcarports?\b/i) },
  { id: 'addition', label: 'Addition', cats: ['general-contractor'], generic: true, test: re(/\badditions?\b/i) },
  {
    id: 'fit-out',
    label: 'Tenant fit-out',
    cats: ['general-contractor'],
    generic: true,
    test: re(/\btenant\s?(?:fit\s?out|finish|improvement|build\s?out|up\s?fit)s?\b|\bbuild\s?outs?\b|\bfit\s?outs?\b|\bup\s?fits?\b|\bwhite\s?box\b/i),
  },
  // Masonry and dumpster permits are neither a home remodel nor a demolition (round 15 review: a Chicago "Masonry Work" express permit read as
  // Remodel, a Cambridge "Dumpster" permit read as Demolition). They stay general-contractor, generic, and route nowhere.
  { id: 'masonry', label: 'Masonry', cats: ['general-contractor'], generic: true, test: re(/\bmasonry\b|\btuck\s?point\w*|\bbrick\s?work\b/i) },
  { id: 'dumpster', label: 'Dumpster', cats: ['general-contractor'], generic: true, test: re(/\bdumpsters?\b|\broll\s?off\b/i) },
  { id: 'remodel', label: 'Remodel', cats: ['general-contractor'], generic: true, test: re(/\bremodel\w*|\brenovat\w*|\balteration\w*|\balter\b|\brehab\w*/i) },
  // A bare repair is not a remodel (round 15 review: Orlando "Building Permit | Repair" $2,907 read as Remodel). It routes nowhere.
  { id: 'repair', label: 'Repair', cats: ['general-contractor'], generic: true, test: re(/\brepairs?\b/i) },
  { id: 'structural', label: 'Structural', cats: ['general-contractor'], generic: true, test: re(/\bstructural\b|\bfoundations?\b|\bunderpinning\b/i) },
  { id: 'site-work', label: 'Site work', cats: ['general-contractor'], generic: true, test: re(/\bearth\s?work\b|\bgrading\b|\bexcavat\w*|\bsite\s?work\b|\bland\s?disturb\w*/i) },
  { id: 'building', label: 'Building', cats: ['general-contractor'], generic: true, test: re(/\bbuilding\b|\bbldg\b|\bconstruction\b|\bcontractor\b/i) },
];

/**
 * Work phrases for free-text columns documented as a MIX of street address, description and name (the Atlanta `Name` column), commander
 * decision 1 (verify-v1). The rules are deliberately conservative there: a word in such a column names a street, a business or a person
 * as often as work ("PINE TREE DR", "DOLLAR TREE", "POOLE RESIDENCE", "LUXE NAIL SPA", "NEW WINDOW WORLD SHOWROOM", "REPLACE ROOF TOP
 * UNIT"), so only a few anchored whole phrases that name the work itself may pick a specific trade, each with negative guards:
 *  - roofing: "reroof" / "re-roof" / "re roof", "roof replacement", "roof repair", "shingle replacement / repair", and "replace (the)
 *    roof" / "new roof" when not followed by top, mounted, deck, unit, curb, drain, hatch or access;
 *  - tree service: "tree removal", "remove tree(s)";
 *  - pool: "swimming pool", or "pool" directly with install, construct, new, renovation, demolition or fill;
 *  - solar: "solar panel(s)", "solar array", "photovoltaic", "PV system" (a roof-mounted solar array is solar, not roofing).
 * A phrase followed by a business word ("ROOF REPAIR LLC", "POOL HALL", "SOLAR PANEL OUTLET STORE") does not count. Nothing else in such
 * a column picks a trade (no electrical from "service", no flooring from "floor", no new home, no spa, no HVAC from "unit"): the row
 * keeps the structured type column's trades (the general contractor), and the scheduled AI step (lib/ai/classify.ts) refines it. A hit
 * here never removes the general contractor the type column gave (pickKinds). Generic kinds are never taken from such a column.
 */
const BUSINESS_AHEAD =
  '(?!\\s+(?:supply|supplies|co|company|companies|inc|llc|corp|corporation|store|stores|depot|showroom|outlet|center|centre|hall|church|world|office|offices|group|services?|pros|contractors?|wholesale|distributors?|warehouse|tables?|room|bar|lounge)\\b)';
const ROOF_NOT_WORK_AHEAD = '(?!\\s+(?:top|tops|mounted|mount|deck|decks|unit|units|curb|curbs|drain|drains|hatch|hatches|access)\\b)';
const mixedRe = (src: string) => new RegExp(`(?:${src})${BUSINESS_AHEAD}`, 'i');
export const MIXED_FIELD_PHRASES: Partial<Record<string, RegExp>> = {
  roof: mixedRe(
    `\\bre\\s?roof(?:s|ed|ing)?\\b|\\broof\\s+(?:replacement|repairs?)\\b|\\bshingles?\\s+(?:replacement|repairs?)\\b|\\b(?:replace\\s+(?:the\\s+)?|new\\s+)roof\\b${ROOF_NOT_WORK_AHEAD}`,
  ),
  tree: mixedRe('\\btree\\s+removal\\b|\\bremove\\s+(?:the\\s+|a\\s+|\\d+\\s+)?trees?\\b'),
  pool: mixedRe(
    '\\bswimming\\s+pools?\\b|\\bpools?\\s+(?:install(?:ation|ed|ing)?|construct(?:ion|ed|ing)?|renovation|demolition|fill)\\b|\\b(?:install|construct|new|fill)\\s+pools?\\b',
  ),
  solar: mixedRe('\\bsolar\\s+(?:panels?|arrays?)\\b|\\bphotovoltaic\\b|\\bpv\\s+systems?\\b'),
};

export const MAX_TITLE_CHARS = 60;
const MAX_KINDS_IN_TITLE = 4;

export interface PermitFields {
  /** Values of the dataset's type, class, category or use columns. */
  structured: string[];
  /** Values of description columns. Read to pick kinds, never printed. */
  free?: string[];
  /**
   * Values of free-text columns documented as a mix of street address, description and name (the Atlanta `Name` column). Read only
   * for unambiguous work phrases (MIXED_FIELD_PHRASES), never printed, and never a source of a generic kind.
   */
  mixed?: string[];
  /** The dataset id. Only a few sources print a class value that is commercial there and not elsewhere (SOURCE_COMMERCIAL_CLASS_RE). */
  source?: string;
}

export interface PermitClass {
  categories: CategoryId[];
  /** Kind ids, in title order. */
  kinds: string[];
  /** Title label such as "Roof", "HVAC and plumbing" or "Water heater". Null when nothing matched (no categories). */
  label: string | null;
}

/** Column names that hold a type, class, category or use value rather than a description. */
export function isStructuredField(field: string): boolean {
  return /type|class|categor|designation|(?:^|_)use(?:_|$)|landuse/i.test(field);
}

/**
 * The text a value is tested on: normalized, and with a water heater phrase removed once the water heater kind has matched (so the
 * words that describe the heater never pick electrical or HVAC). Street addresses that start with a house number are removed too.
 */
function workText(v: string): { text: string; waterHeater: boolean } {
  const n = normalizeWorkText(v).replace(STREET_ADDRESS_RE, ' ');
  const waterHeater = WATER_HEATER_TEST.test(n);
  return { text: waterHeater ? normalizeWorkText(n.replace(WATER_HEATER_PHRASE_RE, ' ')) : n, waterHeater };
}

function kindsIn(values: string[]): PermitKind[] {
  const hit = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const { text, waterHeater } = workText(v);
    if (waterHeater) hit.add('water-heater');
    if (!text) continue;
    for (const k of PERMIT_KINDS) if (!hit.has(k.id) && k.id !== 'water-heater' && k.test(text)) hit.add(k.id);
  }
  // A new home is a new construction with more trades: never both.
  if (hit.has('new-home')) hit.delete('new-construction');
  return PERMIT_KINDS.filter((k) => hit.has(k.id));
}

/** Specific kinds named by an unambiguous work phrase in a mixed address, description or name column (MIXED_FIELD_PHRASES). */
function strictKindsIn(values: string[]): PermitKind[] {
  const hit = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    // The house-number address cut only ("12 SOLAR DR"); no water heater phrase is read from a mixed column.
    const text = normalizeWorkText(v).replace(STREET_ADDRESS_RE, ' ');
    for (const [id, r] of Object.entries(MIXED_FIELD_PHRASES)) if (r && !hit.has(id) && r.test(text)) hit.add(id);
  }
  return PERMIT_KINDS.filter((k) => hit.has(k.id) && !k.generic);
}

function lowerLabel(label: string): string {
  return /^[A-Z]{2,}\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** "Roof", "Roof and HVAC", "Roof, HVAC and plumbing". */
export function joinLabels(labels: string[]): string {
  if (labels.length === 0) return '';
  const [first, ...rest] = labels;
  const parts = [first, ...rest.map(lowerLabel)];
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "<label> permit in <city>", or "Permit in <city>" when there is no label. */
export function permitTitleFor(city: string, label: string | null): string {
  const t = label ? `${label} permit in ${city}` : `Permit in ${city}`;
  return t.length <= MAX_TITLE_CHARS ? t : t.slice(0, MAX_TITLE_CHARS);
}

/**
 * Generic words in a description that name general contractor work on their own. "Building" (a noun in most descriptions) and
 * "repair" (as in "repair rotted fascia") do not, so they never join a named trade.
 */
const FREE_JOIN: Record<string, RegExp> = {
  remodel: /\bremodel\w*|\brenovat\w*/i,
  addition: /\badditions?\b/i,
  'fit-out': /\btenant\s?(?:fit\s?out|finish|improvement|build\s?out|up\s?fit)s?\b|\bbuild\s?outs?\b|\bfit\s?outs?\b|\bup\s?fits?\b/i,
  deck: /(?<!pool\s)\bdecks?\b|\bpatio\s?covers?\b|\bpergolas?\b|\bgazebos?\b/i,
  porch: /\bporch(?:es)?\b/i,
};

const HVAC_KIND = () => PERMIT_KINDS.find((k) => k.id === 'hvac')!;
const NEW_CONSTRUCTION_KIND = () => PERMIT_KINDS.find((k) => k.id === 'new-construction')!;
/** A structured value that is only the word "New" (a work class, not a kind of building). */
const BARE_NEW_RE = /^\s*new\s*$/i;

/**
 * A structured use, class or type that says the building is commercial, not a home: "Commercial", "Commercial Alteration", "(C) Commercial",
 * "Business", "Office", "Mercantile", "Industrial", "Retail", "Warehouse". Exact values only (a column such as "Commercial Kitchen Hood" is
 * not a use), so a residential permit is never reclassified by a stray word.
 */
export const COMMERCIAL_USE_RE =
  /^(?:\(c\)\s*)?(?:commercial(?:\s+(?:alteration|addition|interior|remodel|renovation|building|bldg))?|business|office|mercantile|industrial|retail|warehouse)$/i;

/**
 * A commercial alteration or addition is a tenant fit-out, not a home remodel (round 15 re-grade #42, #43: Atlanta "Commercial Alteration"
 * and LA "Bldg-Alter/Repair | Commercial" sent a house cleaner an office job). Fit-out routes to commercial cleaning, signs, security and
 * pest control, never to house cleaning. Only the generic remodel and addition kinds are replaced; a named trade stays as it is.
 */
/**
 * Round 28 review D5: a class value that is commercial on one source only. Raleigh's permitclassmapped is "Residential" or "Non-Residential"
 * (13,225 BLDNR rows, none with another class), so there "Non-Residential" reads like Austin's "Commercial": a non-residential alteration
 * (BLDNR-042817-2026, an office) is a tenant fit-out. Other sources are read as before: the bare word is not in COMMERCIAL_USE_RE.
 */
const SOURCE_COMMERCIAL_CLASS_RE: Readonly<Record<string, RegExp>> = {
  'arcgis-raleigh-permits': /^non[\s-]?residential$/i,
};

function commercialFitOut(kinds: PermitKind[], structured: string[], source?: string): PermitKind[] {
  const sourceRe = source ? SOURCE_COMMERCIAL_CLASS_RE[source] : undefined;
  if (!structured.some((v) => COMMERCIAL_USE_RE.test(v) || (sourceRe?.test(v) ?? false))) return kinds;
  if (!kinds.some((k) => k.id === 'remodel' || k.id === 'addition')) return kinds;
  const fit = PERMIT_KINDS.find((k) => k.id === 'fit-out')!;
  const out = kinds.filter((k) => k.id !== 'remodel' && k.id !== 'addition');
  return out.some((k) => k.id === 'fit-out') ? out : [...out, fit];
}

/** Picks the kinds by the precedence above, before the title-length cut. */
function pickKinds(f: PermitFields): PermitKind[] {
  const structured = (f.structured ?? []).map((v) => normalizeWorkText(String(v ?? ''))).filter(Boolean);
  return commercialFitOut(pickKindsRaw(f), structured, f.source);
}

function pickKindsRaw(f: PermitFields): PermitKind[] {
  const clean = (vs: string[] | undefined) => (vs ?? []).map((v) => normalizeWorkText(String(v ?? ''))).filter(Boolean);
  const structured = clean(f.structured);
  const free = clean(f.free);
  const mixed = clean(f.mixed);
  if (structured.some((v) => ADMIN_ONLY_RE.test(v) || NO_TRADE_WORK_TYPE_RE.test(v))) return [];
  const s = kindsIn(structured);
  // Description kinds, plus the unambiguous work phrases of a mixed column (never a generic kind from it).
  const fr = [...kindsIn(free)];
  const fromMixed = strictKindsIn(mixed);
  for (const k of fromMixed) if (!fr.some((x) => x.id === k.id)) fr.push(k);
  fr.sort((a, b) => PERMIT_KINDS.indexOf(a) - PERMIT_KINDS.indexOf(b));
  let sSpecific = s.filter((k) => !k.generic);
  // A bare "New" work class next to a named trade's permit type ("Mechanical | New", "Electrical | New", "Driveway / Sidewalks | New") is a
  // new installation of that trade, not a new building (round 18 ROUTES, item 5: four real rows titled "New construction and HVAC /
  // electrical / concrete permit", tests/signals/routes-mislabels.test.ts). Unless the description says a new house is being built, the
  // bare "New" is dropped and the title names the trade alone. A structured "New Construction", "New Building" or a bare "New" with
  // nothing else beside it keeps New construction.
  if (
    sSpecific.length > 1 &&
    sSpecific.some((k) => k.id === 'new-construction') &&
    !structured.some((v) => !BARE_NEW_RE.test(v) && NEW_CONSTRUCTION_KIND().test(v)) &&
    !fr.some((k) => k.id === 'new-home') &&
    // A combined type that names a building ("Building, Electrical, Mechanical, Plumbing | New") is a new building (review P3-9).
    !s.some((k) => k.id === 'building')
  ) {
    sSpecific = sSpecific.filter((k) => k.id !== 'new-construction');
  }
  if (sSpecific.length) {
    // A structured "New" or "New Construction" plus a description of a new house is a new home (the description refines it).
    const newHome = PERMIT_KINDS.find((k) => k.id === 'new-home')!;
    if (sSpecific.some((k) => k.id === 'new-construction') && fr.some((k) => k.id === 'new-home')) {
      return [newHome, ...sSpecific.filter((k) => k.id !== 'new-construction')];
    }
    // A catch-all "Mechanical" type over a water heater description is a water heater (plumbing), not HVAC work.
    if (
      sSpecific.length === 1 &&
      sSpecific[0].id === 'hvac' &&
      fr.some((k) => k.id === 'water-heater') &&
      !fr.some((k) => k.id === 'hvac') &&
      !structured.some((v) => HVAC_KIND().test(v.replace(/\bmechanical\b/gi, ' ')))
    ) {
      return fr.filter((k) => !k.generic);
    }
    return sSpecific;
  }
  let fSpecific = fr.filter((k) => !k.generic);
  // An addition to or alteration of an existing building is not a new building, and an accessory structure is not a new home (round 15
  // re-grade #32: a $15,000 "Bldg-Addition" read "New home" from its description; review: a NOLA "Accessory Structure" read "New home").
  if (s.some((k) => k.id === 'addition' || k.id === 'remodel' || k.id === 'accessory')) {
    fSpecific = fSpecific.filter((k) => k.id !== 'new-home' && k.id !== 'new-construction');
  }
  // A structured "Dumpster" permit is a container, not a demolition, whatever the description says about the debris.
  if (s.some((k) => k.id === 'dumpster')) fSpecific = fSpecific.filter((k) => k.id !== 'demolition');
  // An alteration permit whose DESCRIPTION mentions demolition is interior demolition inside the alteration, not a demolition permit (round
  // 18 ROUTES, item 5: three real rows, two San Francisco "otc alterations permit" and one Cincinnati "Alter Commercial", were titled
  // "Demolition permit"). The demolition kind is dropped; the alteration stays a remodel (or a fit-out when commercial). A structured
  // demolition type ("Bldg-Demolition", "Commercial Demolition") is untouched.
  // The demolition stays as a TAG (junk-removal still gets the card: the debris needs hauling) but is left out of the title.
  let interiorDemo = false;
  if (s.some((k) => k.id === 'remodel') && !s.some((k) => k.id === 'demolition') && fSpecific.some((k) => k.id === 'demolition')) {
    fSpecific = fSpecific.filter((k) => k.id !== 'demolition');
    interiorDemo = true;
  }
  if (interiorDemo) {
    const rest = pickRest(s, fr, free, fromMixed, fSpecific);
    return [...rest, INTERIOR_DEMOLITION];
  }
  return pickRest(s, fr, free, fromMixed, fSpecific);
}

/** The last step of pickKindsRaw: description trades with the generic kind that joins them, or the first generic kind. */
function pickRest(s: PermitKind[], fr: PermitKind[], free: string[], fromMixed: PermitKind[], fSpecific: PermitKind[]): PermitKind[] {
  // With named trades in the description, only a generic word in the description itself joins them ("remodel kitchen, new plumbing"):
  // a city's catch-all type ("Renovation/Alteration", "Building Permit") over a re-roof is not a general contractor lead.
  if (fSpecific.length) {
    const freeGeneric = fr.find((k) => k.generic && FREE_JOIN[k.id] && free.some((v) => FREE_JOIN[k.id].test(v)));
    if (freeGeneric) return [...fSpecific, freeGeneric];
    // A trade read from a mixed address / description / name column never takes away the general contractor the type column gave
    // (commander decision 1): the row stays a general contractor lead and the AI step refines it.
    const structuredGeneric = fromMixed.length ? s.find((k) => k.generic) : undefined;
    return structuredGeneric ? [...fSpecific, structuredGeneric] : fSpecific;
  }
  const generic = [...s, ...fr].find((k) => k.generic);
  return generic ? [generic] : [];
}

/** Interior demolition inside an alteration: tags junk-removal, never named in the title (PermitKind.tagOnly). */
const INTERIOR_DEMOLITION: PermitKind = { id: 'interior-demolition', label: '', cats: ['junk-removal'], tagOnly: true, test: () => false };

/** De-duplicates by trade, fits the title (at most 4 kinds and MAX_TITLE_CHARS, lowest priority dropped first with its trades). */
function finish(ordered: PermitKind[], city: string): PermitClass {
  // Skip a kind whose trades an earlier kind already covers (Water heater then Plumbing reads "Water heater").
  const chosen: PermitKind[] = [];
  const covered = new Set<CategoryId>();
  for (const k of ordered) {
    if (k.cats.every((c) => covered.has(c))) continue;
    chosen.push(k);
    k.cats.forEach((c) => covered.add(c));
  }
  // A tag-only kind is never in the title; it keeps its trades only while the title names something.
  const tags = chosen.filter((k) => k.tagOnly);
  const titled = chosen.filter((k) => !k.tagOnly);
  let n = Math.min(titled.length, MAX_KINDS_IN_TITLE);
  while (n > 1 && `${joinLabels(titled.slice(0, n).map((k) => k.label))} permit in ${city}`.length > MAX_TITLE_CHARS) n--;
  const used = titled.slice(0, n);
  const categories: CategoryId[] = [];
  for (const k of [...used, ...(used.length ? tags : [])]) for (const c of k.cats) if (!categories.includes(c)) categories.push(c);
  return { categories, kinds: used.map((k) => k.id), label: used.length ? joinLabels(used.map((k) => k.label)) : null };
}

/**
 * Classify one permit. `city` is only used to check that the title fits; pass the dataset's city.
 * Pure and deterministic; never throws.
 */
export function classifyPermit(f: PermitFields, city = ''): PermitClass {
  let kinds: PermitKind[] = [];
  try {
    kinds = pickKinds(f);
  } catch {
    kinds = [];
  }
  return finish(kinds, city);
}

/** Every trade a permit can be tagged with (for lib/signals/capabilities.ts through PERMIT_RULES; a test keeps them equal). */
export const PERMIT_TRADES: CategoryId[] = [...new Set(PERMIT_KINDS.flatMap((k) => k.cats))];

/** Trade to the kind used when a stored row has only its old categories to go on (lib/signals/mapping/remap.ts). */
export const KIND_FOR_CATEGORY: Partial<Record<CategoryId, string>> = {
  roofing: 'roof',
  solar: 'solar',
  'pool-spa': 'pool',
  hvac: 'hvac',
  plumbing: 'plumbing',
  electrical: 'electrical',
  'junk-removal': 'demolition',
  'tree-service': 'tree',
  fencing: 'fence',
  landscaping: 'landscape',
  'concrete-paving': 'concrete',
  'windows-doors': 'windows',
  'siding-gutters': 'siding',
  flooring: 'flooring',
  'signs-printing': 'sign',
  painting: 'painting',
  restoration: 'damage-repair',
  'general-contractor': 'building',
};

/** Builds a class from known kind ids (same precedence between specific and generic kinds, same de-duplication and title fit). */
export function classFromKinds(ids: string[], city = ''): PermitClass {
  const set = new Set(ids);
  if (set.has('new-home')) set.delete('new-construction');
  const kinds = PERMIT_KINDS.filter((k) => set.has(k.id));
  const specific = kinds.filter((k) => !k.generic);
  const generic = kinds.find((k) => k.generic);
  return finish(specific.length ? (generic ? [...specific, generic] : specific) : generic ? [generic] : [], city);
}
