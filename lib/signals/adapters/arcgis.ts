import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { permitTitle, permitTypeFields, publicSummary, scrubText, summaryPart } from './permit-privacy';
import type { CategoryId } from '@/lib/signals/categories';
import { categorize, privatePosition, publicAddress } from './socrata';
import { ARCGIS_DATASETS, arcgisLookbackDays, arcgisPageUrl, type ArcgisDataset } from './arcgis-datasets';

const LIMIT = 500;
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

type Attrs = Record<string, unknown>;

function str(a: Attrs, field?: string): string {
  if (!field) return '';
  const v = a[field];
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
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null; // also rejects web-mercator metres if outSR was ignored
  return { lat, lon };
}

/** Esri date values are epoch milliseconds (UTC); DateOnly fields are 'yyyy-mm-dd' strings. */
export function arcgisDateToIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string' && v) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `yyyy-mm-dd HH:mm:ss` in UTC, the literal form Esri documents for timestamp comparisons. */
export function toTimestampLiteral(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function dateClause(ds: ArcgisDataset, op: '>=' | '<=', d: Date): string {
  if (ds.dateType === 'dateOnly') return `${ds.dateField} ${op} date '${toTimestampLiteral(d).slice(0, 10)}'`;
  return `${ds.dateField} ${op} timestamp '${toTimestampLiteral(d)}'`;
}

function outFields(ds: ArcgisDataset): string {
  const set = new Set<string>([
    ds.idField, ds.dateField, ds.latField, ds.lonField, ds.nameField, ds.zipField,
    ...ds.titleFields, ...ds.textFields, ...ds.summaryFields, ...(ds.addressFields ?? []),
  ].filter((x): x is string => Boolean(x)));
  return [...set].join(',');
}

/**
 * Query parameters for `<layer url>/query`. The where clause is a fixed lookback on the date field
 * (so it does not depend on when the last scan ran), newest first, hard row limit, geometry reprojected to WGS84.
 */
export function buildArcgisQuery(ds: ArcgisDataset, now: Date = new Date()): URLSearchParams {
  const from = new Date(now.getTime() - arcgisLookbackDays(ds) * 86_400_000);
  const clauses = [dateClause(ds, '>=', from)];
  if (ds.windowForwardDays != null) clauses.push(dateClause(ds, '<=', new Date(now.getTime() + ds.windowForwardDays * 86_400_000)));
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  const p = new URLSearchParams();
  p.set('where', clauses.join(' AND '));
  p.set('outFields', outFields(ds));
  p.set('orderByFields', `${ds.dateField} DESC`);
  p.set('resultRecordCount', String(LIMIT));
  p.set('returnGeometry', 'true');
  p.set('outSR', '4326');
  p.set('f', 'json');
  return p;
}

export interface ArcgisParseReport {
  items: SignalInput[];
  rows: number;
  shapeOk: number;
  /** set when the body is an ArcGIS error object (HTTP 200 with {error:{code,message}}) */
  apiError?: string;
}

function position(f: { attributes: Attrs; geometry?: unknown }, ds: ArcgisDataset): { lat: number; lon: number; approx: boolean } | null {
  const g = f.geometry as { x?: unknown; y?: unknown } | undefined;
  if (g && typeof g === 'object') {
    const p = validLatLon(num(g.y), num(g.x));
    if (p) return { ...p, approx: false };
  }
  if (ds.latField && ds.lonField) {
    const p = validLatLon(num(f.attributes[ds.latField]), num(f.attributes[ds.lonField]));
    if (p) return { ...p, approx: false };
  }
  if (ds.fallbackCenter) return { ...ds.fallbackCenter, approx: true };
  return null;
}

function title(ds: ArcgisDataset, a: Attrs, titleBitsRaw: string[], summaryBits: string[], address: string, categories: CategoryId[], text: string): string {
  // Free-text columns can hold names and phone numbers: titles never copy them raw.
  if (ds.subtype === 'permit') {
    return permitTitle(ds.city, permitTypeFields(ds.titleFields).map((f) => str(a, f)).filter(Boolean), categories, text);
  }
  const titleBits = ds.subtype === 'business' || ds.subtype === 'inspection' ? titleBitsRaw : titleBitsRaw.map(scrubText).filter(Boolean);
  switch (ds.subtype) {
    case '311':
      return `311 request in ${ds.city}: ${trunc([...new Set(titleBits)].join(' / ') || 'service request', 110)}`;
    case 'business':
      return titleBits[0]
        ? `New business in ${ds.city}: ${trunc(titleBits[0], 100)}`
        : `New business license in ${ds.city}: ${trunc(summaryBits[0] ?? 'business', 100)}`;
    case 'violation':
      return `Code violation in ${ds.city}: ${trunc(titleBits[0] ?? 'property violation', 110)}`;
    case 'event-permit':
      return `Permitted event in ${ds.city}: ${trunc(titleBits[0] ?? 'special event', 80)}${address ? ` at ${trunc(address, 60)}` : ''}`;
    default:
      return `Failed inspection in ${ds.city}: ${trunc(titleBits[0] || 'food establishment', 100)}`;
  }
}

/**
 * Pure parser for an ArcGIS query response (`f=json`). Reads `features[].attributes` and point `geometry {x,y}`.
 * Rows with no matching trade are dropped. Never throws: anything unexpected returns an empty report.
 */
export function parseArcgisReport(raw: unknown, ds: ArcgisDataset): ArcgisParseReport {
  const report: ArcgisParseReport = { items: [], rows: 0, shapeOk: 0 };
  if (!raw || typeof raw !== 'object') return report;
  const body = raw as { features?: unknown; error?: { code?: unknown; message?: unknown } };
  if (body.error) {
    report.apiError = `ArcGIS ${String(body.error.code ?? '')} ${String(body.error.message ?? '')}`.trim();
    return report;
  }
  if (!Array.isArray(body.features)) return report;
  report.rows = body.features.length;
  const seen = new Set<string>();
  for (const f of body.features) {
    try {
      if (!f || typeof f !== 'object') continue;
      const feat = f as { attributes?: unknown; geometry?: unknown };
      if (!feat.attributes || typeof feat.attributes !== 'object') continue;
      const a = feat.attributes as Attrs;
      const occurredAt = arcgisDateToIso(a[ds.dateField]);
      const externalId = str(a, ds.idField);
      const text = ds.textFields.map((x) => str(a, x)).filter(Boolean).join(' | ');
      if (!occurredAt || !externalId || !text) continue;
      report.shapeOk += 1;
      if (seen.has(externalId)) continue;

      const { categories, severity } = categorize(ds, text);
      if (categories.length === 0) continue;

      const titleBits = ds.titleFields.map((x) => str(a, x)).filter(Boolean);
      const summaryBits = ds.summaryFields.map((x) => summaryPart(x, str(a, x))).filter(Boolean);
      // Business rows never carry a street address (home addresses of sole proprietors).
      const address = ds.subtype === 'business' ? '' : publicAddress(ds.subtype, (ds.addressFields ?? []).map((x) => str(a, x)).filter(Boolean).join(' '));
      const parts = [...new Set(summaryBits)];
      if (address && ds.subtype !== '311') parts.push(address);
      const pos = privatePosition(position({ attributes: a, geometry: feat.geometry }, ds), ds.subtype);
      const zip = str(a, ds.zipField).slice(0, 5) || null;
      seen.add(externalId);
      report.items.push({
        source: ds.id,
        externalId,
        kind: ds.kind,
        title: title(ds, a, titleBits, summaryBits, address, categories, text),
        summary: ds.subtype === 'business' ? trunc(parts.join(' | '), 280) || null : publicSummary(parts, { minChars: ds.subtype === 'permit' ? 15 : undefined }),
        url: arcgisPageUrl(ds),
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        city: ds.city,
        state: ds.state,
        zip,
        categories,
        severity,
        occurredAt,
        data: {
          layer: ds.layerUrl,
          subtype: ds.subtype,
          ...(pos?.approx ? { approxLocation: true } : {}),
        },
      });
    } catch {
      // skip malformed feature
    }
  }
  return report;
}

export function parseArcgis(raw: unknown, ds: ArcgisDataset): SignalInput[] {
  return parseArcgisReport(raw, ds).items;
}

export function buildArcgisAdapter(ds: ArcgisDataset): Adapter {
  const suffix: Record<ArcgisDataset['subtype'], string> = {
    permit: 'building permits',
    '311': '311 requests',
    inspection: 'food inspections',
    business: 'new business licenses',
    violation: 'code violations',
    'event-permit': 'special event permits',
  };
  return {
    id: ds.id,
    label: `${ds.city} open data: ${suffix[ds.subtype]}`,
    kind: ds.kind,
    cadenceMinutes: ds.cadenceMinutes,
    sourceUrl: arcgisPageUrl(ds),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const url = `${ds.layerUrl}/query?${buildArcgisQuery(ds, ctx.now ?? new Date()).toString()}`;
        const res = await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          ctx.log(`${ds.id}: HTTP ${res.status}`);
          return [];
        }
        const body: unknown = await res.json();
        const report = parseArcgisReport(body, ds);
        if (report.apiError) {
          ctx.log(`error: ${ds.id}: ${report.apiError}`);
          return [];
        }
        if (!body || typeof body !== 'object' || !Array.isArray((body as { features?: unknown }).features)) {
          ctx.log(`error: ${ds.id} response had no features array, shape may have changed`);
          return [];
        }
        if (report.rows > 0 && report.items.length === 0) {
          if (report.shapeOk === 0) {
            ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
          } else {
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

/** Only verified layers are enabled by default. */
export const adapters: Adapter[] = ARCGIS_DATASETS.filter((d) => d.verified).map(buildArcgisAdapter);
