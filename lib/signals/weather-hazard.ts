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
  /** Where the two numbers came from: the CAP parameters, the alert text, or nowhere. */
  hazardFrom: 'cap' | 'text' | null;
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
 * Hail size words the National Weather Service uses, in inches. Source: NWS Fort Worth hail size guide (weather.gov/fwd/hailsizeguide,
 * checked 2026-11-25). That guide lists half dollar with ping pong ball at 1.50; here half dollar is 1.25, because that is what the weather
 * service's own alert says for it (NWS Tulsa, 2025-05-18: "HAZARD...Half dollar size hail" with CAP maxHailSize 1.25, fixture
 * tests/fixtures/nws-cap/tulsa-svr-2025-05-18-upto-50mph.json). Only used when an alert has no CAP size.
 */
export const HAIL_SIZE_WORDS: ReadonlyArray<{ re: RegExp; inches: number }> = [
  { re: /\bpea\b/, inches: 0.25 },
  { re: /\bmarble\b/, inches: 0.5 },
  { re: /\bpenny\b/, inches: 0.75 },
  { re: /\bnickel\b/, inches: 0.88 },
  { re: /\bquarter\b/, inches: 1.0 },
  { re: /\bhalf dollar\b/, inches: 1.25 },
  { re: /\bping pong\b/, inches: 1.5 },
  { re: /\bgolf ?ball\b/, inches: 1.75 },
  { re: /\bhen egg\b|\begg\b/, inches: 2.0 },
  { re: /\btennis ball\b/, inches: 2.5 },
  { re: /\bbaseball\b/, inches: 2.75 },
  { re: /\bgrapefruit\b/, inches: 4.0 },
  { re: /\bsoftball\b/, inches: 4.5 },
];

/**
 * The largest hail and gust an alert's own TEXT names. For products without CAP parameters (High Wind Warning, Wind Advisory: "gusts up to
 * 75 mph expected") and rows stored before round 33. Reads only "N mph" next to "gust", and "N inch" or a size word next to "hail".
 */
export function hazardFromText(text: string | null | undefined): WeatherFacts {
  const t = (text ?? '').toLowerCase().replace(/\s+/g, ' ');
  let gust: number | null = null;
  const bump = (n: number) => {
    if (Number.isFinite(n) && n >= 1 && n <= 250 && (gust === null || n > gust)) gust = n;
  };
  // "gusts up to 75 mph", "gusts of 50 to 60 mph", "gusts to 70 mph", "gusts up to 70 to 75 mph", "gusts 50 to 60 mph"
  for (const m of t.matchAll(/gusts?(?: (?:up to|of|to|as high as|near|around|over|in excess of))? (\d{2,3})(?: (?:to|-) (\d{2,3}))? mph/g)) {
    bump(Number(m[1]));
    if (m[2]) bump(Number(m[2]));
  }
  // The severe thunderstorm HAZARD line: "60 mph wind gusts and quarter size hail".
  for (const m of t.matchAll(/(\d{2,3}) mph (?:wind )?gusts?/g)) bump(Number(m[1]));
  let hail: number | null = null;
  const bumpHail = (n: number) => {
    if (Number.isFinite(n) && n > 0 && n <= 8 && (hail === null || n > hail)) hail = n;
  };
  for (const m of t.matchAll(/(\d*\.\d+|\d+) ?(?:inch|in\.?)(?:es)? (?:diameter )?hail/g)) bumpHail(parseFloat(m[1]));
  // "Two inch hail" (the HAZARD line spells whole inches out).
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  for (const m of t.matchAll(/\b(one|two|three|four) inch(?:es)? hail/g)) bumpHail(WORDS[m[1]]);
  for (const m of t.matchAll(/hail (?:up to |of |to )?(\d*\.\d+|\d+) ?(?:inch|in\b)/g)) bumpHail(parseFloat(m[1]));
  for (const m of t.matchAll(/([a-z ]{3,20}?) size hail/g)) for (const w of HAIL_SIZE_WORDS) if (w.re.test(m[1])) bumpHail(w.inches);
  return { hailInches: hail, gustMph: gust };
}

/** CAP parameters to the stored fields; falls back to the alert text when the parameters name neither number. */
export function capHazardOf(parameters: unknown, text?: string | null): CapHazard {
  const p = (parameters && typeof parameters === 'object' ? parameters : {}) as Record<string, unknown>;
  const hail = parseHailSize(p.maxHailSize);
  const gust = parseWindGust(p.maxWindGust);
  const base = {
    hailThreat: threat(p.hailThreat),
    windThreat: threat(p.windThreat),
    tornadoDetection: threat(p.tornadoDetection),
    thunderstormDamageThreat: threat(p.thunderstormDamageThreat),
    tornadoDamageThreat: threat(p.tornadoDamageThreat),
  };
  if (hail !== null || gust !== null || p.maxHailSize !== undefined || p.maxWindGust !== undefined) {
    return { ...base, maxHailSizeIn: hail, maxWindGustMph: gust, hazardFrom: hail !== null || gust !== null ? 'cap' : null };
  }
  const t = hazardFromText(text);
  return { ...base, maxHailSizeIn: t.hailInches, maxWindGustMph: t.gustMph, hazardFrom: t.hailInches !== null || t.gustMph !== null ? 'text' : null };
}

/** PostgREST select aliases for the two stored numbers (the pattern of STAGE_SELECT). Added to every read that labels or draws a card. */
export const WEATHER_SELECT = 'maxHailSizeIn:data->>maxHailSizeIn,maxWindGustMph:data->>maxWindGustMph';

/** A stored or flat-selected number ("1.75" from data->>, 1.75 from data). */
function storedNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
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
    facts = hail !== null || gust !== null ? { hailInches: hail, gustMph: gust } : hazardFromText(row.summary);
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

/** "1.75", "1", "0.88": the size as the alert writes it, without trailing zeros past the hundredths. */
export function inchesText(n: number): string {
  return String(Math.round(n * 100) / 100);
}
