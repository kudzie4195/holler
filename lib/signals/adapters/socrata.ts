import { classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import {
  CIVIC_TYPE_KEYWORDS,
  RULES_BY_SUBTYPE,
  SOCRATA_DATASETS,
  datasetPageUrl,
  lookbackDays,
  type SocrataDataset,
} from './socrata-datasets';

const LIMIT = 500;
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

type Row = Record<string, unknown>;

function s(row: Row, field?: string): string {
  if (!field) return '';
  const v = row[field];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function trunc(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

function validLatLon(lat: number | null, lon: number | null): { lat: number; lon: number } | null {
  if (lat == null || lon == null) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Socrata `location` / `point` values come as {latitude, longitude} strings or GeoJSON Points. */
export function extractLatLon(row: Row, ds: SocrataDataset): { lat: number; lon: number; approx: boolean } | null {
  if (ds.latField && ds.lonField) {
    const p = validLatLon(num(row[ds.latField]), num(row[ds.lonField]));
    if (p) return { ...p, approx: false };
  }
  if (ds.locationField) {
    const v = row[ds.locationField] as unknown;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.coordinates) && o.coordinates.length >= 2) {
        const p = validLatLon(num(o.coordinates[1]), num(o.coordinates[0]));
        if (p) return { ...p, approx: false };
      }
      const p = validLatLon(num(o.latitude), num(o.longitude));
      if (p) return { ...p, approx: false };
    }
  }
  if (ds.latLonTextField) {
    const t = s(row, ds.latLonTextField);
    const m = t.match(/(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a < 0 && b > 0) [a, b] = [b, a]; // "lon, lat" order guard for US coordinates
      const p = validLatLon(a, b);
      if (p) return { ...p, approx: false };
    }
  }
  if (ds.fallbackCenter) return { ...ds.fallbackCenter, approx: true };
  return null;
}

/** Offset (ms) of `tz` from UTC at the instant `ms`. */
function tzOffsetMs(tz: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/** Format an instant as a SODA floating timestamp (local wall clock in `tz`, no zone). */
export function toFloatingLocal(d: Date, tz: string): string {
  return new Date(d.getTime() + tzOffsetMs(tz, d.getTime())).toISOString().slice(0, 19);
}

/**
 * SODA floating timestamps hold local wall-clock time with no zone. With `tz` they are converted to a true UTC instant;
 * without `tz` they are read as UTC. Values that carry a zone are used as is.
 */
export function toIso(v: unknown, tz?: string): string | null {
  if (typeof v !== 'string' || !v) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(v);
  if (hasZone) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const asUtc = new Date(`${v}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  if (!tz) return asUtc.toISOString();
  let guess = asUtc.getTime() - tzOffsetMs(tz, asUtc.getTime());
  guess = asUtc.getTime() - tzOffsetMs(tz, guess); // second pass settles DST edges
  return new Date(guess).toISOString();
}

export function categorize(ds: Pick<SocrataDataset, 'subtype'>, text: string): { categories: CategoryId[]; severity: Severity } {
  const set = new Set<CategoryId>();
  let severity: Severity = ds.subtype === 'inspection' ? 2 : 1;
  for (const rule of RULES_BY_SUBTYPE[ds.subtype]) {
    if (rule.re.test(text)) {
      rule.add.forEach((c) => set.add(c));
      if (rule.severity && rule.severity > severity) severity = rule.severity;
    }
  }
  // A new roofing business is a competitor, not a roofing lead: business and event rules decide alone.
  if (ds.subtype !== 'business' && ds.subtype !== 'event-permit') classifyText(text).forEach((c) => set.add(c));
  return { categories: [...set], severity };
}

export interface ParseReport {
  items: SignalInput[];
  /** raw rows received */
  rows: number;
  /** rows that had an id, a parseable date and at least one non-empty text field: the shape the config expects */
  shapeOk: number;
}

function externalIdFor(row: Row, ds: SocrataDataset): string {
  if (ds.idFields?.length) {
    const parts = ds.idFields.map((f) => s(row, f));
    return parts.every(Boolean) ? parts.join(':') : '';
  }
  return s(row, ds.idField);
}

function buildTitle(ds: SocrataDataset, row: Row, titleBits: string[], summaryBits: string[], address: string): string {
  switch (ds.subtype) {
    case 'permit':
      return `New permit in ${ds.city}: ${trunc(titleBits[0] ?? 'building permit', 110)}`;
    case '311': {
      const uniq = [...new Set(titleBits.map((b) => b.toLowerCase()))].map(
        (l) => titleBits.find((b) => b.toLowerCase() === l) as string,
      );
      return `311 request in ${ds.city}: ${trunc(uniq.join(' / ') || 'service request', 110)}`;
    }
    case 'business':
      return titleBits[0]
        ? `New business in ${ds.city}: ${trunc(titleBits[0], 100)}`
        : `New business license in ${ds.city}: ${trunc(summaryBits[0] ?? 'business', 100)}`;
    case 'violation':
      return `Code violation in ${ds.city}: ${trunc(titleBits[0] ?? 'property violation', 110)}`;
    case 'event-permit':
      return `Permitted event in ${ds.city}: ${trunc(titleBits[0] ?? 'special event', 80)}${address ? ` at ${trunc(address, 60)}` : ''}`;
    default:
      return `Failed inspection in ${ds.city}: ${trunc(s(row, ds.nameField) || 'food establishment', 100)}`;
  }
}

/**
 * Pure parser with counts. Rows with no matching trade are dropped (a permit for a doghouse or a 311 pothole is noise
 * for local trades). Inspections are kept only when the dataset's failure rule says so.
 * `shapeOk` counts rows that look like the configured shape before any trade filtering, so the adapter can tell
 * "columns changed" (shapeOk 0) from "nothing relevant today". Never throws: malformed input returns an empty report.
 */
export function parseSocrataReport(raw: unknown, ds: SocrataDataset): ParseReport {
  const report: ParseReport = { items: [], rows: 0, shapeOk: 0 };
  if (!Array.isArray(raw)) return report;
  report.rows = raw.length;
  const out = report.items;
  const seen = new Set<string>();
  for (const item of raw) {
    try {
      if (!item || typeof item !== 'object') continue;
      const row = item as Row;
      const occurredAt = toIso(row[ds.dateField], ds.tz);
      const rawId = externalIdFor(row, ds);
      const text = ds.textFields.map((f) => s(row, f)).filter(Boolean).join(' | ');
      if (!occurredAt || !rawId || !text) continue;
      report.shapeOk += 1;
      if (ds.subtype === 'inspection' && ds.isFailure && !ds.isFailure(row)) continue;

      const externalId = ds.subtype === 'inspection' ? `${rawId}:${s(row, ds.dateField).slice(0, 10)}` : rawId;
      if (seen.has(externalId)) continue;

      const { categories, severity } = categorize(ds, text);
      if (categories.length === 0) continue;

      const titleBits = ds.titleFields.map((f) => s(row, f)).filter(Boolean);
      const address = (ds.addressFields ?? []).map((f) => s(row, f)).filter(Boolean).join(' ');
      const summaryBits = ds.summaryFields.map((f) => s(row, f)).filter(Boolean);
      const title = buildTitle(ds, row, titleBits, summaryBits, address);

      // 311 summaries leave the street address out; permits, inspections, businesses, violations and events are
      // business/property records. Only the configured summary fields are read, never owner or applicant columns.
      const summaryParts = [...new Set(summaryBits)];
      if (address && ds.subtype !== '311') summaryParts.push(address);
      const summary = trunc(summaryParts.join(' | '), 280) || null;

      const pos = extractLatLon(row, ds);
      const zip = s(row, ds.zipField).slice(0, 5) || null;
      const expiresAt = ds.endDateField ? toIso(row[ds.endDateField], ds.tz) : null;
      seen.add(externalId);
      out.push({
        source: ds.id,
        externalId,
        kind: ds.kind,
        title,
        summary,
        url: datasetPageUrl(ds),
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        city: ds.city,
        state: ds.state,
        zip,
        categories,
        severity,
        occurredAt,
        ...(expiresAt ? { expiresAt } : {}),
        data: {
          dataset: ds.datasetId,
          domain: ds.domain,
          subtype: ds.subtype,
          ...(pos?.approx ? { approxLocation: true } : {}),
        },
      });
    } catch {
      // skip malformed row
    }
  }
  return report;
}

export function parseSocrata(raw: unknown, ds: SocrataDataset): SignalInput[] {
  return parseSocrataReport(raw, ds).items;
}

/**
 * Builds the SODA query string. $where is a fixed lookback on the date field, expressed in the dataset's own local
 * wall-clock time (the column is a floating timestamp), so it does not depend on when the last scan ran or how late the
 * portal published. Duplicates are absorbed by unique(source, external_id). Newest first; $limit 500.
 */
export function buildSocrataQuery(ds: SocrataDataset, now: Date = new Date()): URLSearchParams {
  const from = new Date(now.getTime() - lookbackDays(ds) * 86_400_000);
  const sinceStr = toFloatingLocal(from, ds.tz);
  const clauses = [`${ds.dateField} > '${sinceStr}'`];
  if (ds.windowForwardDays != null) {
    const to = new Date(now.getTime() + ds.windowForwardDays * 86_400_000);
    clauses.push(`${ds.dateField} <= '${toFloatingLocal(to, ds.tz)}'`);
  }
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  if (ds.subtype === '311' && ds.typeFilterField) {
    const ors = CIVIC_TYPE_KEYWORDS.map((k) => `upper(${ds.typeFilterField}) like '%${k}%'`);
    clauses.push(`(${ors.join(' OR ')})`);
  }
  const p = new URLSearchParams();
  p.set('$where', clauses.join(' AND '));
  p.set('$order', `${ds.dateField} DESC`);
  p.set('$limit', String(LIMIT));
  return p;
}

const LABEL_SUFFIX: Record<SocrataDataset['subtype'], string> = {
  permit: 'building permits',
  '311': '311 requests',
  inspection: 'food inspections',
  business: 'new business licenses',
  violation: 'code violations',
  'event-permit': 'special event permits',
};

export function buildSocrataAdapter(ds: SocrataDataset): Adapter {
  const label = `${ds.city} open data: ${LABEL_SUFFIX[ds.subtype]}`;
  return {
    id: ds.id,
    label,
    kind: ds.kind,
    cadenceMinutes: ds.cadenceMinutes,
    sourceUrl: datasetPageUrl(ds),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${buildSocrataQuery(ds, ctx.now ?? new Date()).toString()}`;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
        const token = ctx.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
        if (token) headers['X-App-Token'] = token;
        const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          ctx.log(`${ds.id}: HTTP ${res.status}`);
          return [];
        }
        const body: unknown = await res.json();
        if (!Array.isArray(body)) {
          ctx.log(`error: ${ds.id} returned a non-array response, shape may have changed`);
          return [];
        }
        const report = parseSocrataReport(body, ds);
        if (report.rows > 0 && report.items.length === 0) {
          if (report.shapeOk === 0) {
            ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
          } else {
            // Rows look right but none map to a trade (or none failed): a quiet window, not a broken source.
            ctx.log(`${ds.id}: ${report.rows} rows, 0 matched a trade`);
          }
        }
        return report.items;
      } catch (e) {
        ctx.log(`${ds.id}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
  };
}

/** Only verified datasets are enabled by default. */
export const adapters: Adapter[] = SOCRATA_DATASETS.filter((d) => d.verified).map(buildSocrataAdapter);
