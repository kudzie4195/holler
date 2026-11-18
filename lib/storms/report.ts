import { stateByCode } from '@/lib/geo';
import { localDate, localTime, longDate, zoneFor } from './zones';

/**
 * Storm reports built only from holler_signals rows of two sources: 'spc' (NOAA Storm Prediction Center preliminary storm reports)
 * and 'fema' (OpenFEMA disaster declarations). NWS alerts are not used: an alert row has a state or a polygon centre but no county,
 * so it cannot be placed in a county on a day without guessing.
 *
 * Privacy: the input row type has no title, summary, remarks, coordinates or ids. The adapter keeps SPC "Comments" in `summary`
 * and `data.comments` (lib/signals/adapters/spc.ts), and that field is free text typed by a spotter or an agency, so it can hold a name
 * or a phone number. Nothing here reads it, and the loader never selects it. Places are shown at county or city level only, and a
 * city string is shown only if it looks like a plain place name (see cleanPlace).
 */

export const MIN_SPC_REPORTS = 3;
export const WINDOW_DAYS = 60;

export type RecordType = 'tornado' | 'hail' | 'wind' | 'declaration';
export type ReportKind = 'county' | 'city' | 'state';

/** The only columns the loader selects. */
export interface StormRow {
  source: string;
  state: string | null;
  county: string | null;
  city: string | null;
  url: string | null;
  occurred_at: string;
  created_at?: string | null;
  /** data->>type for SPC: torn, hail or wind */
  type?: string | null;
  /** data->>hailInches */
  hail?: string | number | null;
  /** data->>windMph */
  wind?: string | number | null;
  /** data->>incidentType for FEMA */
  incident?: string | null;
  /** data->>declarationType for FEMA */
  decl?: string | null;
  /** data->>disasterNumber for FEMA */
  disaster?: string | number | null;
  /** data->counties for FEMA (array of designated county names) */
  counties?: unknown;
}

export interface StormRecord {
  type: RecordType;
  /** ISO time of the report (FEMA: the declaration date at 00:00 UTC) */
  at: string;
  /** Preformatted local time, "3:12 PM EST"; empty for FEMA, which has a date and no time */
  timeLabel: string;
  place: string;
  detail: string | null;
  /** Official page for the record, or null when the stored link is not on an allowed official host */
  url: string | null;
  source: 'spc' | 'fema';
}

export interface StormReport {
  state: string;
  stateName: string;
  kind: ReportKind;
  /** "Cobb County", "Marietta", or the state name for a FEMA declaration */
  name: string;
  /** "Cobb County, GA" */
  place: string;
  /** YYYY-MM-DD, local date in the state's main zone (FEMA: the declaration date) */
  date: string;
  dateLabel: string;
  slug: string;
  zone: string;
  counts: { tornado: number; hail: number; wind: number };
  spcTotal: number;
  declarations: number;
  largestHailIn: number | null;
  peakWindMph: number | null;
  firstAt: string | null;
  lastAt: string | null;
  firstLabel: string | null;
  lastLabel: string | null;
  /** newest created_at among the records: the real time this page's data last changed */
  modifiedAt: string | null;
  records: StormRecord[];
  qualifies: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Names and slugs

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ROADISH = /\b(street|rd|road|ave|avenue|blvd|boulevard|hwy|highway|fwy|freeway|interstate|pkwy|parkway|mile|mm|exit|apt|suite|po box)\b|\bI-\d|\bUS-?\d|\bSR-?\d/i;

/** A place string is shown only when it is a plain name: letters, spaces and . ' - only, no digits, no road words. */
export function cleanPlace(raw: string | null | undefined): string | null {
  // SPC prints "2 ESE Longview": keep the place, drop the leading distance and direction.
  const s = (raw ?? '').replace(/\s+/g, ' ').trim().replace(/^\d+(\.\d+)?\s+[NSEW]{1,3}\s+/i, '').trim();
  if (!s || s.length > 40) return null;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(s)) return null;
  if (ROADISH.test(s)) return null;
  // SPC prints names in capitals sometimes ("COBB"): title-case them.
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : s;
}

/** "Cobb" -> "Cobb County"; "Orleans" in LA -> "Orleans Parish"; a name that already says county, parish, borough or city is kept. */
export function countyLabel(name: string, state: string): string {
  if (/\b(county|parish|borough|city|municipality|municipio)$/i.test(name)) return name;
  if (state === 'LA') return `${name} Parish`;
  if (state === 'AK') return `${name} Borough`;
  return `${name} County`;
}

const DATE_TAIL = /^(.*[a-z0-9])-(\d{4}-\d{2}-\d{2})$/;

export function buildSlug(base: string, date: string): string {
  return `${slugify(base)}-${date}`;
}

/** Split "cobb-county-2026-11-14" into its parts. Returns null for anything else, including impossible dates. */
export function parseSlug(slug: string): { base: string; date: string } | null {
  if (typeof slug !== 'string' || slug.length > 120) return null;
  const m = DATE_TAIL.exec(slug);
  if (!m) return null;
  const [, base, date] = m;
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(base)) return null;
  return { base, date };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows to reports

const OFFICIAL_HOSTS = new Set(['spc.noaa.gov', 'www.spc.noaa.gov', 'fema.gov', 'www.fema.gov']);

export function officialUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Origin and path only: a query string or fragment can carry anything.
    return u.protocol === 'https:' && OFFICIAL_HOSTS.has(u.hostname) ? `${u.origin}${u.pathname}` : null;
  } catch {
    return null;
  }
}

/**
 * FEMA incidentType values the page admits, exact match after trim and lowercasing. The value printed is the label here, never the row's own
 * text, so a free-text or hostile incidentType cannot reach the page. Anything else (fire, biological, a string that merely contains "storm") is dropped.
 */
const STORM_INCIDENTS: ReadonlyMap<string, string> = new Map([
  ['severe storm', 'severe storm'],
  ['severe storm(s)', 'severe storm'],
  ['tornado', 'tornado'],
  ['hurricane', 'hurricane'],
  ['flood', 'flood'],
  ['snowstorm', 'snowstorm'],
  ['snow', 'snow'],
  ['severe ice storm', 'severe ice storm'],
  ['coastal storm', 'coastal storm'],
  ['tropical storm', 'tropical storm'],
  ['typhoon', 'typhoon'],
  ['winter storm', 'winter storm'],
  ['straight-line winds', 'straight-line winds'],
]);

export function stormIncidentLabel(raw: unknown): string | null {
  return typeof raw === 'string' ? (STORM_INCIDENTS.get(raw.trim().toLowerCase()) ?? null) : null;
}

/** "DR" and "EM" are the only declaration types printed; the row's own text is never shown. */
export function declarationLabel(raw: unknown): { code: 'DR' | 'EM' | null; label: string } {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (code === 'DR') return { code: 'DR', label: 'Major disaster declaration' };
  if (code === 'EM') return { code: 'EM', label: 'Emergency declaration' };
  return { code: null, label: 'Disaster declaration' };
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const SPC_TYPES: Record<string, RecordType> = { torn: 'tornado', hail: 'hail', wind: 'wind' };

interface Group {
  state: string;
  kind: ReportKind;
  name: string;
  date: string;
  zone: string;
  records: StormRecord[];
  hail: number[];
  wind: number[];
  modified: number;
}

export function buildReports(rows: readonly StormRow[]): StormReport[] {
  const groups = new Map<string, Group>();

  const add = (g: { state: string; kind: ReportKind; name: string; date: string; zone: string }, rec: StormRecord, created: string | null | undefined) => {
    const key = `${g.state}|${g.kind}|${slugify(g.name)}|${g.date}`;
    let grp = groups.get(key);
    if (!grp) {
      grp = { ...g, records: [], hail: [], wind: [], modified: 0 };
      groups.set(key, grp);
    }
    grp.records.push(rec);
    const c = created ? Date.parse(created) : NaN;
    if (Number.isFinite(c) && c > grp.modified) grp.modified = c;
    return grp;
  };

  for (const row of rows) {
    const state = (row.state ?? '').trim().toUpperCase();
    const zone = zoneFor(state);
    const st = stateByCode(state);
    if (!zone || !st || !Number.isFinite(Date.parse(row.occurred_at))) continue;

    if (row.source === 'spc') {
      const type = SPC_TYPES[row.type ?? ''];
      if (!type) continue;
      const county = cleanPlace(row.county);
      const city = cleanPlace(row.city);
      const date = localDate(row.occurred_at, zone);
      if (!date) continue;
      const kind: ReportKind = county ? 'county' : 'city';
      const name = county ? countyLabel(county, state) : city;
      if (!name) continue;
      let detail: string | null = null;
      const hail = type === 'hail' ? num(row.hail) : null;
      const wind = type === 'wind' ? num(row.wind) : null;
      if (hail !== null && hail > 0 && hail <= 10) detail = `${hail.toFixed(2)} in`;
      else if (wind !== null && wind > 0 && wind < 300) detail = `${Math.round(wind)} mph`;
      const where = county && city && slugify(city) !== slugify(county) ? `${city}, ${name}` : name;
      const grp = add(
        { state, kind, name, date, zone },
        { type, at: new Date(row.occurred_at).toISOString(), timeLabel: localTime(row.occurred_at, zone), place: where, detail, url: officialUrl(row.url), source: 'spc' },
        row.created_at,
      );
      if (hail !== null && hail > 0 && hail <= 10) grp.hail.push(hail);
      if (wind !== null && wind > 0 && wind < 300) grp.wind.push(wind);
    } else if (row.source === 'fema') {
      const incident = stormIncidentLabel(row.incident);
      if (!incident) continue;
      // FEMA stores the declaration date as midnight UTC. It is a calendar date, so the UTC date is the date.
      const date = new Date(row.occurred_at).toISOString().slice(0, 10);
      const rawDis = num(row.disaster);
      const dis = rawDis !== null && Number.isInteger(rawDis) && rawDis > 0 && rawDis < 1_000_000 ? rawDis : null;
      const areas = Array.isArray(row.counties) ? row.counties.length : 0;
      const { code, label } = declarationLabel(row.decl);
      const detail = `${label}${code && dis !== null ? ` ${code}-${dis}` : ''}, ${incident}${areas ? `, ${areas} designated ${areas === 1 ? 'area' : 'areas'}` : ', statewide'}`;
      add(
        { state, kind: 'state', name: st.name, date, zone },
        { type: 'declaration', at: new Date(row.occurred_at).toISOString(), timeLabel: '', place: st.name, detail, url: officialUrl(row.url), source: 'fema' },
        row.created_at,
      );
    }
  }

  const out: StormReport[] = [];
  const usedSlugs = new Set<string>();
  for (const g of groups.values()) {
    const st = stateByCode(g.state)!;
    const records = [...g.records].sort((a, b) => a.at.localeCompare(b.at) || a.type.localeCompare(b.type));
    const counts = { tornado: 0, hail: 0, wind: 0 };
    let declarations = 0;
    for (const r of records) {
      if (r.type === 'declaration') declarations++;
      else counts[r.type]++;
    }
    const spcTotal = counts.tornado + counts.hail + counts.wind;
    const spc = records.filter((r) => r.source === 'spc');
    // City slugs start with "city-of-" so a city never shares a slug with a county of the same name ("Carson City" county vs "Carson" city).
    const base = g.kind === 'state' ? `${g.name} FEMA` : g.kind === 'city' ? `city of ${g.name}` : g.name;
    let slug = buildSlug(base, g.date);
    // Last resort: two different places that still slugify the same ("City of Carson" county, "Carson" city) never share a URL.
    while (usedSlugs.has(slug)) slug = buildSlug(`${base} ${g.kind}`, g.date);
    usedSlugs.add(slug);
    out.push({
      state: g.state,
      stateName: st.name,
      kind: g.kind,
      name: g.name,
      place: g.kind === 'state' ? g.name : `${g.name}, ${g.state}`,
      date: g.date,
      dateLabel: longDate(g.date),
      slug,
      zone: g.zone,
      counts,
      spcTotal,
      declarations,
      largestHailIn: g.hail.length ? Math.max(...g.hail) : null,
      peakWindMph: g.wind.length ? Math.round(Math.max(...g.wind)) : null,
      firstAt: spc[0]?.at ?? null,
      lastAt: spc[spc.length - 1]?.at ?? null,
      firstLabel: spc[0]?.timeLabel ?? null,
      lastLabel: spc[spc.length - 1]?.timeLabel ?? null,
      modifiedAt: g.modified ? new Date(g.modified).toISOString() : null,
      records,
      qualifies: qualifies({ kind: g.kind, spcTotal, declarations }),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.spcTotal - a.spcTotal || a.slug.localeCompare(b.slug));
}

/** A county or city needs at least 3 SPC reports that day. A state-level FEMA report needs a storm declaration. */
export function qualifies(r: { kind: ReportKind; spcTotal: number; declarations: number }): boolean {
  return r.kind === 'state' ? r.declarations >= 1 : r.spcTotal >= MIN_SPC_REPORTS;
}

export function reportPath(r: Pick<StormReport, 'state' | 'slug'>): string {
  const st = stateByCode(r.state);
  return `/storms/${st?.slug ?? 'unknown'}/${r.slug}`;
}

/** Reports whose date falls in the last WINDOW_DAYS days (by the UTC date of `now`), qualifying only, newest first. */
export function indexWindow(reports: readonly StormReport[], nowMs: number): StormReport[] {
  const cutoff = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return reports.filter((r) => r.qualifies && r.date >= cutoff);
}
