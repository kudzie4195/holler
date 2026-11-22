import type { CategoryId } from './categories';

/**
 * Record vocabulary shared by the label rules (lib/signals/lead-rules.ts) and the trades a record reaches (lib/signals/permit-routing.ts
 * carriedTrades): what a code-violation order names, what a weather alert's event is, how big a hail report is, whether a 311 request is a
 * sewage back-up. Written from the 21,366 live rows of Nov 8 to Dec 6 2026 (round 19 RULES; the review of ENGINE-compare.md section 5 is
 * the specification, its line numbers are quoted as "line N").
 *
 * "Carry" means a trade the record is NOT tagged with still sees it (the audit's word): a sewage back-up reaches restoration, an order to
 * repair a porch reaches the handyman. Carried trades are added after the record's own tags, exactly like the trades downstream of a permit.
 * Every carry here has a label rule in lead-rules.ts; a carried trade with no rule would fall to the source default, and the tests check
 * that none does.
 *
 * Pure and client-safe: no server imports, no clock.
 */

const lower = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** The part of a title after the first ": " ("Code violation in Chicago: REPAIR PORCH SYSTEM" gives "REPAIR PORCH SYSTEM"). */
export function titleBodyOf(title: string | null | undefined): string {
  const t = title ?? '';
  const at = t.indexOf(': ');
  return at >= 0 ? t.slice(at + 2) : t;
}

/** A violation order as the rules read it: the title body, lower case, underscores as spaces, single spaces. */
export function orderText(title: string | null | undefined): string {
  return lower(titleBodyOf(title)).replace(/_/g, ' ').replace(/\s+/g, ' ');
}

// ---- NYC heat (line 3) ----------------------------------------------------------------------------------------------------------

/**
 * The summary part a NYC whole-building heat row carries when it is the building's third complaint in 48 hours (written at ingest by
 * lib/signals/repeat-marks.ts). Fixed words, a count of public complaints; translated in summary-i18n.ts.
 */
export const HEAT_MARK = '3+ heat complaints at this building in 48 hours';

/** The summary carries the heat mark as one of its " | " parts. */
export function hasHeatMark(summary: string | null | undefined): boolean {
  return typeof summary === 'string' && summary.split(' | ').some((p) => p.trim() === HEAT_MARK);
}

export function withHeatMark(summary: string | null | undefined): string {
  if (hasHeatMark(summary)) return summary as string;
  return summary && summary.trim() ? `${summary} | ${HEAT_MARK}` : HEAT_MARK;
}

// ---- code violations (lines 13 to 18) --------------------------------------------------------------------------------------------

/**
 * The repair trades a violation order names (line 13: engine B's VIOLATION_TRADES, lib/signals/opportunity.ts of origin/r10-integrate,
 * ported with its water-heater and `unless` guards). Read from the live Chicago and Austin orders: "REPAIR EXTERIOR WALL", "INSTALL SMOKE
 * DETECTORS", "HEAT UNIT ADEQUATELY", "trash or debris and overgrown yard".
 */
const VIOLATION_TRADES: ReadonlyArray<{ re: RegExp; trades: readonly CategoryId[]; unless?: RegExp }> = [
  // Not when the wall or stair is only where the paint or the light is ("INT WALL/CEILING PEELING PAINT", "ILLUMINATE PUBLIC STAIR/HALL").
  { re: /exterior wall|\bwalls?\b|ceiling|porch|stair|balcon|foundation|sidewalk shed|parapet|chimney/, trades: ['handyman', 'general-contractor'], unless: /paint|illuminat|lighting/ },
  { re: /\broof/, trades: ['roofing'] },
  { re: /smoke detector|carbon monoxide|co detector/, trades: ['handyman'] },
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

/** Line 18 and B's guard: a water heater is plumbing, and a heating plant ENCLOSURE is a fire-separation order, not heating work. */
const NOT_HEATING_RE = /water heaters?|heating plant enclosure|boiler room (?:door|enclosure)/g;

/**
 * Orders filed at one building on one visit are stored as ONE card (lib/signals/repeat-marks.ts violationVisits): the first order is the
 * title, the others are listed in a summary part that starts with this prefix ("Also cited: REPAIR PORCH SYSTEM; MAINTAIN WINDOW"). The
 * order texts are the records' own words, joined with "; ".
 */
export const ALSO_CITED_PREFIX = 'Also cited: ';

/** Every order a violation card holds: its title's, then the "Also cited" ones. */
export function violationOrders(title: string | null | undefined, summary?: string | null): string[] {
  const out = [orderText(title)];
  for (const part of (summary ?? '').split(' | ')) {
    const p = part.trim();
    if (!p.startsWith(ALSO_CITED_PREFIX)) continue;
    for (const o of p.slice(ALSO_CITED_PREFIX.length).split('; ')) if (o.trim()) out.push(orderText(o));
  }
  return out.filter(Boolean);
}

/** Trades that do this work themselves: when one is named with the handyman in the same order, the handyman is a second choice. */
const SPECIALISTS: ReadonlySet<CategoryId> = new Set(['general-contractor', 'windows-doors', 'flooring']);

/**
 * The trades the orders' own words name (line 13), each "primary" or "secondary". In VIOLATION_TRADES order. Empty when no order names a
 * repair ("property violation"). The handyman is secondary on an order that also names the specialist for it (a porch or a wall: the general
 * contractor; a window or a door: windows and doors; a floor: flooring) and primary on one it shares with nobody (smoke detectors, an
 * open-to-entry building). Round 19 RULES addition to line 13, needed for the volume ceiling: see the RULES report.
 */
export function violationTradeRoles(title: string | null | undefined, summary?: string | null): Map<CategoryId, 'primary' | 'secondary'> {
  const out = new Map<CategoryId, 'primary' | 'secondary'>();
  for (const text of violationOrders(title, summary)) {
    for (const r of VIOLATION_TRADES) {
      const probe = r.trades.includes('hvac') ? text.replace(NOT_HEATING_RE, ' ') : text;
      if (!r.re.test(probe) || (r.unless && r.unless.test(probe))) continue;
      const withSpecialist = r.trades.some((x) => SPECIALISTS.has(x));
      for (const t of r.trades) {
        const role = t === 'handyman' && withSpecialist ? 'secondary' : 'primary';
        if (out.get(t) !== 'primary') out.set(t, role);
      }
    }
  }
  return out;
}

/** The trades the orders name (line 13), primary or not. */
export function violationTrades(title: string | null | undefined, summary?: string | null): CategoryId[] {
  return [...violationTradeRoles(title, summary).keys()];
}

/** Line 15: a paperwork-only order ("OR LICENSED CONTRACTOR", "PERMIT REQUIRED - CONTRACTOR", Austin "Work Without Permit"). */
export const PAPERWORK_ORDER_RE = /licensed contractor|without (?:a )?permit|permit required|registration|\blicense\b/;
/** Line 17: Austin "Property Abatement", a clean-up the city may carry out itself if the owner does not. */
export const ABATEMENT_RE = /abatement/;
/** Line 18: Chicago "HEATING PLANT ENCLOSURE". */
export const HEATING_ENCLOSURE_RE = /heating plant enclosure/;

export function isPaperworkOrder(title: string | null | undefined, summary?: string | null): boolean {
  return violationTrades(title, summary).length === 0 && violationOrders(title, summary).some((t) => PAPERWORK_ORDER_RE.test(t));
}

// ---- 311 (lines 7 to 11) -------------------------------------------------------------------------------------------------------

/** Line 8: a sewage back-up (NYC "Sewer Maintenance / Backup", SF "sewage_back-up_discharge", KC "Sewer Backup"). */
export const SEWAGE_BACKUP_RE = /sew(?:er|age).*back-?\s?up/i;

/**
 * Line 9: Kansas City "Property Violations / <subtype>", the subtype's trades. The live rows are tagged general-contractor and handyman
 * whatever the subtype says; these are the trades the subtype names.
 */
export const KC_PROPERTY_TRADES: ReadonlyArray<{ re: RegExp; trades: readonly CategoryId[] }> = [
  { re: /\bweeds?\b|tall grass|overgrown/i, trades: ['lawn-care', 'landscaping'] },
  { re: /litter|trash|debris/i, trades: ['junk-removal'] },
  { re: /open to entry|vacant/i, trades: ['handyman', 'security'] },
  { re: /other property maintenance/i, trades: ['handyman', 'general-contractor'] },
];

export function kcPropertyTrades(source: string | null | undefined, title: string | null | undefined): CategoryId[] | null {
  if (source !== 'socrata-kansascity-311') return null;
  const body = titleBodyOf(title);
  if (!/^property violations?\b/i.test(body)) return null;
  const out: CategoryId[] = [];
  for (const r of KC_PROPERTY_TRADES) if (r.re.test(body)) for (const t of r.trades) if (!out.includes(t)) out.push(t);
  return out;
}

// ---- weather alerts (lines 29 to 37) -------------------------------------------------------------------------------------------

export type WeatherCell = 'coming_soon' | 'market_insight';

/**
 * Line 29: the NWS event-to-trades table (engine B's WEATHER_EVENTS, made explicit per trade). The first row whose pattern matches the
 * event decides; a trade not in that row's cells gets nothing (context), and an event no row matches alerts nobody. Lines 30 to 37 are
 * its cells. `carry` lists trades the row reaches even when the alert is not tagged with them (line 37).
 * Towing on a Flash Flood Warning is owner call 9 (lead-rules.ts reads it; the table holds the NO answer).
 */
export const WEATHER_EVENTS: ReadonlyArray<{ id: string; re: RegExp; cells: Partial<Record<CategoryId, WeatherCell>>; carry?: readonly CategoryId[]; line: number }> = [
  // Line 33: marine, fire weather, air and visibility notices, frost, brisk and lake wind, statements and outlooks: never an alert.
  {
    id: 'minor',
    re: /small craft|marine|gale|hazardous seas|^storm (?:warning|watch)$|hurricane force wind|freezing spray|fog|smoke|air quality|air stagnation|beach hazard|rip current|high surf|red flag|fire weather|brisk wind|lake wind|frost|dust|ashfall|tsunami|statement|outlook|special weather|hydrologic|low water|avalanche/,
    cells: {},
    line: 33,
  },
  // Line 33: a Coastal Flood Warning is the warning case of line 32 for restoration; coastal advisories and watches alert nobody.
  { id: 'coastal-flood-warning', re: /coastal flood warning|lakeshore flood warning/, cells: { restoration: 'coming_soon' }, line: 33 },
  { id: 'coastal', re: /coastal|lakeshore/, cells: {}, line: 33 },
  // Lines 30 to 32: floods. Restoration only: a warning is a heads-up, an advisory or a watch is feed only. Plumbing, hauling, towing,
  // auto repair, adjusters and insurance get nothing (line 30, line 31).
  { id: 'flood-warning', re: /flood warning/, cells: { restoration: 'coming_soon' }, line: 32 },
  { id: 'flood-advisory-watch', re: /flood/, cells: { restoration: 'market_insight' }, line: 32 },
  // Lines 34 and 37: wind. A warning is a heads-up for roofing, trees, restoration and (carried) siding and gutters; an advisory or a watch
  // is feed only for roofing, trees and restoration, and siding, gutters and adjusters are not carried.
  {
    id: 'wind-warning',
    re: /tornado warning|severe thunderstorm warning|high wind warning|extreme wind warning|hurricane warning|tropical storm warning|storm surge warning/,
    cells: { roofing: 'coming_soon', 'tree-service': 'coming_soon', restoration: 'coming_soon', 'siding-gutters': 'coming_soon' },
    carry: ['siding-gutters'],
    line: 37,
  },
  {
    id: 'wind-watch',
    re: /tornado|hurricane|tropical storm|storm surge|typhoon|extreme wind|severe thunderstorm|hail|high wind|wind advisory/,
    cells: { roofing: 'market_insight', 'tree-service': 'market_insight', restoration: 'market_insight' },
    line: 34,
  },
  // Line 34: winter. A warning is a heads-up for the winter trades; an advisory is a heads-up for snow removal only, feed only for the rest.
  { id: 'ice-storm', re: /ice storm/, cells: { 'snow-removal': 'coming_soon', plumbing: 'coming_soon', hvac: 'coming_soon', towing: 'coming_soon', 'tree-service': 'coming_soon' }, line: 34 },
  {
    id: 'winter-warning',
    re: /(?:winter storm|blizzard|snow squall|lake effect snow|heavy snow) warning/,
    cells: { 'snow-removal': 'coming_soon', plumbing: 'coming_soon', hvac: 'coming_soon', towing: 'coming_soon' },
    line: 34,
  },
  {
    id: 'winter-advisory-watch',
    re: /winter storm|blizzard|snow squall|winter weather|lake effect snow|heavy snow|snow/,
    cells: { 'snow-removal': 'coming_soon', plumbing: 'market_insight', hvac: 'market_insight', towing: 'market_insight' },
    line: 34,
  },
  // Line 36: cold. Feed only for plumbing and HVAC, nothing for anyone else.
  { id: 'cold', re: /hard freeze|freeze|extreme cold|cold weather|wind chill|cold/, cells: { plumbing: 'market_insight', hvac: 'market_insight' }, line: 36 },
  // Heat: worth knowing for HVAC, not a demand signal on its own (engine B's row).
  { id: 'heat', re: /excessive heat|extreme heat|heat advisory|heat warning|heat watch/, cells: { hvac: 'market_insight' }, line: 29 },
];

/** The NWS event of an alert row: the title before ": " ("Flood Advisory: Coconino, AZ" gives "flood advisory"). */
export function nwsEventOf(title: string | null | undefined): string {
  const t = title ?? '';
  const at = t.indexOf(':');
  return lower(at >= 0 ? t.slice(0, at) : t);
}

export function weatherRowFor(title: string | null | undefined): (typeof WEATHER_EVENTS)[number] | null {
  const e = nwsEventOf(title);
  if (!e) return null;
  return WEATHER_EVENTS.find((w) => w.re.test(e)) ?? null;
}

// ---- storm reports (lines 38 to 41) --------------------------------------------------------------------------------------------

/** "1.75 inch hail reported near ..." gives 1.75; null when the title does not give a size. */
export function hailInchesOf(title: string | null | undefined): number | null {
  const m = /([\d.]+)\s*inch hail/i.exec(title ?? '');
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const isHailReport = (title: string | null | undefined) => /\bhail\b/i.test(title ?? '');
export const isWindDamageReport = (title: string | null | undefined) => /^wind damage/i.test((title ?? '').trim());
export const isTornadoReport = (title: string | null | undefined) => /^tornado/i.test((title ?? '').trim());

/**
 * Line 39: engine B's stormReportRule for a wind damage report, per trade, read from the report's own remark (the summary). A tree across
 * a highway, ramp or road is a road crew's job, not a homeowner's.
 */
export function windDamageLevel(summary: string | null | undefined, trade: 'roofing' | 'restoration' | 'tree-service'): 'act_now' | 'coming_soon' | 'market_insight' {
  const c = lower(summary);
  const road = /interstate|highway|\bhwy\b|on.?ramp|off.?ramp|\bi-\d|\broad(?:way)?\b|blocking (?:the )?(?:street|lane)/.test(c);
  const trees = /\btrees?\b|limb|branch|uproot|snapped|felled/.test(c) && !(road && !/home|house|yard|residen/.test(c));
  const roof = /roof|shingle|tarp|siding|gutter/.test(c);
  const homeDamage = /home|house|residen|roof|siding|garage|carport|porch|structure|building/.test(c);
  if (trade === 'tree-service') return trees ? 'act_now' : roof ? 'market_insight' : 'coming_soon';
  if (trade === 'roofing') return roof ? 'act_now' : 'coming_soon';
  return homeDamage ? 'act_now' : 'coming_soon';
}

// ---- permit stages (criterion 6: stage updates unchanged) --------------------------------------------------------------------------

/**
 * A permit at a finished stage (lib/signals/stage.ts TRIGGER_STAGES) reaches the trades that work on a finished building (STAGE_TRADES) as a
 * heads-up, exactly as before round 19: the audited demotions of new builds (review lines 55 to 57) are about permit-issue timing, and the
 * stage update is the timing. Copied here so the label code stays free of server imports; tests/signals/rules-audit.test.ts checks both
 * lists against stage.ts.
 */
export const FINISHED_STAGES: readonly string[] = ['final_inspection', 'finaled', 'certificate_of_occupancy'];
export const FINISHED_STAGE_TRADES: readonly CategoryId[] = ['cleaning', 'janitorial-commercial', 'landscaping', 'security'];

// ---- what a non-permit record carries ------------------------------------------------------------------------------------------

export interface CarryInput {
  source?: string | null;
  kind?: string | null;
  subtype?: string | null;
  title?: string | null;
  summary?: string | null;
}

/**
 * Trades a non-permit record reaches beyond its own tags (the audit's "carry"):
 *  - a sewage back-up 311 request reaches restoration (line 8);
 *  - a Kansas City property violation reaches the trades its subtype names (line 9);
 *  - a code violation reaches the repair trades its order names (line 13);
 *  - a High Wind, Severe Thunderstorm or Tornado Warning reaches siding and gutters (line 37);
 *  - a hail report of 1 inch or more reaches siding and gutters (line 41).
 * Building permits are not handled here: their downstream trades come from permit-routing.ts.
 */
export function extraCarried(sig: CarryInput): CategoryId[] {
  const source = lower(sig.source);
  const subtype = lower(sig.subtype);
  const kind = lower(sig.kind);
  if (subtype === '311') {
    const kc = kcPropertyTrades(source, sig.title);
    if (kc) return kc;
    return SEWAGE_BACKUP_RE.test(titleBodyOf(sig.title)) ? ['restoration'] : [];
  }
  if (subtype === 'violation') {
    if (ABATEMENT_RE.test(orderText(sig.title))) return [];
    return violationTrades(sig.title, sig.summary);
  }
  if (source === 'nws' || kind === 'alert') return [...(weatherRowFor(sig.title)?.carry ?? [])];
  if (source === 'spc' && isHailReport(sig.title)) {
    const inches = hailInchesOf(sig.title);
    return inches !== null && inches >= 1 ? ['siding-gutters'] : [];
  }
  return [];
}

/**
 * The tags the records that carry a trade are stored with, so a member's database read (the backfill's category filter) also fetches them.
 * A WIDER read only: what the member gets is still decided by the matcher and the labels. Measured on the live rows: every carried pair's
 * record holds at least one of these tags.
 */
export const CARRY_CARRIER_TAGS: Readonly<Partial<Record<CategoryId, readonly CategoryId[]>>> = {
  restoration: ['plumbing'],
  'siding-gutters': ['roofing'],
  'lawn-care': ['general-contractor', 'handyman', 'landscaping', 'junk-removal'],
  landscaping: ['general-contractor', 'handyman', 'junk-removal', 'lawn-care'],
  'junk-removal': ['general-contractor', 'handyman', 'lawn-care', 'landscaping'],
  security: ['general-contractor', 'handyman'],
  handyman: ['general-contractor', 'electrical', 'windows-doors', 'flooring', 'pest-control', 'hvac', 'painting'],
  'general-contractor': ['handyman', 'fencing', 'roofing', 'siding-gutters', 'hvac', 'concrete-paving'],
  plumbing: ['junk-removal', 'flooring', 'hvac', 'general-contractor', 'handyman'],
  electrical: ['general-contractor', 'handyman'],
  'windows-doors': ['general-contractor', 'handyman'],
  painting: ['general-contractor', 'handyman'],
  flooring: ['plumbing'],
};
