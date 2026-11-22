import { contactSpecFields } from '@/lib/contacts/extract';
import { env } from '@/lib/env';
import { sanitizeHealthError } from './health';
import { sanitizeSample } from './samples';
import { columnsSeen, missingColumns } from './schema-check';
import { SOCRATA_DATASETS, type SocrataDataset } from './adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from './adapters/arcgis-datasets';
import { parseSocrataReport, recordDateIso, socrataSchemaProblem } from './adapters/socrata';
import { arcgisDateToIso, arcgisSchemaProblem, layerSchemaCheck, parseArcgisReport, valueFieldsOf } from './adapters/arcgis';
import type { SignalInput } from './types';

/**
 * GET /api/admin/coverage-probe?source=<id> (round 19 COVERAGE). The owner's check of ONE probation source's schema before promoting it,
 * run once deployed (the build sandbox cannot reach city portals). It reads the source's column list and a handful of its newest rows,
 * and returns column NAMES, counts, the newest date and the mapped result of up to 3 rows exactly as the scan would build them, with the
 * sample clean-up applied (sanitizeSample: no contact on a 311 or violation row, every contact name through the organisation check).
 * It never returns a raw row, an owner or applicant value, a token or a URL with a query string. It writes nothing: no database client.
 */

export const PROBE_ROWS = 5;
export const PROBE_MAPPED = 3;
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
const TIMEOUT_MS = 15000;

type Probed = { platform: 'socrata'; ds: SocrataDataset } | { platform: 'arcgis'; ds: ArcgisDataset };

/** Probation datasets the probe accepts (Socrata and ArcGIS), sorted. */
export function coverageProbeSourceIds(): string[] {
  return [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.verified && d.probation).map((d) => d.id).sort();
}

function find(id: string): Probed | null {
  const s = SOCRATA_DATASETS.find((d) => d.id === id && d.verified && d.probation);
  if (s) return { platform: 'socrata', ds: s };
  const a = ARCGIS_DATASETS.find((d) => d.id === id && d.verified && d.probation);
  return a ? { platform: 'arcgis', ds: a } : null;
}

const uniq = (xs: (string | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** Every column the config reads (id, date, text, title, summary, address, zip, coordinates, status, contacts, value). */
export function expectedColumns(p: Probed): string[] {
  const d = p.ds;
  const common = [
    ...(d.idFields?.length ? d.idFields : [d.idField]),
    d.dateField, ...d.titleFields, ...d.textFields, ...d.summaryFields, ...(d.addressFields ?? []), d.zipField, d.latField, d.lonField,
    d.statusField, ...contactSpecFields(d.contacts),
  ];
  if (p.platform === 'socrata') return uniq([...common, p.ds.locationField, p.ds.latLonTextField, ...(p.ds.valueFields ?? [])]);
  return uniq([...common, ...valueFieldsOf(p.ds), p.ds.skipWhen?.field]);
}

export interface MappedRow {
  externalId: string;
  title: string;
  summary: string | null;
  occurredAt: string;
  lat: number | null;
  lon: number | null;
  approxLocation: boolean;
  zip: string | null;
  categories: string[];
  jobValue: number | null;
  permitStage: string | null;
  contacts: { role: string; name: string | null; phone: string | null }[];
}

export interface CoverageProbeResult {
  status: 'ok' | 'unknown_source';
  source: string;
  platform: 'socrata' | 'arcgis' | null;
  /** The endpoint, without any query string. */
  endpoint: string | null;
  /** HTTP status of the rows request (null when it was not sent or got no answer). */
  httpStatus: number | null;
  rowCount: number;
  /** Column names the source has: from its own column list when that could be read, else from the rows. */
  columns: string[];
  columnsFrom: 'column list' | 'rows' | null;
  expectedColumns: string[];
  missingExpected: string[];
  /** Newest record date among the rows read (the config's own date column, parsed as the scan parses it). */
  newestDate: string | null;
  /** ok: rows parse; mismatch: see schemaProblem; no_rows: the source answered with none; unreachable: no usable answer. */
  schema: 'ok' | 'mismatch' | 'no_rows' | 'unreachable';
  schemaProblem?: string;
  /** Rows that had the id, a readable date and some text (the shape the config expects). */
  shapeOk: number;
  /** Rows that became a record (a trade matched). */
  parsedRows: number;
  mapped: MappedRow[];
  message?: string;
  wroteNothing: true;
}

function empty(source: string, extra: Partial<CoverageProbeResult> = {}): CoverageProbeResult {
  return {
    status: 'ok', source, platform: null, endpoint: null, httpStatus: null, rowCount: 0, columns: [], columnsFrom: null, expectedColumns: [],
    missingExpected: [], newestDate: null, schema: 'unreachable', shapeOk: 0, parsedRows: 0, mapped: [], wroteNothing: true, ...extra,
  };
}

/** The mapped form of a record, after the sample clean-up. Never a raw column value beyond what the scan itself would store. */
export function mappedRow(s: SignalInput): MappedRow {
  const clean = sanitizeSample(s);
  const data = (clean.data ?? {}) as Record<string, unknown>;
  return {
    externalId: clean.externalId,
    title: clean.title,
    summary: clean.summary ?? null,
    occurredAt: clean.occurredAt,
    lat: clean.lat ?? null,
    lon: clean.lon ?? null,
    approxLocation: data.approxLocation === true,
    zip: clean.zip ?? null,
    categories: [...(clean.categories ?? [])],
    jobValue: typeof data.jobValue === 'number' ? data.jobValue : null,
    permitStage: clean.permitStage ?? null,
    contacts: (clean.contacts ?? []).map((c) => ({ role: c.role, name: c.name ?? null, phone: c.phone ?? null })),
  };
}

function newest(isoDates: (string | null)[]): string | null {
  return isoDates.reduce<string | null>((m, d) => (d && (!m || d > m) ? d : m), null);
}

async function getJson(doFetch: typeof fetch, url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function finish(base: CoverageProbeResult, rows: unknown[], items: SignalInput[], shapeOk: number, problem: string | null): CoverageProbeResult {
  const out = { ...base, rowCount: rows.length, shapeOk, parsedRows: items.length, mapped: items.slice(0, PROBE_MAPPED).map(mappedRow) };
  if (base.columnsFrom === null) {
    out.columns = columnsSeen(rows);
    out.columnsFrom = rows.length ? 'rows' : null;
  }
  out.missingExpected = out.columnsFrom === 'column list'
    ? out.expectedColumns.filter((c) => !out.columns.includes(c))
    : missingColumns(rows, out.expectedColumns);
  if (rows.length === 0) out.schema = out.schema === 'unreachable' ? 'unreachable' : 'no_rows';
  else if (problem) {
    out.schema = 'mismatch';
    out.schemaProblem = problem;
  } else out.schema = 'ok';
  return out;
}

async function probeSocrata(ds: SocrataDataset, doFetch: typeof fetch): Promise<CoverageProbeResult> {
  const endpoint = `https://${ds.domain}/resource/${ds.datasetId}.json`;
  const base = empty(ds.id, { platform: 'socrata', endpoint, expectedColumns: expectedColumns({ platform: 'socrata', ds }) });
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
  const token = process.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
  if (token) headers['X-App-Token'] = token;
  // The column list (dataset metadata). Optional: without it the columns are read from the rows (Socrata leaves out empty keys).
  try {
    const meta = await getJson(doFetch, `https://${ds.domain}/api/views/${ds.datasetId}.json`, headers);
    const cols = (meta.body as { columns?: { fieldName?: unknown }[] } | null)?.columns;
    if (meta.status < 400 && Array.isArray(cols) && cols.length) {
      base.columns = uniq(cols.map((c) => (typeof c?.fieldName === 'string' ? c.fieldName : undefined))).sort();
      base.columnsFrom = 'column list';
    }
  } catch {
    /* rows only */
  }
  const q = new URLSearchParams();
  q.set('$order', `${ds.queryDateField ?? ds.dateField} DESC`);
  q.set('$limit', String(PROBE_ROWS));
  try {
    const { status, body } = await getJson(doFetch, `${endpoint}?${q.toString()}`, headers);
    base.httpStatus = status;
    if (status >= 400 || !Array.isArray(body)) {
      const msg = (body as { message?: unknown } | null)?.message;
      return finish({ ...base, schema: 'unreachable', ...(msg ? { message: sanitizeHealthError(String(msg)) ?? undefined } : {}) }, [], [], 0, null);
    }
    const report = parseSocrataReport(body, ds);
    base.newestDate = newest(body.map((r) => (r && typeof r === 'object' ? recordDateIso((r as Record<string, unknown>)[ds.dateField], ds) : null)));
    base.schema = 'ok';
    const problem = report.shapeOk === 0 ? socrataSchemaProblem(body, ds) ?? (body.length ? 'no row has the id, a readable date and text' : null) : null;
    return finish(base, body, report.items, report.shapeOk, problem);
  } catch (e) {
    return finish({ ...base, schema: 'unreachable', message: sanitizeHealthError(e) ?? 'error' }, [], [], 0, null);
  }
}

async function probeArcgis(ds: ArcgisDataset, doFetch: typeof fetch): Promise<CoverageProbeResult> {
  const base = empty(ds.id, { platform: 'arcgis', endpoint: ds.layerUrl, expectedColumns: expectedColumns({ platform: 'arcgis', ds }) });
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  let fields: { names: Set<string>; types: Map<string, string> } | null = null;
  try {
    const meta = await getJson(doFetch, `${ds.layerUrl}?f=json`, headers);
    const list = (meta.body as { fields?: { name?: unknown; type?: unknown }[] } | null)?.fields;
    if (meta.status < 400 && Array.isArray(list) && list.length) {
      const pairs = list.map((f) => [String(f?.name ?? ''), typeof f?.type === 'string' ? f.type : ''] as [string, string]).filter(([n]) => n);
      fields = { names: new Set(pairs.map(([n]) => n)), types: new Map(pairs) };
      base.columns = [...fields.names].sort();
      base.columnsFrom = 'column list';
    }
  } catch {
    fields = null;
  }
  const check = layerSchemaCheck(ds, fields);
  if (check?.problem) {
    // The same refusal the scan makes: no query is sent when the id or date column is not in the layer.
    return {
      ...base,
      schema: 'mismatch',
      schemaProblem: check.problem,
      missingExpected: base.expectedColumns.filter((c) => !base.columns.includes(c)),
      message: 'no rows were requested: the layer lacks the id or date column the config expects',
    };
  }
  const wanted = base.expectedColumns.filter((c) => !fields || fields.names.has(c));
  const q = new URLSearchParams();
  q.set('where', '1=1');
  q.set('outFields', wanted.join(','));
  q.set('orderByFields', `${ds.dateField} DESC`);
  q.set('resultRecordCount', String(PROBE_ROWS));
  q.set('returnGeometry', 'true');
  q.set('outSR', '4326');
  q.set('f', 'json');
  try {
    const { status, body } = await getJson(doFetch, `${ds.layerUrl}/query?${q.toString()}`, headers);
    base.httpStatus = status;
    const b = body as { features?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (status >= 400 || !b || b.error || !Array.isArray(b.features)) {
      const msg = b?.error ? `ArcGIS ${String(b.error.code ?? '')} ${String(b.error.message ?? '')}`.trim() : null;
      return finish({ ...base, schema: 'unreachable', ...(msg ? { message: sanitizeHealthError(msg) ?? undefined } : {}) }, [], [], 0, null);
    }
    const features = b.features as unknown[];
    const attrs = features.map((f) => (f && typeof f === 'object' ? ((f as { attributes?: unknown }).attributes ?? null) : null));
    const report = parseArcgisReport(body, ds);
    base.newestDate = newest(attrs.map((a) => (a && typeof a === 'object' ? arcgisDateToIso((a as Record<string, unknown>)[ds.dateField]) : null)));
    base.schema = 'ok';
    const problem = report.shapeOk === 0 ? arcgisSchemaProblem(features, ds) ?? (features.length ? 'no row has the id, a readable date and text' : null) : null;
    const out = finish(base, attrs.filter((a) => a !== null), report.items, report.shapeOk, problem);
    out.rowCount = features.length;
    return out;
  } catch (e) {
    return finish({ ...base, schema: 'unreachable', message: sanitizeHealthError(e) ?? 'error' }, [], [], 0, null);
  }
}

/** Runs the probe for one source. `doFetch` is passed in so a test can answer without a network. Never throws. */
export async function runCoverageProbe(source: string, doFetch: typeof fetch): Promise<CoverageProbeResult> {
  const p = find(source);
  if (!p) return { ...empty(source), status: 'unknown_source', schema: 'unreachable' };
  try {
    return p.platform === 'socrata' ? await probeSocrata(p.ds, doFetch) : await probeArcgis(p.ds, doFetch);
  } catch (e) {
    return empty(source, { platform: p.platform, message: sanitizeHealthError(e) ?? 'error' });
  }
}
