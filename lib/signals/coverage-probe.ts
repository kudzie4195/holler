import { contactSpecFields } from '@/lib/contacts/extract';
import { env } from '@/lib/env';
import { sanitizeHealthError } from './health';
import { sanitizeSample } from './samples';
import { columnsSeen, missingColumns, readJsonBody } from './schema-check';
import { SOCRATA_DATASETS, lookbackDays, type SocrataDataset } from './adapters/socrata-datasets';
import { ARCGIS_DATASETS, arcgisLookbackDays, type ArcgisDataset } from './adapters/arcgis-datasets';
import { buildSocrataQuery, parseSocrataReport, recordDateIso, sendsSelect, socrataSchemaProblem, socrataSelectColumns } from './adapters/socrata';
import { arcgisDateToIso, arcgisSchemaProblem, buildArcgisQuery, layerSchemaCheck, parseArcgisReport, valueFieldsOf } from './adapters/arcgis';
import type { SignalInput } from './types';
import { idKeySecret } from './id-key';
import { HOUSTON_ACCESS, HOUSTON_HEADERS, HOUSTON_PERMITS_DS, HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, HOUSTON_ROW_CAP, HOUSTON_USER_AGENT, houstonAccess, parseHoustonPermits, readBoundedText, readPermitTable } from './adapters/houston-permits';

/**
 * GET /api/admin/coverage-probe?source=<id> (round 19 COVERAGE). The owner's check of ONE probation source's schema before promoting it,
 * run once deployed (the build sandbox cannot reach city portals). It reads the source's column list, a handful of its newest rows and
 * the number of rows the scan's window holds (against the scan's row cap),
 * and returns column NAMES, counts, the newest date and the mapped result of up to 3 rows exactly as the scan would build them, with the
 * sample clean-up applied (sanitizeSample: no contact on a 311 or violation row, every contact name through the organisation check).
 * It never returns a raw row, an owner or applicant value, a token or a URL with a query string. It writes nothing: no database client.
 */

export const PROBE_ROWS = 5;
export const PROBE_MAPPED = 3;
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
/** Per request (review P3-I): four requests at most, inside the route's 60 s. */
const TIMEOUT_MS = 10000;
/** The scan's row cap per run (one page of 500; Socrata datasets with maxPages read more). */
const SCAN_PAGE = 500;

type Probed = { platform: 'socrata'; ds: SocrataDataset } | { platform: 'arcgis'; ds: ArcgisDataset };

/** Probation datasets the probe accepts (Socrata and ArcGIS, and the Houston permit report page), sorted. */
export function coverageProbeSourceIds(): string[] {
  return [...[...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.verified && d.probation).map((d) => d.id), HOUSTON_PERMITS_ID].sort();
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
    // Round 20 NEXT: the premises, 311 site and occupancy type columns.
    ...contactSpecFields(d.premises), ...(d.site311 ? [...d.site311.addressFields, ...d.site311.typeFields] : []), ...(d.occupancy?.typeFields ?? []),
  ];
  if (p.platform === 'socrata') return uniq([...common, p.ds.locationField, p.ds.latLonTextField, ...(p.ds.valueFields ?? []), p.ds.naicsField, ...(p.ds.keepFields ?? [])]);
  return uniq([...common, ...valueFieldsOf(p.ds), p.ds.confidentialField, ...(p.ds.keepFields ?? [])]);
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
  platform: 'socrata' | 'arcgis' | 'html' | null;
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
  /** ok: rows parse; mismatch: see schemaProblem; no_rows: the source answered with none; unreachable: no usable answer (see message). */
  schema: 'ok' | 'mismatch' | 'no_rows' | 'unreachable';
  schemaProblem?: string;
  /**
   * Review P2-D: ok when the newest row is inside the scan's window, stale when every row read is older (freshnessNote names the newest
   * date), unknown when no date could be read.
   */
  freshness: 'ok' | 'stale' | 'unknown';
  freshnessNote?: string;
  /** Rows that had the id, a readable date and some text (the shape the config expects). */
  shapeOk: number;
  /** Rows that became a record (a trade matched), with the scan's own clock (rows past an age limit are not counted). */
  parsedRows: number;
  /** Review P2-F: rows the scan's window holds now (a count request), null when the portal did not answer it. */
  windowCount: number | null;
  /** The scan reads at most this many rows per run. */
  rowCap: number;
  /** windowCount above rowCap: the scan would not read the older rows ("row cap reached: N not read"). */
  rowCapNote?: string;
  mapped: MappedRow[];
  message?: string;
  wroteNothing: true;
}

function empty(source: string, extra: Partial<CoverageProbeResult> = {}): CoverageProbeResult {
  return {
    status: 'ok', source, platform: null, endpoint: null, httpStatus: null, rowCount: 0, columns: [], columnsFrom: null, expectedColumns: [],
    missingExpected: [], newestDate: null, schema: 'unreachable', freshness: 'unknown', shapeOk: 0, parsedRows: 0, windowCount: null, rowCap: SCAN_PAGE,
    mapped: [], wroteNothing: true, ...extra,
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

/** One request. `problem` says why there is no body: 'empty response body', 'response was not JSON' (review P2-C), or null. */
async function getJson(doFetch: typeof fetch, url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown; problem: string | null }> {
  const res = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const read = await readJsonBody(res);
  return read.ok ? { status: res.status, body: read.body, problem: null } : { status: res.status, body: null, problem: read.problem };
}

/** Freshness against the scan's window: the newest row read must be within `days` of now. */
function freshness(newestDate: string | null, days: number, now: Date): Pick<CoverageProbeResult, 'freshness' | 'freshnessNote'> {
  if (!newestDate) return { freshness: 'unknown' };
  if (Date.parse(newestDate) >= now.getTime() - days * 86_400_000) return { freshness: 'ok' };
  return { freshness: 'stale', freshnessNote: `no rows in the last ${days} days: newest is ${newestDate.slice(0, 10)}` };
}

function rowCapNote(count: number | null, cap: number): string | undefined {
  return count !== null && count > cap ? `row cap reached: ${count} rows in the window, ${count - cap} would not be read per run` : undefined;
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

const msgOf = (e: unknown) => sanitizeHealthError(e) ?? 'error';

async function probeSocrata(ds: SocrataDataset, doFetch: typeof fetch, now: Date): Promise<CoverageProbeResult> {
  const endpoint = `https://${ds.domain}/resource/${ds.datasetId}.json`;
  const rowCap = SCAN_PAGE * Math.max(1, Math.min(ds.maxPages ?? 1, 6));
  const base = empty(ds.id, { platform: 'socrata', endpoint, expectedColumns: expectedColumns({ platform: 'socrata', ds }), rowCap });
  // Review fix P2-1: a keyed-id source without its key sends nothing, as the scan does.
  if (ds.hashId && !idKeySecret()) return { ...base, schema: 'unreachable', message: 'no id key (HOLLER_BUILDING_REF_SECRET or SUPABASE_SERVICE_ROLE_KEY); no request sent' };
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
  // How many rows the scan's window holds now (same $where as the scan), against the scan's row cap.
  try {
    const cq = new URLSearchParams({ $select: 'count(*) AS n', $where: buildSocrataQuery(ds, now).get('$where') ?? '' });
    const c = await getJson(doFetch, `${endpoint}?${cq.toString()}`, headers);
    const n = Array.isArray(c.body) ? Number((c.body[0] as { n?: unknown; count?: unknown } | undefined)?.n ?? (c.body[0] as { count?: unknown } | undefined)?.count) : NaN;
    if (c.status < 400 && Number.isFinite(n)) {
      base.windowCount = n;
      const note = rowCapNote(n, rowCap);
      if (note) base.rowCapNote = note;
    }
  } catch {
    /* count unknown */
  }
  const q = new URLSearchParams();
  // Review fix P1-2: the same allow-list as the scan.
  if (sendsSelect(ds)) q.set('$select', socrataSelectColumns(ds).join(','));
  q.set('$order', `${ds.queryDateField ?? ds.dateField} DESC`);
  q.set('$limit', String(PROBE_ROWS));
  try {
    const { status, body, problem: readProblem } = await getJson(doFetch, `${endpoint}?${q.toString()}`, headers);
    base.httpStatus = status;
    if (status >= 400 || !Array.isArray(body)) {
      const msg = readProblem ?? (body as { message?: unknown } | null)?.message;
      return finish({ ...base, schema: 'unreachable', ...(msg ? { message: sanitizeHealthError(String(msg)) ?? undefined } : {}) }, [], [], 0, null);
    }
    // The scan's own clock (review P2-D): rows older than the age limit are not counted as parsed.
    const report = parseSocrataReport(body, ds, { now });
    base.newestDate = newest(body.map((r) => (r && typeof r === 'object' ? recordDateIso((r as Record<string, unknown>)[ds.dateField], ds) : null)));
    Object.assign(base, freshness(base.newestDate, ds.maxRecordAgeDays ?? lookbackDays(ds), now));
    base.schema = 'ok';
    const problem = report.shapeOk === 0 ? socrataSchemaProblem(body, ds) ?? (body.length ? 'no row has the id, a readable date and text' : null) : null;
    return finish(base, body, report.items, report.shapeOk, problem);
  } catch (e) {
    return finish({ ...base, schema: 'unreachable', message: msgOf(e) }, [], [], 0, null);
  }
}

async function probeArcgis(ds: ArcgisDataset, doFetch: typeof fetch, now: Date): Promise<CoverageProbeResult> {
  const base = empty(ds.id, { platform: 'arcgis', endpoint: ds.layerUrl, expectedColumns: expectedColumns({ platform: 'arcgis', ds }) });
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  let fields: { names: Set<string>; types: Map<string, string> } | null = null;
  let metaProblem: string | null = null;
  try {
    const meta = await getJson(doFetch, `${ds.layerUrl}?f=json`, headers);
    metaProblem = meta.problem;
    const list = (meta.body as { fields?: { name?: unknown; type?: unknown }[] } | null)?.fields;
    if (meta.status < 400 && Array.isArray(list) && list.length) {
      const pairs = list.map((f) => [String(f?.name ?? ''), typeof f?.type === 'string' ? f.type : ''] as [string, string]).filter(([n]) => n);
      fields = { names: new Set(pairs.map(([n]) => n)), types: new Map(pairs) };
      base.columns = [...fields.names].sort();
      base.columnsFrom = 'column list';
    }
  } catch (e) {
    metaProblem = msgOf(e);
  }
  const check = layerSchemaCheck(ds, fields);
  if (!check) {
    // The scan sends no data query without the field list (review P1-A); the probe says why instead of guessing.
    return { ...base, schema: 'unreachable', message: `could not read the layer's field list${metaProblem ? ` (${metaProblem})` : ''}; the scan sends no query` };
  }
  if (check.problem) {
    // The same refusal the scan makes: no query is sent when the id, date or flag column is not in the layer.
    return {
      ...base,
      schema: 'mismatch',
      schemaProblem: check.problem,
      missingExpected: base.expectedColumns.filter((c) => !base.columns.includes(c)),
      message: 'no rows were requested: the layer lacks a column the config requires',
    };
  }
  // How many rows the scan's window holds now (the scan's own where clause), against its row cap.
  try {
    const cq = buildArcgisQuery(ds, now, undefined, { present: check.present, dateType: check.dateType });
    const p = new URLSearchParams({ where: cq.get('where') ?? '1=1', returnCountOnly: 'true', f: 'json' });
    const c = await getJson(doFetch, `${ds.layerUrl}/query?${p.toString()}`, headers);
    const n = Number((c.body as { count?: unknown } | null)?.count);
    if (c.status < 400 && Number.isFinite(n)) {
      base.windowCount = n;
      const note = rowCapNote(n, SCAN_PAGE);
      if (note) base.rowCapNote = note;
    }
  } catch {
    /* count unknown */
  }
  const wanted = base.expectedColumns.filter((c) => check.present.has(c));
  const q = new URLSearchParams();
  // Review P3-I: rows with no date would sort first on some servers and read as a mismatch.
  q.set('where', `${ds.dateField} IS NOT NULL`);
  q.set('outFields', wanted.join(','));
  q.set('orderByFields', `${ds.dateField} DESC`);
  q.set('resultRecordCount', String(PROBE_ROWS));
  q.set('returnGeometry', 'true');
  q.set('outSR', '4326');
  q.set('f', 'json');
  try {
    const { status, body, problem: readProblem } = await getJson(doFetch, `${ds.layerUrl}/query?${q.toString()}`, headers);
    base.httpStatus = status;
    const b = body as { features?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (status >= 400 || !b || b.error || !Array.isArray(b.features)) {
      const msg = b?.error ? `ArcGIS ${String(b.error.code ?? '')} ${String(b.error.message ?? '')}`.trim() : readProblem;
      return finish({ ...base, schema: 'unreachable', ...(msg ? { message: sanitizeHealthError(msg) ?? undefined } : {}) }, [], [], 0, null);
    }
    const features = b.features as unknown[];
    const attrs = features.map((f) => (f && typeof f === 'object' ? ((f as { attributes?: unknown }).attributes ?? null) : null));
    const report = parseArcgisReport(body, ds);
    base.newestDate = newest(attrs.map((a) => (a && typeof a === 'object' ? arcgisDateToIso((a as Record<string, unknown>)[ds.dateField]) : null)));
    Object.assign(base, freshness(base.newestDate, arcgisLookbackDays(ds), now));
    base.schema = 'ok';
    const problem = report.shapeOk === 0 ? arcgisSchemaProblem(features, ds) ?? (features.length ? 'no row has the id, a readable date and text' : null) : null;
    const out = finish(base, attrs.filter((a) => a !== null), report.items, report.shapeOk, problem);
    out.rowCount = features.length;
    return out;
  } catch (e) {
    return finish({ ...base, schema: 'unreachable', message: msgOf(e) }, [], [], 0, null);
  }
}

/**
 * Round 20 NEXT: the Houston permit report page. One request; the table's header keys stand for the column names; rows are the table rows
 * (capped like the scan) and the mapped rows are the scan's own output after the sample clean-up. No raw cell is returned.
 */
export async function probeHoustonReport(doFetch: typeof fetch, now: Date, access: typeof HOUSTON_ACCESS = HOUSTON_ACCESS): Promise<CoverageProbeResult> {
  const base = empty(HOUSTON_PERMITS_ID, {
    platform: 'html', endpoint: HOUSTON_REPORT_URL, expectedColumns: Object.keys(HOUSTON_HEADERS), rowCap: HOUSTON_ROW_CAP,
  });
  try {
    // Review fix P1-3: the same access gate as the scan (terms record, then robots.txt); nothing is requested until it passes.
    const gate = await houstonAccess(doFetch, now, access);
    if (!gate.ok) return { ...base, schema: 'unreachable', message: gate.reason };
    const res = await doFetch(HOUSTON_REPORT_URL, { headers: { Accept: 'text/html', 'User-Agent': HOUSTON_USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    base.httpStatus = res.status;
    if (!res.ok) return { ...base, schema: 'unreachable', message: `HTTP ${res.status}` };
    const table = readPermitTable(await readBoundedText(res));
    base.columns = [...table.headers].sort();
    base.columnsFrom = table.headers.length ? 'column list' : null;
    base.missingExpected = base.expectedColumns.filter((c) => !table.headers.includes(c));
    base.windowCount = table.seen;
    if (table.seen > HOUSTON_ROW_CAP) base.rowCapNote = rowCapNote(table.seen, HOUSTON_ROW_CAP);
    if (table.problem) return { ...base, schema: table.problem.startsWith('schema mismatch') ? 'mismatch' : 'unreachable', schemaProblem: table.problem };
    const parsed = parseHoustonPermits(table.rows, now);
    base.rowCount = table.rows.length;
    base.shapeOk = parsed.shapeOk;
    base.parsedRows = parsed.items.length;
    base.mapped = parsed.items.slice(0, PROBE_MAPPED).map(mappedRow);
    base.newestDate = newest(table.rows.map((r) => recordDateIso(r.permit_date, HOUSTON_PERMITS_DS)));
    Object.assign(base, freshness(base.newestDate, HOUSTON_PERMITS_DS.maxRecordAgeDays ?? 21, now));
    if (!table.rows.length) return { ...base, schema: 'no_rows' };
    if (parsed.shapeOk === 0) return { ...base, schema: 'mismatch', schemaProblem: 'no row has a project number, a readable permit date and a type' };
    return { ...base, schema: 'ok' };
  } catch (e) {
    return { ...base, schema: 'unreachable', message: msgOf(e) };
  }
}

/** Runs the probe for one source. `doFetch` is passed in so a test can answer without a network. Never throws. */
export async function runCoverageProbe(source: string, doFetch: typeof fetch, now: Date = new Date()): Promise<CoverageProbeResult> {
  if (source === HOUSTON_PERMITS_ID) return probeHoustonReport(doFetch, now);
  const p = find(source);
  if (!p) return { ...empty(source), status: 'unknown_source', schema: 'unreachable' };
  try {
    return p.platform === 'socrata' ? await probeSocrata(p.ds, doFetch, now) : await probeArcgis(p.ds, doFetch, now);
  } catch (e) {
    return empty(source, { platform: p.platform, message: msgOf(e) });
  }
}
