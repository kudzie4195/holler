import { siteUrl } from '@/lib/env';
import type { CategoryId } from '../categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';

/**
 * NOAA Storm Prediction Center preliminary local storm reports (CSV).
 * Files: today_filtered_{torn,hail,wind}.csv and yesterday_filtered_{torn,hail,wind}.csv under
 * https://www.spc.noaa.gov/climo/reports/ (file names given in the task; column names sourced from
 * https://www.spc.noaa.gov/climo/reports/today.html).
 * Columns: Time(HHMM UTC), F_Scale|Size|Speed, Location, County, State, Lat, Lon, Comments.
 * Hail Size is in hundredths of an inch (100 = 1.00 in). Wind Speed is mph or UNK.
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

const TORNADO_CATS: CategoryId[] = ['roofing', 'restoration', 'tree-service', 'general-contractor', 'insurance', 'auto-body', 'auto-glass', 'electrical', 'junk-removal', 'painting'];
const HAIL_CATS: CategoryId[] = ['roofing', 'auto-glass', 'auto-body', 'restoration', 'insurance'];
const WIND_CATS: CategoryId[] = ['tree-service', 'roofing', 'restoration'];

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

export function parseSpc(raw: unknown): SignalInput[] {
  const r = raw as Partial<SpcInput> | null;
  if (!r || typeof r.csv !== 'string' || !r.type || !r.day) return [];
  const lines = r.csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iTime = idx(['time']);
  const iVal = idx(['size', 'speed', 'f_scale', 'fscale', 'f-scale']);
  const iLoc = idx(['location']);
  const iCounty = idx(['county']);
  const iState = idx(['state']);
  const iLat = idx(['lat']);
  const iLon = idx(['lon']);
  const iCom = idx(['comments']);
  if (iTime < 0 || iLoc < 0 || iState < 0 || iLat < 0 || iLon < 0) return [];

  const out: SignalInput[] = [];
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    // Comments is the last column and may contain commas: rejoin.
    const comments = iCom >= 0 ? c.slice(iCom).join(',').trim() : '';
    const coords = toCoords(c[iLat] ?? '', c[iLon] ?? '');
    const occurredAt = occurredIso(r.day, (c[iTime] ?? '').trim());
    if (!coords || !occurredAt) continue;
    const location = (c[iLoc] ?? '').trim();
    const county = (c[iCounty] ?? '').trim() || null;
    const state = (c[iState] ?? '').trim().toUpperCase() || null;
    const city = placeName(location) || null;
    const val = (iVal >= 0 ? c[iVal] : '')?.trim() ?? '';
    const where = `${location}${state ? `, ${state}` : ''}`;
    let title: string;
    let categories: CategoryId[];
    let severity: Severity;
    const data: Record<string, unknown> = { type: r.type, day: r.day, comments, value: val };

    if (r.type === 'hail') {
      const size = parseInt(val, 10);
      if (!Number.isFinite(size) || size < 100) continue; // below 1.00 in: not roof/auto-glass relevant
      const inches = size / 100;
      title = `${inches.toFixed(2)} inch hail reported near ${where}`;
      categories = HAIL_CATS;
      severity = inches >= 2 ? 3 : 2;
      data.hailInches = inches;
    } else if (r.type === 'wind') {
      const mph = parseInt(val, 10);
      const damage = /damage|down|blown|uproot|snapped|power|roof|tree/i.test(comments);
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

    out.push({
      source: 'spc',
      externalId: `${r.type}:${r.day}:${(c[iTime] ?? '').trim()}:${coords.lat.toFixed(2)}:${coords.lon.toFixed(2)}`,
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
  return out;
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
    const jobs: { name: string; type: SpcType; day: string }[] = [];
    for (const type of ['torn', 'hail', 'wind'] as SpcType[]) {
      jobs.push({ name: `today_filtered_${type}.csv`, type, day: convectiveDay(now, 0) });
      jobs.push({ name: `yesterday_filtered_${type}.csv`, type, day: convectiveDay(now, 1) });
    }
    const results = await Promise.all(
      jobs.map(async (j) => {
        try {
          const res = await ctx.fetch(BASE + j.name, {
            headers: { 'User-Agent': `Holler/1.0 (+${siteUrl}/about; contact@holler)` },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return { ok: true as const, signals: parseSpc({ csv: await res.text(), type: j.type, day: j.day }) };
        } catch (e) {
          ctx.log(`error: spc ${j.name} failed: ${e instanceof Error ? e.message : String(e)}`);
          return { ok: false as const, signals: [] as SignalInput[] };
        }
      }),
    );
    return results.flatMap((r) => r.signals);
  },
};

export const adapters: Adapter[] = [spcAdapter];
