import { siteUrl } from '@/lib/env';
import type { CategoryId } from '../categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';

/**
 * NOAA Storm Prediction Center preliminary local storm reports (CSV).
 * Files under https://www.spc.noaa.gov/climo/reports/ :
 *   today_filtered_{torn,hail,wind}.csv and yesterday_filtered_{torn,hail,wind}.csv  (per hazard; torn confirmed by
 *     clearspot.me/en/blog/spc-tornado-csv-reports which names today_filtered_torn.csv; hail/wind follow the same pattern, unconfirmed),
 *   today_filtered.csv and yesterday_filtered.csv (all hazards in ONE file, confirmed by pynimbus.readthedocs.io/en/latest/tutorials/stormreports.html),
 *   YYMMDD_rpts_filtered.csv (same layout, confirmed by github.com/GateHouseMedia/tornado-tools and apify.com/bigsky-data-tools).
 * Combined files hold one section per hazard, each section starting with its own header row (a row whose Time cell is "Time"),
 * in the order tornado, wind, hail (github.com/WxBDM/PyNimbus PyNimbus/spcreports.py, github.com/GateHouseMedia/tornado-tools gettornadoes.py).
 * Columns (spc.noaa.gov/climo/reports/today.html table headings): Time (HHMM UTC), F_Scale | Speed | Size, Location, County, State, Lat, Lon, Comments.
 * Hail Size is in hundredths of an inch (dev.to/wishbone_data hail article); Wind Speed is mph or UNK.
 * Lat/Lon in the CSV are signed decimal degrees (apify.com/bigsky-data-tools output 35.96,-94.87; PyNimbus plots the raw floats). The HTML page
 * prints hundredths-of-degree integers (3814, 9148), which toCoords still accepts.
 * The raw .csv files themselves are robots-blocked for WebFetch, so no verbatim file capture exists (see tests/signals/core/adapters.test.ts header).
 * A report "day" runs 1200 UTC to 1159 UTC the next day.
 */
export type SpcType = 'torn' | 'hail' | 'wind';
export interface SpcInput {
  csv: string;
  type: SpcType;
  /** Convective day start date, YYYY-MM-DD (the UTC date of the 1200Z start). */
  day: string;
}

const BASE = 'https://www.spc.noaa.gov/climo/reports/';

export const TORNADO_CATS: CategoryId[] = ['roofing', 'restoration', 'tree-service', 'general-contractor', 'insurance', 'public-adjuster', 'auto-body', 'auto-glass', 'electrical', 'junk-removal', 'painting'];
export const HAIL_CATS: CategoryId[] = ['roofing', 'auto-glass', 'auto-body', 'restoration', 'insurance', 'public-adjuster'];
// Wind and hail damage is what insurance claims and public adjusters are filed for.
export const WIND_CATS: CategoryId[] = ['tree-service', 'roofing', 'restoration', 'insurance', 'public-adjuster'];

/**
 * Words in a wind report's remarks that describe damage ("trees down", "roof blown off", "power lines snapped"). A wind report with one of
 * them is a wind-DAMAGE report (lib/lists reads the same test); the damage to any one property is still not confirmed.
 */
export const WIND_DAMAGE_RE = /damage|down|blown|uproot|snapped|power|roof|tree/i;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function toCoords(latRaw: string, lonRaw: string): { lat: number; lon: number } | null {
  let lat = parseFloat(latRaw);
  let lon = parseFloat(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Tolerate both decimal degrees and hundredths-of-degree integers (as printed on the HTML report page).
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { lat /= 100; lon /= 100; }
  if (lon > 0) lon = -lon; // all reports are western hemisphere
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function occurredIso(day: string, hhmm: string): string | null {
  if (!/^\d{3,4}$/.test(hhmm)) return null;
  const t = hhmm.padStart(4, '0');
  const hh = parseInt(t.slice(0, 2), 10);
  const mm = parseInt(t.slice(2), 10);
  if (hh > 23 || mm > 59) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (hh < 12) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString();
}

function placeName(location: string): string {
  // "2 ESE Longview" -> "Longview"
  return location.replace(/^\d+(\.\d+)?\s+[NSEW]{1,3}\s+/i, '').trim();
}

function reportUrl(day: string): string {
  const [y, m, d] = day.split('-');
  return `${BASE}${y.slice(2)}${m}${d}_rpts.html`;
}

function sectionType(header: string[], fallback: SpcType): SpcType {
  if (header.includes('f_scale') || header.includes('fscale') || header.includes('f-scale')) return 'torn';
  if (header.includes('speed')) return 'wind';
  if (header.includes('size')) return 'hail';
  return fallback;
}

/** Row counts for the silent-empty check: rows = data rows seen, usable = rows with a time and coordinates. */
export interface SpcScan {
  signals: SignalInput[];
  rows: number;
  usable: number;
  /** false when text was present but no recognisable header row (HTML error page, renamed columns). */
  headerOk: boolean;
}

export function scanSpc(raw: unknown): SpcScan {
  const empty: SpcScan = { signals: [], rows: 0, usable: 0, headerOk: true };
  const r = raw as Partial<SpcInput> | null;
  if (!r || typeof r.csv !== 'string' || !r.type || !r.day) return empty;
  const lines = r.csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return empty;

  const res: SpcScan = { signals: [], rows: 0, usable: 0, headerOk: false };
  let cols: { type: SpcType; iTime: number; iVal: number; iLoc: number; iCounty: number; iState: number; iLat: number; iLon: number; iCom: number } | null = null;

  for (const line of lines) {
    const c = parseCsvLine(line);
    if ((c[0] ?? '').trim().toLowerCase() === 'time') {
      // Header row: the first line of a per-hazard file, or the start of each section in a combined file.
      const header = c.map((h) => h.trim().toLowerCase());
      const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
      const next = {
        type: sectionType(header, r.type),
        iTime: idx(['time']),
        iVal: idx(['size', 'speed', 'f_scale', 'fscale', 'f-scale']),
        iLoc: idx(['location']),
        iCounty: idx(['county']),
        iState: idx(['state']),
        iLat: idx(['lat']),
        iLon: idx(['lon']),
        iCom: idx(['comments']),
      };
      cols = next.iLoc < 0 || next.iState < 0 || next.iLat < 0 || next.iLon < 0 ? null : next;
      if (cols) res.headerOk = true;
      continue;
    }
    if (!cols) continue; // data before any valid header
    res.rows++;
    const { type, iTime, iVal, iLoc, iCounty, iState, iLat, iLon, iCom } = cols;
    // Comments is the last column and may contain commas: rejoin.
    const comments = iCom >= 0 ? c.slice(iCom).join(',').trim() : '';
    const coords = toCoords(c[iLat] ?? '', c[iLon] ?? '');
    const occurredAt = occurredIso(r.day, (c[iTime] ?? '').trim());
    if (!coords || !occurredAt) continue;
    res.usable++;
    const location = (c[iLoc] ?? '').trim();
    const county = (c[iCounty] ?? '').trim() || null;
    const state = (c[iState] ?? '').trim().toUpperCase() || null;
    const city = placeName(location) || null;
    const val = (iVal >= 0 ? c[iVal] : '')?.trim() ?? '';
    const where = `${location}${state ? `, ${state}` : ''}`;
    let title: string;
    let categories: CategoryId[];
    let severity: Severity;
    const data: Record<string, unknown> = { type, day: r.day, comments, value: val };

    if (type === 'hail') {
      const size = parseInt(val, 10);
      if (!Number.isFinite(size) || size < 100) continue; // below 1.00 in: not roof/auto-glass relevant
      const inches = size / 100;
      title = `${inches.toFixed(2)} inch hail reported near ${where}`;
      categories = HAIL_CATS;
      severity = inches >= 2 ? 3 : 2;
      data.hailInches = inches;
    } else if (type === 'wind') {
      const mph = parseInt(val, 10);
      const damage = WIND_DAMAGE_RE.test(comments);
      if (!Number.isFinite(mph) && !damage) continue;
      if (Number.isFinite(mph) && mph < 50 && !damage) continue;
      title = Number.isFinite(mph) ? `${mph} mph wind gust reported near ${where}` : `Wind damage reported near ${where}`;
      categories = WIND_CATS;
      severity = Number.isFinite(mph) && mph >= 75 ? 3 : (Number.isFinite(mph) && mph >= 58) || damage ? 2 : 1;
      if (Number.isFinite(mph)) data.windMph = mph;
    } else {
      title = `Tornado reported near ${where}`;
      categories = TORNADO_CATS;
      severity = 3;
      if (val && val !== 'UNK') data.fScale = val;
    }

    res.signals.push({
      source: 'spc',
      externalId: `${type}:${r.day}:${(c[iTime] ?? '').trim()}:${coords.lat.toFixed(2)}:${coords.lon.toFixed(2)}`,
      kind: 'report',
      title,
      summary: comments || null,
      url: reportUrl(r.day),
      lat: coords.lat,
      lon: coords.lon,
      city,
      state,
      county,
      categories,
      severity,
      occurredAt,
      data,
    });
  }
  return res;
}

export function parseSpc(raw: unknown): SignalInput[] {
  return scanSpc(raw).signals;
}

function convectiveDay(now: Date, daysBack: number): string {
  const d = new Date(now.getTime() - 12 * 3600_000 - daysBack * 86400_000);
  return d.toISOString().slice(0, 10);
}

export const spcAdapter: Adapter = {
  id: 'spc',
  label: 'NOAA Storm Prediction Center storm reports',
  kind: 'report',
  cadenceMinutes: 30,
  sourceUrl: 'https://www.spc.noaa.gov/climo/reports/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    const now = new Date();
    const ua = `Holler/1.0 (+${siteUrl}/about; contact@holler)`;

    /** One CSV file: fetch, validate, parse. Returns null when the file could not be used (an error was logged). */
    async function load(name: string, type: SpcType, day: string): Promise<SignalInput[] | null> {
      try {
        const res = await ctx.fetch(BASE + name, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const csv = await res.text();
        const scan = scanSpc({ csv, type, day });
        if (csv.trim() && !scan.headerOk) {
          throw new Error(/^\s*</.test(csv) ? 'received an HTML page instead of CSV' : 'no recognisable header row (Time,...,Lat,Lon), columns may have changed');
        }
        if (scan.rows > 0 && scan.usable === 0) ctx.log(`error: spc ${name} parsed 0 of ${scan.rows} rows, shape may have changed`);
        return scan.signals;
      } catch (e) {
        ctx.log(`error: spc ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }

    const out: SignalInput[] = [];
    for (const [prefix, daysBack] of [['today', 0], ['yesterday', 1]] as const) {
      const day = convectiveDay(now, daysBack);
      const perType = await Promise.all((['torn', 'hail', 'wind'] as SpcType[]).map((t) => load(`${prefix}_filtered_${t}.csv`, t, day)));
      if (perType.every((r) => r === null)) {
        // Per-hazard file names are only partly confirmed; the combined file name is documented by PyNimbus.
        const combined = await load(`${prefix}_filtered.csv`, 'torn', day);
        if (combined) out.push(...combined);
        continue;
      }
      for (const r of perType) if (r) out.push(...r);
    }
    return out;
  },
};

export const adapters: Adapter[] = [spcAdapter];
