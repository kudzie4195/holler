/**
 * Round 33 (HAIL): what a weather record SAYS about hail size and wind gusts, read from the National Weather Service CAP alert parameters
 * (api.weather.gov properties.parameters) and, for older rows and products without them, from the alert's own text. Also the switch that
 * turns the hail and gust routing on (HOLLER_HAIL_ROUTING_ENABLED, default off).
 *
 * The CAP parameters, as the live API writes them (real alerts saved in tests/fixtures/nws-cap/, see tests/signals/weather-hazard.test.ts):
 *   maxHailSize               ["1.75"], ["Up to .75"], ["0.00"]          inches
 *   maxWindGust               ["60 MPH"], ["Up to 50 MPH"], ["70 MPH"]  mph (knots converted when a product says KT)
 *   hailThreat, windThreat    ["RADAR INDICATED"] | ["OBSERVED"]
 *   tornadoDetection          ["POSSIBLE"] | ["RADAR INDICATED"] | ["OBSERVED"]
 *   thunderstormDamageThreat  ["CONSIDERABLE"] | ["DESTRUCTIVE"];  tornadoDamageThreat ["CONSIDERABLE"] | ["CATASTROPHIC"]
 *
 * Every value here is what the ALERT says (a warning or forecast), never a measured or confirmed fact about any property. Pure, except for
 * hailRoutingEnabled, which reads process.env at call time (like lib/builders/switch.ts). The label rules in lead-rules.ts and carry.ts stay
 * pure: they only see facts, and weatherFactsOf hands them none while the switch is off.
 */

/** The threat tags stored as they are (upper case, letters and spaces only). */
export interface CapHazard {
  /** Largest hail the alert names, inches. Null when absent or 0. */
  maxHailSizeIn: number | null;
  /** Strongest gust the alert names, mph. Null when absent. */
  maxWindGustMph: number | null;
  hailThreat: string | null;
  windThreat: string | null;
  tornadoDetection: string | null;
  thunderstormDamageThreat: string | null;
  tornadoDamageThreat: string | null;
  /** Where the two numbers came from: the CAP parameters, the alert text, both, or neither ('none'). Always set at ingest. */
  hazardFrom: 'cap' | 'text' | 'cap+text' | 'none';
}

/** The facts the routing reads. */
export interface WeatherFacts {
  hailInches: number | null;
  gustMph: number | null;
}

export const HAIL_ROUTING_FLAG = 'HOLLER_HAIL_ROUTING_ENABLED';

/** The hail and gust routing (and its card line) is ON only when the switch is "1", "true", "on" or "yes" (any case). Unset: off. */
export function hailRoutingEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_HAIL_ROUTING_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

function firstString(v: unknown): string | null {
  const s = Array.isArray(v) ? v.find((x) => typeof x === 'string') : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

function num(v: string): number | null {
  const m = /(\d*\.\d+|\d+)/.exec(v);
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** "1.75" gives 1.75, "Up to .75" gives 0.75, "0.00" gives null (no hail named). Sizes above 8 inches are not hail sizes: null. */
export function parseHailSize(v: unknown): number | null {
  const s = firstString(v);
  if (!s) return null;
  const n = num(s);
  return n !== null && n > 0 && n <= 8 ? Math.round(n * 100) / 100 : null;
}

/** "60 MPH" gives 60, "Up to 50 MPH" gives 50, "50 KT" gives 58. Values outside 1 to 250 mph are not gusts: null. */
export function parseWindGust(v: unknown): number | null {
  const s = firstString(v);
  if (!s) return null;
  const n = num(s);
  if (n === null) return null;
  const mph = /\bkts?\b|\bknots?\b/i.test(s) ? Math.round(n * 1.15078) : Math.round(n);
  return mph >= 1 && mph <= 250 ? mph : null;
}

function threat(v: unknown): string | null {
  const s = firstString(v);
  if (!s) return null;
  const up = s.toUpperCase().replace(/\s+/g, ' ');
  return /^[A-Z ]{1,40}$/.test(up) ? up : null;
}

/**
 * Hail size words the National Weather Service uses, in inches, read only as "<word> size hail" or "<word> sized hail". Source: NWS Fort Worth
 * hail size guide (weather.gov/fwd/hailsizeguide, checked 2026-11-25). That guide lists half dollar with ping pong ball at 1.50; here half
 * dollar is 1.25, because that is what the weather service's own alert says for it (NWS Tulsa, 2025-05-18: "HAZARD...Half dollar size hail"
 * with CAP maxHailSize 1.25, fixture tests/fixtures/nws-cap/tulsa-svr-2025-05-18-upto-50mph.json). Only used when an alert has no CAP size.
 */
export const HAIL_SIZE_WORDS: Readonly<Record<string, number>> = {
  pea: 0.25,
  marble: 0.5,
  penny: 0.75,
  nickel: 0.88,
  quarter: 1.0,
  'half dollar': 1.25,
  'ping pong ball': 1.5,
  'ping pong': 1.5,
  'golf ball': 1.75,
  'hen egg': 2.0,
  egg: 2.0,
  'tennis ball': 2.5,
  baseball: 2.75,
  'tea cup': 3.0,
  grapefruit: 4.0,
  softball: 4.5,
};

/** A sentence that takes back what it names ("no longer expected", "not expected"): nothing in it is read. */
const NEGATED = new RegExp(
  [
    // taken back or past: "no longer expected", "not expected", "aren't expected", "won't be", "has ended", "ended at 5 PM"
    String.raw`\bno longer\b|\bnot (?:be )?(?:expected|anticipated|likely|forecast)\b|\bunlikely\b|\bno (?:large |severe )?hail\b`,
    String.raw`\b(?:is|are|will|was|were) not\b|\b(?:aren|isn|won|weren|wasn|don|doesn)['’]?t\b|\bno threat\b|\bended\b|\bdiminish`,
    // lowered, cancelled, weakened, moved out
    String.raw`\blowered\b|\breduced\b|\bdowngraded\b|\bcancel|\bweakened\b|\bbelow severe\b|\bmoved out\b|\bhas moved\b|\bhave moved\b`,
    // somewhere else, or a definition rather than a warning for this area
    String.raw`\bnext county\b|\banother county\b|\bneighboring\b|\belsewhere\b|\bare issued when\b|\bwhen storms produce\b|\bmeans conditions\b|\bfavorable for\b`,
    // a size compared with a threshold, a past year
    String.raw`\bsmaller than\b|\bcriteria\b|\b(?:19|20)\d{2}\b`,
  ].join('|'),
);

/** Products whose text may name a hail size the routing reads: severe thunderstorm and tornado products (and their statements). */
export const HAIL_TEXT_EVENTS = /severe thunderstorm|tornado/i;

const SIZE_WORD_RE = new RegExp(`\\b(${Object.keys(HAIL_SIZE_WORDS).sort((a, b) => b.length - a.length).join('|')})[- ]size(?:d)? hail\\b`, 'g');

/**
 * The largest hail and gust an alert's own TEXT names, read ONLY in the exact NWS phrasings, sentence by sentence, skipping any sentence that
 * takes it back. For products without CAP parameters (High Wind Warning: "gusts up to 75 mph expected") and rows stored before round 33.
 *   gust: "gusts up to N mph", "gusts of N to M mph", "gusts to N mph", "wind gusts of N mph", "winds gusting as high as N mph",
 *         "winds will gust as high as N mph", the HAZARD line "N mph wind gusts" (knots converted)
 *   hail: "hail up to N inch(es)" (never "... inches deep"), "N inch hail", "two inch hail", "<size word> size hail" (HAIL_SIZE_WORDS),
 *         and only when `event` is a severe thunderstorm or tornado product (a flood or winter product's "inches" is never hail).
 * A town or road named Hail ("in Hailey", "Hail Creek"), rain or snow totals, storm motion and temperatures read nothing.
 */
export function hazardFromText(text: string | null | undefined, event?: string | null): WeatherFacts {
  const hailAllowed = event === undefined || event === null ? true : HAIL_TEXT_EVENTS.test(event);
  let gust: number | null = null;
  let hail: number | null = null;
  const bumpGust = (n: number) => {
    if (Number.isFinite(n) && n >= 1 && n <= 250 && (gust === null || n > gust)) gust = Math.round(n);
  };
  const bumpHail = (n: number) => {
    if (Number.isFinite(n) && n > 0 && n <= 8 && (hail === null || n > hail)) hail = Math.round(n * 100) / 100;
  };
  const sentences = (text ?? '').toLowerCase().replace(/\s+/g, ' ').split(/\.{3}|\*|[.!?;](?=\s|$)/);
  for (const sent of sentences) {
    if (!sent.trim() || NEGATED.test(sent)) continue;
    for (const m of sent.matchAll(/\bgust(?:s|ing)? (?:up to |of |to |as high as |near |around |in excess of )?(\d{2,3})(?: to (\d{2,3}))? (mph|kts?|knots)\b/g)) {
      const k = m[3] === 'mph' ? 1 : 1.15078;
      bumpGust(Number(m[1]) * k);
      if (m[2]) bumpGust(Number(m[2]) * k);
    }
    for (const m of sent.matchAll(/\bwind gusts of (\d{2,3})(?: to (\d{2,3}))? mph\b/g)) {
      bumpGust(Number(m[1]));
      if (m[2]) bumpGust(Number(m[2]));
    }
    for (const m of sent.matchAll(/\b(\d{2,3}) mph wind gusts\b/g)) bumpGust(Number(m[1]));
    if (!hailAllowed) continue;
    // Never a depth or a drift: "hail up to 3 inches deep", "in depth", "a 6 inch hail drift".
    for (const m of sent.matchAll(/\bhail (?:up to |of up to |of |to )(\d*\.\d+|\d+) inch(?:es)?\b(?! deep| in depth| of (?:accumulation|ice)| on the ground)/g)) bumpHail(parseFloat(m[1]));
    // Fractions: "3/4 inch hail" is 0.75, "1 1/2 inch hail" is 1.50.
    for (const m of sent.matchAll(/(?<![\d./])(?:(\d) )?(\d)\/(\d{1,2})[- ]inch(?:es)? (?:diameter )?hail\b(?! drifts?| accumulation| depth| on the ground)/g)) {
      bumpHail((m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]));
    }
    // "1.75 inch hail": not a fraction's denominator ("3/4"), not the top of a range ("2 to 4 inch hail"), not a drift or a depth.
    for (const m of sent.matchAll(/(?<![\d./])(?<!\d to )(?<!\d-)(\d*\.\d+|\d+)[- ]inch(?:es)? (?:diameter )?hail\b(?! drifts?| accumulation| depth| on the ground)/g)) bumpHail(parseFloat(m[1]));
    const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
    for (const m of sent.matchAll(/\b(one|two|three|four)[- ]inch(?:es)? hail\b/g)) bumpHail(WORDS[m[1]]);
    for (const m of sent.matchAll(SIZE_WORD_RE)) bumpHail(HAIL_SIZE_WORDS[m[1]]);
  }
  return { hailInches: hail, gustMph: gust };
}

/**
 * CAP parameters to the stored fields. Per number: when the CAP parameter is present the CAP value wins (also "0.00", which means none) and
 * the text is never read for it; when it is absent the alert's own text is read (hazardFromText, hail only on severe thunderstorm and
 * tornado products). hazardFrom is always set, so a later read of the row knows ingest already decided and never reads the text again.
 */
export function capHazardOf(parameters: unknown, text?: string | null, event?: string | null): CapHazard {
  const p = (parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? parameters : {}) as Record<string, unknown>;
  const hailCap = p.maxHailSize !== undefined;
  const gustCap = p.maxWindGust !== undefined;
  const fromText = !hailCap || !gustCap ? hazardFromText(text, event ?? '') : { hailInches: null, gustMph: null };
  const maxHailSizeIn = hailCap ? parseHailSize(p.maxHailSize) : fromText.hailInches;
  const maxWindGustMph = gustCap ? parseWindGust(p.maxWindGust) : fromText.gustMph;
  const usedText = (!hailCap && maxHailSizeIn !== null) || (!gustCap && maxWindGustMph !== null);
  const usedCap = hailCap || gustCap;
  return {
    maxHailSizeIn,
    maxWindGustMph,
    hailThreat: threat(p.hailThreat),
    windThreat: threat(p.windThreat),
    tornadoDetection: threat(p.tornadoDetection),
    thunderstormDamageThreat: threat(p.thunderstormDamageThreat),
    tornadoDamageThreat: threat(p.tornadoDamageThreat),
    hazardFrom: usedCap && usedText ? 'cap+text' : usedCap ? 'cap' : usedText ? 'text' : 'none',
  };
}

/** PostgREST select aliases for the two stored numbers (the pattern of STAGE_SELECT). Added to every read that labels or draws a card. */
export const WEATHER_SELECT = 'maxHailSizeIn:data->>maxHailSizeIn,maxWindGustMph:data->>maxWindGustMph,hazardFrom:data->>hazardFrom';

/** A stored or flat-selected number ("1.75" from data->>, 1.75 from data). */
function storedNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The NWS event of an alert title ("Severe Thunderstorm Warning: Seward, NE" gives "Severe Thunderstorm Warning"). */
function eventOfTitle(title: string | null | undefined): string {
  const t = title ?? '';
  const at = t.indexOf(':');
  return at >= 0 ? t.slice(0, at) : t;
}

/** The source families whose records carry hail or gust facts. */
const STORM_SOURCES = new Set(['spc', 'lsr']);

/** "61 mph wind gust reported near X" gives 61 (the SPC and LSR title template). */
export function gustMphOfTitle(title: string | null | undefined): number | null {
  const m = /^(\d{2,3}) mph wind gust reported near /i.exec((title ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** "1.75 inch hail reported near X" gives 1.75. */
function hailOfTitle(title: string | null | undefined): number | null {
  const m = /^([\d.]+) inch hail reported near /i.exec((title ?? '').trim());
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface WeatherRow {
  source?: string | null;
  title?: string | null;
  summary?: string | null;
  /** Flat aliases from WEATHER_SELECT. */
  maxHailSizeIn?: unknown;
  maxWindGustMph?: unknown;
  /** Set on every alert stored since round 33: ingest already decided, so the text is never read again. */
  hazardFrom?: unknown;
  /** Or the whole data object (the matcher, the replay). */
  data?: Record<string, unknown> | null;
}

/**
 * The hail and gust facts the routing reads, or null when the switch is off or the record names neither. NWS: the stored CAP numbers, else
 * the alert text (rows stored before round 33). SPC and LSR: the size or gust in the report's own title.
 */
export function weatherFactsOf(row: WeatherRow | null | undefined, enabled: boolean = hailRoutingEnabled()): WeatherFacts | null {
  if (!enabled || !row) return null;
  const source = (row.source ?? '').trim().toLowerCase();
  let facts: WeatherFacts;
  if (source === 'nws') {
    const hail = storedNum(row.maxHailSizeIn ?? row.data?.maxHailSizeIn);
    const gust = storedNum(row.maxWindGustMph ?? row.data?.maxWindGustMph);
    const decided = typeof (row.hazardFrom ?? row.data?.hazardFrom) === 'string' || hail !== null || gust !== null;
    // A row stored before round 33 has no hazardFrom: its summary text is read, hail only for severe thunderstorm and tornado products.
    facts = decided ? { hailInches: hail, gustMph: gust } : hazardFromText(row.summary, eventOfTitle(row.title));
  } else if (STORM_SOURCES.has(source)) {
    facts = { hailInches: hailOfTitle(row.title), gustMph: gustMphOfTitle(row.title) };
  } else return null;
  return facts.hailInches !== null || facts.gustMph !== null ? facts : null;
}

/** The two numbers for a card, or nulls while the switch is off (surfaces call this on the server and pass the result to the card). */
export function weatherCardFields(row: WeatherRow | null | undefined, enabled: boolean = hailRoutingEnabled()): { alertHailIn: number | null; alertGustMph: number | null } {
  const source = (row?.source ?? '').trim().toLowerCase();
  const f = source === 'nws' ? weatherFactsOf(row, enabled) : null;
  return { alertHailIn: f?.hailInches ?? null, alertGustMph: f?.gustMph ?? null };
}
