import type { CategoryId } from './categories';
import type { WeatherFacts } from './weather-hazard';

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

/**
 * An order text as it is listed under "Also cited": the two separators the notes use (" | " between summary parts, "; " between orders)
 * are replaced, so one order always reads as one order (review P3 item 10).
 */
export function cleanOrderText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s*\|\s*/g, ' / ').replace(/\s*;\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

/**
 * A summary with the notes this product writes (the heat note, the "Also cited" list) removed. Applied to every incoming row before the
 * marks are written (lib/signals/repeat-marks.ts), so a source's own text can never carry either note. Null when nothing is left.
 */
export function stripNotes(summary: string | null | undefined): string | null {
  if (typeof summary !== 'string') return null;
  const parts = summary.split(' | ');
  const kept = parts.filter((p) => p.trim() !== HEAT_MARK && !p.trim().startsWith(ALSO_CITED_PREFIX));
  if (kept.length === parts.length) return summary;
  const out = kept.join(' | ').trim();
  return out || null;
}

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

// ---- hail size and wind gust routing (round 33, HOLLER_HAIL_ROUTING_ENABLED) --------------------------------------------------------

/**
 * Round 33 (HAIL): the trades a hail size or a wind gust reaches, read from what the record itself says (the NWS alert's CAP maxHailSize and
 * maxWindGust, or its text; the size or gust in an SPC or LSR report title). The facts arrive only while HOLLER_HAIL_ROUTING_ENABLED is on
 * (lib/signals/weather-hazard.ts weatherFactsOf), so with the switch off nothing below changes a label or a carried trade.
 *
 * Thresholds are the National Weather Service severe thunderstorm criteria: "hail of 1 inch (quarter) diameter or greater, and/or wind gusts
 * of 50 knots (58 mph) or greater" (weather.gov/dtx/convective_defs, checked 2026-11-25). The 1 inch hail line is also the one the r30 WX
 * research kept (gates/r30/WX.md section 2.2) and the one spc-hail already uses for siding and gutters (line 41).
 *
 * The routed trades are ADDED to the record's own routing, never removed. For an NWS alert the routed trade gets the strongest level the
 * alert's WEATHER_EVENTS row already gives any trade (a warning: heads-up; a watch or advisory: feed only, as line 34 decided); an event row
 * with no cells (statements, marine) routes nothing. For a storm report the existing storm rules decide the label.
 */
export const HAIL_ROUTE_MIN_INCHES = 1;
export const GUST_ROUTE_MIN_MPH = 58;

export const HAZARD_ROUTES: ReadonlyArray<{ id: 'hail' | 'gust'; min: number; trades: readonly CategoryId[]; why: string }> = [
  { id: 'hail', min: HAIL_ROUTE_MIN_INCHES, trades: ['siding-gutters', 'roofing'], why: 'Hail of 1 inch (quarter) or more is the NWS severe line; it is the size that dents gutters, siding and roofs.' },
  { id: 'gust', min: GUST_ROUTE_MIN_MPH, trades: ['tree-service', 'siding-gutters'], why: 'Gusts of 58 mph (50 knots) or more are the NWS severe line; they bring down limbs and pull gutters and siding loose.' },
];

/** The trades the record's hail size and gust reach (empty without facts, below the thresholds, or with the switch off). */
export function hazardRouteTrades(facts: WeatherFacts | null | undefined): CategoryId[] {
  if (!facts) return [];
  const out: CategoryId[] = [];
  for (const r of HAZARD_ROUTES) {
    const v = r.id === 'hail' ? facts.hailInches : facts.gustMph;
    if (typeof v === 'number' && v >= r.min) for (const t of r.trades) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The strongest level an NWS event row gives any trade, or null for a row with no cells (it alerts nobody, so it routes nobody). */
export function strongestWeatherCell(row: (typeof WEATHER_EVENTS)[number] | null): WeatherCell | null {
  if (!row) return null;
  const cells = Object.values(row.cells);
  return cells.includes('coming_soon') ? 'coming_soon' : cells.length ? 'market_insight' : null;
}

/** Event rows the hail and gust routing never uses: floods and coastal products (a flood product's numbers are water, not roofs or trees). */
const HAZARD_ROUTE_SKIPPED_ROWS: ReadonlySet<string> = new Set(['minor', 'coastal-flood-warning', 'coastal', 'flood-warning', 'flood-advisory-watch']);

/**
 * The level the hail and gust routing gives its trades on an NWS alert (review P2-1): a WARNING (or emergency) gets the strongest level its
 * event row gives any trade; a WATCH, ADVISORY or statement gets feed only (market_insight), whatever its row gives snow removal; flood,
 * coastal and no-cell rows route nothing (null).
 */
export function hazardRouteLevel(title: string | null | undefined): WeatherCell | null {
  const row = weatherRowFor(title);
  if (!row || HAZARD_ROUTE_SKIPPED_ROWS.has(row.id)) return null;
  const strongest = strongestWeatherCell(row);
  if (!strongest) return null;
  const event = nwsEventOf(title);
  const warning = /\b(?:warning|emergency)\b/.test(event) && !/\b(?:watch|advisory|statement)\b/.test(event);
  return warning ? strongest : 'market_insight';
}

// ---- storm reports (lines 38 to 41) --------------------------------------------------------------------------------------------

/** "1.75 inch hail reported near ..." gives 1.75; null when the title does not give a size. */
export function hailInchesOf(title: string | null | undefined): number | null {
  const m = /([\d.]+)\s*inch hail/i.exec(title ?? '');
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The event part of an SPC title: the text before " near " (round 18: a place such as "Hail Creek" or "Hailey" never names the event). */
const stormEventOf = (title: string | null | undefined) => (title ?? '').split(/\s+near\s+/i)[0];
export const isHailReport = (title: string | null | undefined) => /\bhail\b/i.test(stormEventOf(title));
export const isWindDamageReport = (title: string | null | undefined) => /^wind damage/i.test((title ?? '').trim());
export const isTornadoReport = (title: string | null | undefined) => /^tornado/i.test((title ?? '').trim());

/**
 * Round 33 (review P1-3): the five facts the wind damage rule reads from a remark, as flags. The LSR adapter computes them from the remark in
 * memory, stores the flags (never the remark) and writes a summary of fixed phrases (lsrSummaryOf) from which these same five facts are read
 * back, so an LSR report and an SPC report with the same remark get the same label for every trade.
 */
export interface WindDamageFacts {
  /** Trees, limbs or branches named (before the road exception). */
  trees: boolean;
  /** A road, highway, ramp or a blocked street or lane named. */
  road: boolean;
  /** A roof, shingles, siding or gutters named. */
  roof: boolean;
  /** A home, house, residence, garage, carport, porch, structure or building (or a roof) named. */
  structure: boolean;
  /** A home, house, yard or residence named (the road exception's "but at a home" test). */
  homeOrYard: boolean;
}

// ---- road words (round 34, HOLLER_ROAD_WORDS_ENABLED) --------------------------------------------------------------------------------

export const ROAD_WORDS_FLAG = 'HOLLER_ROAD_WORDS_ENABLED';

/**
 * The wider road reading is ON only when the switch is "1", "true", "on" or "yes" (any case). Unset: off, and every label is what it was.
 *
 * This runs in the browser too (the feed card builds its text there), so the default reads `process.env.HOLLER_ROAD_WORDS_ENABLED` as a plain
 * member expression: next.config.ts lists the variable under `env`, so Next replaces it with the build's value in the server AND the browser
 * bundle and the two always agree (a variable without NEXT_PUBLIC_ is otherwise undefined in the browser). Outside Next (tests, the replay)
 * it is the real environment variable. An environment change reaches new deployments only, as for every switch here.
 */
export function roadWordsEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env.HOLLER_ROAD_WORDS_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

/** The road words main has always read (switch off, and still read with it on). Never edit: the replay anchor depends on it. */
export const ROAD_WORDS_BASE = /interstate|highway|\bhwy\b|on.?ramp|off.?ramp|\bi-\d|\broad(?:way)?\b|blocking (?:the )?(?:street|lane)/;

/**
 * The stored phrase an LSR row carries when its remark puts a tree on a street or freeway by one of the NEW road words (adapters/lsr-parts.ts
 * LSR_ROAD_TREE_PART). It must not contain a word of ROAD_WORDS_BASE ("road", "highway"): main reads the summary too.
 */
export const ROAD_TREE_PHRASE = 'it names a street or freeway';

/*
 * Round 34 (review r33-hail-2 R4-2: 24 of 63 urgent tree service reports in the January 2025 Los Angeles wind event were trees on freeways or in
 * traffic lanes). The new road words count only where a tree is TIED to the road in the same clause, never where a street only describes an
 * area ("between Western Avenue and ...", "along US 270", "2 mi N of Main St", "near Kenwood St and Oak St", "on the 800 block of Fairview St"):
 *   <tree words> <up to 4 words, none a place word> <on|onto|across|over|blocking|blocks|blocked|covering|closing|closed> <up to 4 words> <road word>
 *   <tree words> in <the, two, left ...> lanes
 *   <road word> <up to 3 words> blocked|closed|covered by <up to 3 words> <tree words>
 * New road words, whole words, lower case: freeway(s), fwy, ramp(s) (not boat, wheelchair, loading, skate ramps, nor "Ramp Creek"), lanes,
 * "<slow|left|travel|traffic ...> lane", "blocking a lane", boulevard, blvd, street(s), rd, avenue, ave (not "Ave Maria"), parkway, pkwy,
 * interchange, overpass, US-n, SR n, and "St" as a street suffix only (after a name word, before the end, a punctuation mark, a number or a
 * joining word: never "Port St Lucie", "of St Louis"). Not on the list: "lane" alone ("Penny Lane Farm"), "Dr", "drive", "way", plurals of road.
 * A road word followed by a place noun ("Street MD", "Parkway Village", "Overpass Park") is a name. A report that also names a home, yard,
 * apartment, duplex, trailer, condo, church, business, school, a roof, garage or building, a vehicle or power lines is not read as a tree on a
 * road (main did not read these words at all, so this only ever lowers LESS). Main's own road words (ROAD_WORDS_BASE) keep main's reading.
 */
const TOK = "[a-z0-9'’-]+";
const PLACE_STOP = 'near|between|along|of|from|at|block|blocks|miles?|mi|area|vicinity|or|vehicles?|cars?|trucks?|vans?|wires?|poles?|power|lines?';
const GAP1 = `(?:\\s+(?!(?:${PLACE_STOP})\\b)${TOK}){0,4}`;
const GAP2 = `(?:\\s+(?!(?:${PLACE_STOP}|by)\\b)${TOK}){0,4}`;
const NOT_A_NAME = 'of|in|at|near|to|from|the|a|an|by|and|or|on|onto|for|with|into|across|along|off|over|under|between|see|call|called|mr|mrs|ms|about|than|is|was|are|were|my|our|your|his|her|their|this|that|these|those|no|not|blocking|blocks|blocked|covering|closing|closed';
const AFTER_ST =
  '(?=\\.?(?:$|\\s*[,;:)/&\\-]|\\s+(?:and|near|at|in|on|between|by|to|from|just|for|with|blocking|blocked|across|closed|due|was|were|is|are|after|cross|crossing|intersection|north|south|east|west|n|s|e|w|ne|nw|se|sw|\\d+|zip|down|downed|damaged|reported)\\b))';
const PLACE_NOUN = '(?!\\s+(?:park|estates?|village|mall|plaza|inn|motel|hotel|center|centre|school|church|baptist|elementary|academy|apartments?|md|lake|creek|farm|ranch|market|store|club|restaurant|maria|community|bowling|alley)\\b)';
const NAMED_ROAD =
  `\\b(?:blvd|boulevards?|streets?|rd|ave|avenues?|pkwy|parkways?|free-?ways?|fwys?|interchanges?|overpass(?:es)?|us-\\d{1,3}|us ?\\d{2,3}(?! ?(?:mi|miles?|min|mins|minutes?|ft|feet|yards?|yds?|mph|kts?|inch|inches|in)\\b)|sr[- ]?\\d{1,4})\\b${PLACE_NOUN}(?!\\s+of\\b)` +
  `|(?<=\\b(?!(?:${NOT_A_NAME})\\b)[a-z0-9]+ )st\\b${AFTER_ST}`;
const RAMP = '(?<!boat |wheelchair |handicap |handicapped |loading |skate |ada )\\bramps?\\b(?!\\s+(?:creek|lake|park|river)\\b)';
const FILLER = '(?:the|a|an|all|both|two|three|four|five|\\d+|right|left|center|middle|slow|fast|travel|traffic|turn|entire|multiple|several|one|any)';
const LANE_MODS = '(?:traffic|travel|slow|fast|turn|bike|bus|hov|carpool|left|right|center|middle|inside|outside|express|passing)';
const LANES = `(?:(?:\\s+${FILLER}){0,3}\\s+lanes\\b|(?:\\s+${FILLER}){0,2}\\s+${LANE_MODS} lane\\b|\\s+lane(?= of traffic\\b))${PLACE_NOUN}`;
const TREE_WORDS = '(?:trees?|limbs?|branch(?:es)?)';
const CONNECT = '(?:on|onto|across|over|blocking|blocks|blocked|covering|closing|closed)';
const TIED_ROAD_RE = new RegExp(
  [
    `\\b${TREE_WORDS}\\b${GAP1}\\s+${CONNECT}\\b(?:${GAP2}\\s+(?:${NAMED_ROAD})|(?:\\s+${FILLER}){0,3}\\s+${RAMP}|${LANES})`,
    `\\b${TREE_WORDS}\\b${GAP1}\\s+in\\b${LANES}`,
    `\\b${TREE_WORDS}\\b${GAP1}\\s+blocking (?:an? |one )lane\\b`,
    `\\b(?:${NAMED_ROAD}|${RAMP}|lanes\\b)(?:\\s+${TOK}){0,3}\\s+(?:blocked|closed|covered|obstructed|shut)\\s+(?:by|with)(?:\\s+${TOK}){0,3}\\s+${TREE_WORDS}\\b`,
  ].join('|'),
  'i',
);
/** A report that also names private property or a thing a tree fell on: the street is its address, not where the tree is. */
const NOT_ON_A_ROAD_RE =
  /home|house|yard|residen|apartment|complex|duplex|triplex|townhome|townhouse|condo|trailer|dwelling|cabin|cottage|church|chapel|temple|mosque|synagogue|business|\bstores?\b|\bshops?\b|school|\bsheds?\b|barn|warehouse|restaurant|hotel|motel|\boffices?\b|\bmall\b|campus|propert|neighborhood|subdivision|(?<!p)roof|siding|garage|carport|porch|structure|building|\bdecks?\b|\bfences?\b|\bvehicles?\b|\bcars?\b|\btrucks?\b|\bvans?\b|power line|\bwires?\b|\bpoles?\b/;

/**
 * Round 34: a tree tied to a street or freeway by a NEW road word (not main's), read from a remark or from the stored LSR phrase. Independent
 * of the switch, so the LSR adapter can store it as a neutral fact and the label code decides at read time whether to use it.
 */
export function treeOnRoadWordsOf(text: string | null | undefined): boolean {
  const c = lower(text);
  return c.includes(ROAD_TREE_PHRASE) || (!NOT_ON_A_ROAD_RE.test(c) && TIED_ROAD_RE.test(c));
}

/**
 * The line 39 rule's own word patterns, shared (not copied) with the LSR adapter (adapters/lsr-parts.ts, review 3 R3-1): the LSR row takes
 * its road and roof facts from these same patterns, so it can never read fewer road or roof words than an SPC row with the same remark.
 * `roof` is the union of roofOrSiding (which the rule also reads as a structure) and shinglesOrGutters (which it does not).
 */
export const WIND_DAMAGE_PATTERNS = {
  trees: /\btrees?\b|limb|branch|uproot|snapped|felled/,
  road: ROAD_WORDS_BASE,
  // "tarp" alone is not roof work (review P3 item 6, rows 81317 and 90466: a tarp blown off the ground)
  // Round 24 (cells report data bug): "roof" never matches inside "proof" ("WATERPROOF", "FIREPROOF"); "reroof" still counts.
  roofOrSiding: /(?<!p)roof|siding/,
  shinglesOrGutters: /shingle|gutter/,
  structure: /home|house|residen|(?<!p)roof|siding|garage|carport|porch|structure|building/,
  homeOrYard: /home|house|yard|residen/,
} as const;

export function windDamageFactsOf(text: string | null | undefined): WindDamageFacts {
  const c = lower(text);
  const P = WIND_DAMAGE_PATTERNS;
  return {
    trees: P.trees.test(c),
    // Main's road words always; round 34, switch on: also a tree tied to a street or freeway by the new words (treeOnRoadWordsOf).
    road: P.road.test(c) || (roadWordsEnabled() && treeOnRoadWordsOf(c)),
    roof: P.roofOrSiding.test(c) || P.shinglesOrGutters.test(c),
    structure: P.structure.test(c),
    homeOrYard: P.homeOrYard.test(c),
  };
}

/**
 * A tree on a road, not on a home: the road crew's job, so the report is not act now for tree service (line 39's road exception, main's
 * rule). Round 34 only adds road readings (treeOnRoadWordsOf), so with the switch on a label is never higher than main's.
 */
export function treeOnRoad(f: WindDamageFacts): boolean {
  return f.trees && f.road && !f.homeOrYard;
}

/**
 * Line 39: engine B's stormReportRule for a wind damage report, per trade, read from the report's own remark (the summary). A tree across
 * a highway, ramp or road is a road crew's job, not a homeowner's.
 */
export function windDamageLevelOf(f: WindDamageFacts, trade: 'roofing' | 'restoration' | 'tree-service'): 'act_now' | 'coming_soon' | 'market_insight' {
  const trees = f.trees && !treeOnRoad(f);
  if (trade === 'tree-service') return trees ? 'act_now' : f.roof ? 'market_insight' : 'coming_soon';
  if (trade === 'roofing') return f.roof ? 'act_now' : 'coming_soon';
  return f.structure ? 'act_now' : 'coming_soon';
}

export function windDamageLevel(summary: string | null | undefined, trade: 'roofing' | 'restoration' | 'tree-service'): 'act_now' | 'coming_soon' | 'market_insight' {
  return windDamageLevelOf(windDamageFactsOf(summary), trade);
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
  /** Round 33: hail size and gust (lib/signals/weather-hazard.ts weatherFactsOf; null while HOLLER_HAIL_ROUTING_ENABLED is off). */
  weather?: WeatherFacts | null;
}

/**
 * Trades a non-permit record reaches beyond its own tags (the audit's "carry"):
 *  - a sewage back-up 311 request reaches restoration (line 8);
 *  - a Kansas City property violation reaches the trades its subtype names (line 9);
 *  - a code violation reaches the repair trades its order names (line 13);
 *  - a High Wind, Severe Thunderstorm or Tornado Warning reaches siding and gutters (line 37);
 *  - a hail report of 1 inch or more reaches siding and gutters (line 41);
 *  - round 33, switch on: a hail size or gust at or above HAZARD_ROUTES reaches its trades (an NWS alert only when its event row has cells).
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
  const hazard = hazardRouteTrades(sig.weather);
  const plus = (base: readonly CategoryId[]) => [...base, ...hazard.filter((t) => !base.includes(t))];
  if (source === 'nws' || kind === 'alert') {
    const row = weatherRowFor(sig.title);
    const base = [...(row?.carry ?? [])];
    return source === 'nws' && hazardRouteLevel(sig.title) ? plus(base) : base;
  }
  if (source === 'spc' && isHailReport(sig.title)) {
    const inches = hailInchesOf(sig.title);
    return plus(inches !== null && inches >= 1 ? ['siding-gutters'] : []);
  }
  if (source === 'spc' || source === 'lsr') return plus([]);
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
  handyman: ['general-contractor', 'electrical', 'windows-doors', 'flooring', 'pest-control', 'hvac', 'painting', 'concrete-paving'],
  'general-contractor': ['handyman', 'fencing', 'roofing', 'siding-gutters', 'hvac', 'concrete-paving'],
  plumbing: ['junk-removal', 'flooring', 'hvac', 'general-contractor', 'handyman'],
  electrical: ['general-contractor', 'handyman'],
  'windows-doors': ['general-contractor', 'handyman'],
  painting: ['general-contractor', 'handyman'],
  flooring: ['plumbing'],
  locksmith: ['windows-doors', 'handyman'],
};
