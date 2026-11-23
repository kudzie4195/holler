import { siteUrl } from '@/lib/env';
import type { CategoryId } from '../categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';
import { countiesFromSame } from '@/lib/geo/county';

/**
 * National Weather Service active alerts.
 * Endpoint: https://api.weather.gov/alerts/active (GeoJSON FeatureCollection, CAP-derived properties).
 * Request (confirmed 2026-11-17): weather.gov/documentation/services-web-api (User-Agent required, /alerts/active, filters) and the
 * OpenAPI query parameters status=actual|test|..., message_type=alert|update|cancel (alex-gekas.github.io/nws-api-reference/endpoints/alerts).
 * Response (confirmed 2026-11-17 against two independent schema/sample sources: apis.io/schemas/weather-gov/weather-gov-alert and
 * the sample on fastcrw.com/playground/pergamon/weathergov): feature.id is the https://api.weather.gov/alerts/urn:oid:... URL,
 * properties has "@id", "@type", id (urn:oid:...), areaDesc, geocode{SAME[],UGC[]}, affectedZones, references, sent, effective,
 * onset (nullable), expires, ends (nullable), status, messageType, category, severity, certainty, urgency, event, sender, senderName,
 * headline (nullable), description, instruction (nullable), response, parameters, geometry is null for most zone-based alerts.
 * api.weather.gov itself refuses automated fetch (robots), so a raw live capture was not possible from the sandbox.
 */
export const NWS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';

type Level = 'warning' | 'watch' | 'advisory';

export interface Rule {
  re: RegExp;
  categories: CategoryId[];
  /** severity per alert level */
  sev: Record<Level, Severity>;
}

// Order matters: first match wins.
export const NWS_RULES: Rule[] = [
  { re: /^tornado/i, categories: ['roofing', 'restoration', 'tree-service', 'general-contractor', 'insurance', 'public-adjuster', 'auto-body', 'electrical', 'junk-removal'], sev: { warning: 3, watch: 2, advisory: 1 } },
  { re: /hurricane|tropical storm|typhoon|storm surge/i, categories: ['roofing', 'tree-service', 'restoration', 'general-contractor', 'insurance', 'public-adjuster', 'electrical', 'towing', 'junk-removal'], sev: { warning: 3, watch: 2, advisory: 1 } },
  { re: /severe thunderstorm/i, categories: ['roofing', 'tree-service', 'restoration', 'insurance', 'public-adjuster'], sev: { warning: 2, watch: 1, advisory: 1 } },
  // A flood advisory or statement is minor (a stream above its banks): clean-up and claims, not a plumber. Warnings keep plumbing (back-ups, sump pumps).
  { re: /flood advisory|flood statement/i, categories: ['restoration', 'junk-removal', 'towing', 'auto-repair', 'insurance', 'public-adjuster'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /flash flood|flood/i, categories: ['restoration', 'plumbing', 'junk-removal', 'towing', 'auto-repair', 'insurance', 'public-adjuster'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /ice storm/i, categories: ['tree-service', 'electrical', 'snow-removal', 'towing', 'hvac'], sev: { warning: 3, watch: 2, advisory: 1 } },
  { re: /blizzard|winter storm|lake effect snow|heavy snow|snow squall|winter weather/i, categories: ['snow-removal', 'towing', 'hvac', 'tree-service', 'plumbing'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /extreme cold|wind chill|cold weather|arctic/i, categories: ['hvac', 'plumbing', 'towing', 'snow-removal'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /freeze|frost/i, categories: ['plumbing', 'hvac', 'landscaping', 'pool-spa', 'public-adjuster'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /heat/i, categories: ['hvac', 'pool-spa', 'electrical'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /high wind|extreme wind|wind advisory|^wind/i, categories: ['tree-service', 'roofing', 'restoration', 'electrical'], sev: { warning: 2, watch: 1, advisory: 1 } },
  { re: /red flag|fire weather|wildfire|fire warning/i, categories: ['restoration', 'tree-service', 'landscaping', 'insurance'], sev: { warning: 2, watch: 1, advisory: 1 } },
];

/** A zone alert is placed by county only at this severity or higher (the floor the state-level match always had), so advisories stay quiet. */
export const COUNTY_MIN_SEVERITY = 2;
/**
 * No cap on the counties one alert becomes. The largest state has 254 counties (Texas), and an alert that lists them all must reach a member in
 * any of them: a cap silently dropped the counties past the 150th (round 15 re-review). The matcher delivers one alert once per member (alertId), so
 * the extra rows cost storage only.
 */

/** Added to a severe thunderstorm alert whose text reports damaging hail. */
export const NWS_HAIL_EXTRA: CategoryId[] = ['auto-body', 'auto-glass'];

function levelOf(event: string): Level {
  if (/warning|emergency/i.test(event)) return 'warning';
  if (/watch/i.test(event)) return 'watch';
  return 'advisory';
}

/**
 * Boating products that NWS issues for LAND zones (so the marine-zone test cannot catch them): a "Lake Wind Advisory" warns small
 * boats on inland lakes, not homes (review r1 P2).
 */
export const BOATING_EVENT_RE = /^\s*lake\s+wind\b/i;

export function ruleFor(event: string): Rule | undefined {
  if (BOATING_EVENT_RE.test(event)) return undefined;
  return NWS_RULES.find((r) => r.re.test(event));
}

type Pos = [number, number];

function ringCentroid(ring: Pos[]): { lat: number; lon: number; area: number } | null {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length === 0) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { lat, lon, area: 0 };
  }
  const area = a / 2;
  return { lon: cx / (6 * area), lat: cy / (6 * area), area: Math.abs(area) };
}

/** Area-weighted centroid of a GeoJSON Polygon or MultiPolygon (outer rings). Returns null when absent/invalid. */
export function geometryCentroid(geometry: unknown): { lat: number; lon: number } | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  let rings: Pos[][] = [];
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    rings = [((g.coordinates as Pos[][])[0] ?? []) as Pos[]];
  } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    rings = (g.coordinates as Pos[][][]).map((p) => (p[0] ?? []) as Pos[]);
  } else return null;
  let totalArea = 0;
  let lat = 0;
  let lon = 0;
  const fallback: { lat: number; lon: number }[] = [];
  for (const ring of rings) {
    const c = ringCentroid(ring);
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    fallback.push(c);
    const w = c.area || 1e-9;
    totalArea += w;
    lat += c.lat * w;
    lon += c.lon * w;
  }
  if (!fallback.length || totalArea === 0) return null;
  const out = { lat: lat / totalArea, lon: lon / totalArea };
  if (Math.abs(out.lat) > 90 || Math.abs(out.lon) > 180) return null;
  return out;
}

/**
 * USPS codes of the 50 states, DC and the territories NWS issues land zones for. NWS also writes UGC codes for MARINE zones whose two
 * letters are not a state (AM, AN, GM, LC, LE, LH, LM, LO, LS, PH, PK, PM, PS, PZ, SL, and so on). Those must never become a signal's state.
 */
export const LAND_STATE_CODES: ReadonlySet<string> = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY ' +
    'PR VI GU AS MP').split(' '),
);

/** States from UGC codes such as "GAZ045" (zone) or "GAC121" (county). Marine zone prefixes (PKZ, GMZ, LMZ ...) are not states and are skipped. */
export function statesFromUgc(ugc: unknown): string[] {
  if (!Array.isArray(ugc)) return [];
  const out: string[] = [];
  for (const u of ugc) {
    const m = typeof u === 'string' ? /^([A-Z]{2})[ZC]\d{3}$/.exec(u) : null;
    if (m && LAND_STATE_CODES.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** True when the alert names UGC zones and every one of them is a marine zone (no land state at all): boating products such as "Brisk Wind Advisory". */
export function isMarineOnly(ugc: unknown): boolean {
  if (!Array.isArray(ugc)) return false;
  let zones = 0;
  for (const u of ugc) if (typeof u === 'string' && /^[A-Z]{2}[ZC]\d{3}$/.test(u)) zones++;
  return zones > 0 && statesFromUgc(ugc).length === 0;
}

/** Fallback: trailing ", ST" tokens in areaDesc, e.g. "Fulton; DeKalb, GA". */
function statesFromAreaDesc(areaDesc: string): string[] {
  const out: string[] = [];
  for (const m of areaDesc.matchAll(/,\s*([A-Z]{2})(?=\s*(?:;|$))/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
}

function iso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseNws(raw: unknown): SignalInput[] {
  const features = (raw as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: SignalInput[] = [];
  for (const f of features) {
    const feat = f as { id?: string; geometry?: unknown; properties?: Record<string, unknown> };
    const p = feat?.properties;
    if (!p) continue;
    const event = typeof p.event === 'string' ? p.event : '';
    const rule = event ? ruleFor(event) : undefined;
    if (!rule) continue; // marine, air quality, statements etc. are not actionable for trades
    if (typeof p.status === 'string' && p.status !== 'Actual') continue;
    if (p.messageType === 'Cancel') continue;

    const id = (typeof p.id === 'string' && p.id) || (typeof feat.id === 'string' && feat.id) || '';
    if (!id) continue;
    // Live shape: properties.id is "urn:oid:..."; the https URL is the feature-level id and properties["@id"].
    const link = [feat.id, p['@id'], p.id].find((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v)) ?? null;
    const level = levelOf(event);
    let severity: Severity = rule.sev[level];
    if (p.severity === 'Extreme' && severity < 3 && level === 'warning') severity = 3;
    if (/emergency/i.test(event)) severity = 3;

    const categories = [...rule.categories];
    const description = typeof p.description === 'string' ? p.description : '';
    if (/severe thunderstorm/i.test(event) && /\b(1|1\.\d+|2|2\.\d+)\s*(inch|in)\b[^.]{0,20}hail|hail[^.]{0,40}\b(1|1\.\d+|2|2\.\d+)\s*(inch|in)\b|quarter size|golf ball|baseball|tennis ball|ping pong/i.test(description)) {
      categories.push(...NWS_HAIL_EXTRA);
    }

    const areaDesc = typeof p.areaDesc === 'string' ? p.areaDesc : '';
    const geoCode = (p.geocode as { UGC?: unknown } | undefined)?.UGC;
    if (isMarineOnly(geoCode)) continue; // a boating product (Brisk Wind Advisory, Flood on a coastal marine zone only) is not a land lead
    let states = statesFromUgc(geoCode);
    if (!states.length) states = statesFromAreaDesc(areaDesc);
    const centroid = geometryCentroid(feat.geometry);
    const counties = centroid ? [] : countiesFromSame((p.geocode as { SAME?: unknown } | undefined)?.SAME);

    const occurredAt = iso(p.onset) ?? iso(p.effective) ?? iso(p.sent) ?? new Date().toISOString();
    const expiresAt = iso(p.ends) ?? iso(p.expires);
    const headline = typeof p.headline === 'string' ? p.headline : '';
    const shortArea = clip(areaDesc, 90);
    const base = {
      source: 'nws',
      kind: 'alert' as const,
      title: shortArea ? `${event}: ${shortArea}` : event,
      summary: clip(headline && description ? `${headline}. ${description}` : headline || description, 320) || null,
      url: link,
      categories,
      severity,
      occurredAt,
      expiresAt,
    };
    const data = {
      event,
      nwsSeverity: p.severity ?? null,
      urgency: p.urgency ?? null,
      certainty: p.certainty ?? null,
      areaDesc,
      senderName: p.senderName ?? null,
      states,
      hasGeometry: !!centroid,
    };

    if (centroid) {
      out.push({ ...base, externalId: id, lat: centroid.lat, lon: centroid.lon, state: states[0] ?? null, data });
    } else if (counties.length && severity >= COUNTY_MIN_SEVERITY) {
      // No polygon, but the alert names its counties (SAME codes, always present): one point per county at the county centroid, matched
      // by radius like any other alert. The point is a stand-in for a county, so it carries data.loc = 'approx' (reach plus a county's
      // slack, no distance shown) and the same data.alertId, which lets a member who sits between two counties of one alert get it once.
      for (const c of counties) {
        out.push({
          ...base,
          externalId: `${id}#${c.fips}`,
          lat: c.lat,
          lon: c.lon,
          state: c.state,
          data: { ...data, loc: 'approx', countyFips: c.fips, alertId: id },
        });
      }
    } else if (states.length) {
      // No geometry and no county (or a minor alert): one state-level signal per state. The matcher never matches these by state (a
      // zone alert is not statewide), so they are kept as history only.
      for (const st of states.slice(0, 8)) {
        out.push({ ...base, externalId: states.length > 1 ? `${id}#${st}` : id, state: st, data });
      }
    } else {
      out.push({ ...base, externalId: id, data });
    }
  }
  return out;
}

/** Structural counts used by the silent-empty check: rows that carry an event name and an id. */
export function nwsRowStats(raw: unknown): { rows: number; usable: number } | null {
  const features = (raw as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return null;
  let usable = 0;
  for (const f of features) {
    const feat = f as { id?: unknown; properties?: Record<string, unknown> } | null;
    const p = feat?.properties;
    if (p && typeof p.event === 'string' && (typeof p.id === 'string' || typeof feat?.id === 'string')) usable++;
  }
  return { rows: features.length, usable };
}

/** Reads a body as JSON and turns an HTML or other non-JSON page into a clear error. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(/^\s*</.test(text) ? 'expected JSON but received an HTML page' : 'expected JSON but received non-JSON text');
  }
}

export function nwsUserAgent(): string {
  return `Holler/1.0 (+${siteUrl}/about; contact@holler)`;
}

export const nwsAdapter: Adapter = {
  id: 'nws',
  label: 'National Weather Service alerts',
  kind: 'alert',
  cadenceMinutes: 15,
  sourceUrl: 'https://www.weather.gov/alerts',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    try {
      const res = await ctx.fetch(NWS_URL, {
        headers: { 'User-Agent': nwsUserAgent(), Accept: 'application/geo+json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 || res.status === 429 ? ' (User-Agent rejected or rate limited)' : ''}`);
      const json = await readJson(res);
      const stats = nwsRowStats(json);
      if (!stats) {
        const keys = json && typeof json === 'object' ? Object.keys(json as object).slice(0, 8).join(',') : typeof json;
        ctx.log(`error: nws response has no features array, wrapper may have changed (top-level keys: ${keys})`);
        return [];
      }
      const out = parseNws(json);
      if (stats.rows > 0 && stats.usable === 0) ctx.log(`error: parsed 0 of ${stats.rows} rows, shape may have changed`);
      else if (out.length === 0 && stats.rows >= 50) ctx.log(`error: parsed 0 of ${stats.rows} rows, shape may have changed (no row matched a known event type)`);
      return out;
    } catch (e) {
      ctx.log(`error: nws fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [nwsAdapter];
