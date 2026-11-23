import { HOLLER_UA } from '@/lib/user-agent';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { parseSocrataReport, type ParseReport } from './socrata';
import type { SocrataDataset } from './socrata-datasets';
import { CARTO_DATASETS, type CartoDataset } from './carto-datasets';

/**
 * Carto SQL API adapter (Philadelphia). Thin on purpose: it builds the SQL, fetches JSON, normalises Carto's timestamps, and hands the rows
 * to the Socrata parser (parseSocrataReport) with a Socrata-shaped config, so titles, trades, privacy rules and contact extraction are the
 * same code as for every Socrata dataset. Every adapter built here is on probation (Adapter.probation).
 */

const LIMIT = 1000;
const CARTO_BASE = 'https://phl.carto.com/api/v2/sql';
const UA = HOLLER_UA;

const LABEL_SUFFIX: Record<CartoDataset['subtype'], string> = {
  permit: 'building permits',
  violation: 'code violations',
  business: 'new business licenses',
};

/** The Socrata-shaped config the shared parser reads. Coordinates come from the SELECT's lat / lon aliases. */
export function toParseConfig(ds: CartoDataset): SocrataDataset {
  return {
    id: ds.id, city: ds.city, state: ds.state, domain: 'phl.carto.com', tz: 'UTC', datasetId: ds.table,
    kind: ds.kind, subtype: ds.subtype, idField: ds.idField, dateField: ds.dateField, latField: 'lat', lonField: 'lon',
    ...ds.parse, cadenceMinutes: ds.cadenceMinutes, verified: true, probation: true, verifiedUrl: ds.sourceUrl, fieldSource: ds.fieldSource,
  };
}

/** Start of the window: the scan's `since`, but never later than `minLookbackDays` before now. */
export function windowStart(ds: CartoDataset, since: Date, now: Date): Date {
  const floor = new Date(now.getTime() - ds.minLookbackDays * 86_400_000);
  return since.getTime() < floor.getTime() ? since : floor;
}

/** The SQL: explicit column list (never SELECT *), NOT NULL date, since, newest first, LIMIT 1000. */
export function buildCartoSql(ds: CartoDataset, since: Date, now: Date = new Date()): string {
  const from = windowStart(ds, since, now).toISOString();
  const select = [...ds.columns, 'ST_Y(the_geom) AS lat', 'ST_X(the_geom) AS lon'].join(', ');
  const where = [`${ds.dateField} IS NOT NULL`, `${ds.dateField} > '${from}'`];
  if (ds.extraWhere) where.push(`(${ds.extraWhere})`);
  return `SELECT ${select} FROM ${ds.table} WHERE ${where.join(' AND ')} ORDER BY ${ds.dateField} DESC LIMIT ${LIMIT}`;
}

export function buildCartoUrl(ds: CartoDataset, since: Date, now: Date = new Date()): string {
  return `${CARTO_BASE}?q=${encodeURIComponent(buildCartoSql(ds, since, now))}&format=json`;
}

/** Carto JSON gives "2026-11-21T22:32:57Z"; its CSV gives "2026-11-21 22:32:57+00". Both become an ISO string with a zone. */
export function normalizeCartoDate(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim().replace(' ', 'T');
  if (/(Z|[+-]\d{2}:\d{2})$/.test(t)) return t;
  if (/[+-]\d{2}$/.test(t)) return `${t}:00`;
  return /T\d{2}:\d{2}/.test(t) ? `${t}Z` : t;
}

export function parseCartoReport(raw: unknown, ds: CartoDataset): ParseReport {
  const rows = raw && typeof raw === 'object' && Array.isArray((raw as { rows?: unknown }).rows) ? ((raw as { rows: unknown[] }).rows) : Array.isArray(raw) ? raw : null;
  if (!rows) return { items: [], rows: 0, shapeOk: 0 };
  const prepared = rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    const row = { ...(r as Record<string, unknown>) };
    row[ds.dateField] = normalizeCartoDate(row[ds.dateField]);
    return ds.prepareRow ? ds.prepareRow(row) : row;
  });
  const report = parseSocrataReport(prepared, toParseConfig(ds));
  for (const it of report.items) it.url = ds.sourceUrl;
  return report;
}

export function parseCarto(raw: unknown, ds: CartoDataset): SignalInput[] {
  return parseCartoReport(raw, ds).items;
}

export function buildCartoAdapter(ds: CartoDataset): Adapter {
  return {
    id: ds.id,
    label: `${ds.city} open data: ${LABEL_SUFFIX[ds.subtype]}`,
    kind: ds.kind,
    cadenceMinutes: ds.cadenceMinutes,
    probation: true,
    sourceUrl: ds.sourceUrl,
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const url = buildCartoUrl(ds, ctx.since, ctx.now ?? new Date());
        const res = await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
          ctx.log(`${ds.id}: HTTP ${res.status}`);
          return [];
        }
        const body: unknown = await res.json();
        if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) {
          ctx.log(`error: ${ds.id} returned no rows array, shape may have changed`);
          return [];
        }
        const report = parseCartoReport(body, ds);
        if (report.rows > 0 && report.items.length === 0) {
          if (report.shapeOk === 0) ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
          else ctx.log(`${ds.id}: ${report.rows} rows, 0 matched a trade`);
        }
        return report.items;
      } catch (e) {
        ctx.log(`${ds.id}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
  };
}

export const adapters: Adapter[] = CARTO_DATASETS.map(buildCartoAdapter);
