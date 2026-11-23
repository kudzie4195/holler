import { PROBATION_FETCH_FLAG, probationFetchOn } from './probation-fetch';
import { HOLLER_UA } from '@/lib/user-agent';
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
import { SALES_DATASETS, PHL_CARTO, type SaleDataset } from './adapters/sales-datasets';
import { SALE_MAX_PAGES, SALE_PAGE, arcgisSaleWhere, cartoSaleWhere, cartoUrl, fetchSaleRows, parseSaleRows, saleRecordDate, saleSchemaProblem, socrataWhere } from './adapters/sales';
import { idKeySecret } from './id-key';
import { HOUSTON_ACCESS, HOUSTON_HEADERS, HOUSTON_PERMITS_DS, HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, HOUSTON_ROW_CAP, fetchHoustonReport, houstonAccess, parseHoustonPermits, readBoundedText, readPermitTable } from './adapters/houston-permits';
import { PAGE_WATCH_DATASETS, type PageWatchDataset } from './adapters/page-watch-datasets';
import { PW_ROW_CAP, runPageWatch, type PageWatchCheck, type PageWatchCounts } from './adapters/page-watch';

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
const UA = HOLLER_UA;
/** Per request (review P3-I): four requests at most, inside the route's 60 s. */
const TIMEOUT_MS = 10000;
/** The scan's row cap per run (one page of 500; Socrata datasets with maxPages read more). */
const SCAN_PAGE = 500;

type Probed = { platform: 'socrata'; ds: SocrataDataset } | { platform: 'arcgis'; ds: ArcgisDataset } | { platform: 'page-watch'; ds: PageWatchDataset };

/** Probation datasets the probe accepts (Socrata and ArcGIS, the round 20 property sale sources, the Houston permit report page and the registered page-watch pages), sorted. */
export function coverageProbeSourceIds(): string[] {
  return [...[...SOCRATA_DATASETS, ...ARCGIS_DATASETS, ...SALES_DATASETS, ...PAGE_WATCH_DATASETS].filter((d) => d.verified && d.probation).map((d) => d.id), HOUSTON_PERMITS_ID].sort();
}

function find(id: string): Probed | null {
  const s = SOCRATA_DATASETS.find((d) => d.id === id && d.verified && d.probation);
  if (s) return { platform: 'socrata', ds: s };
  const a = ARCGIS_DATASETS.find((d) => d.id === id && d.verified && d.probation);
  if (a) return { platform: 'arcgis', ds: a };
  // Every page-watch dataset answers (an unregistered or unchecked one with its gate and zero requests).
  const w = PAGE_WATCH_DATASETS.find((d) => d.id === id && d.probation);
  return w ? { platform: 'page-watch', ds: w } : null;
}

const uniq = (xs: (string | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** Every column the config reads (id, date, text, title, summary, address, zip, coordinates, status, contacts, value). */
export function expectedColumns(p: Probed): string[] {
  if (p.platform === 'page-watch') return [];
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
  platform: 'socrata' | 'arcgis' | 'carto' | 'html' | 'page-watch' | null;
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
  /** Round 20 sales with a second dataset (NYC legals, Cook County addresses): its id, its column list and the expected columns it lacks. */
  join?: { dataset: string; columns: string[]; missingExpected: string[] };
  /**
   * Round 20 page watch only: the adapter's own check state (robots_disallowed, not_html, parser_mismatch, empty, timeout ...), the
   * counts of the validation, the platform and parser, and every kept row as title, due date, trades and link (never a person's name:
   * the parser does not read contact columns and the title is cleaned of e-mails, phones and "Contact:" text).
   */
  pageWatch?: {
    check: PageWatchCheck;
    detail: string | null;
    platform: string;
    parser: string;
    /** false: not registered with the scan (vendor terms unread). */
    registered: boolean;
    /** Requests sent to the source's hosts by this probe (0 while its terms are not checked or the switch is off). */
    requests: number;
    counts: PageWatchCounts;
    rows: { title: string; dueDate: string | null; trades: string[]; url: string | null; proposedLabel: string | null }[];
  };
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

async function socrataColumns(doFetch: typeof fetch, domain: string, datasetId: string): Promise<string[] | null> {
  try {
    const meta = await getJson(doFetch, `https://${domain}/api/views/${datasetId}.json`, { Accept: 'application/json', 'User-Agent': UA });
    const cols = (meta.body as { columns?: { fieldName?: unknown }[] } | null)?.columns;
    if (meta.status < 400 && Array.isArray(cols) && cols.length) return uniq(cols.map((c) => (typeof c?.fieldName === 'string' ? c.fieldName : undefined))).sort();
  } catch {
    /* rows only */
  }
  return null;
}

/**
 * Round 20 SALES: the probe of a property sale source. Same answer shape as a coverage source. Every request it sends is one the scan
 * itself would send (lib/signals/adapters/sales.ts builders, which refuse any party column), plus the column list and a row count.
 */
async function probeSale(ds: SaleDataset, doFetch: typeof fetch, now: Date): Promise<CoverageProbeResult> {
  const endpoint = ds.platform === 'socrata' ? `https://${ds.domain}/resource/${ds.datasetId}.json` : ds.platform === 'arcgis' ? (ds.layerUrl ?? null) : PHL_CARTO;
  const base = empty(ds.id, { platform: ds.platform, endpoint, expectedColumns: [...ds.columns], rowCap: SALE_PAGE * SALE_MAX_PAGES });
  const headers = { Accept: 'application/json', 'User-Agent': UA };
  if (ds.platform === 'socrata') {
    const cols = await socrataColumns(doFetch, ds.domain!, ds.datasetId!);
    if (cols) {
      base.columns = cols;
      base.columnsFrom = 'column list';
    }
    if (ds.join) {
      const jc = await socrataColumns(doFetch, ds.domain!, ds.join.datasetId);
      base.join = { dataset: ds.join.datasetId, columns: jc ?? [], missingExpected: jc ? ds.join.columns.filter((c) => !jc.includes(c)) : [] };
    }
  }
  // How many rows the scan's window holds now (the scan's own where clause), against its row cap.
  try {
    let n = NaN;
    if (ds.platform === 'socrata') {
      const c = await getJson(doFetch, `${endpoint}?${new URLSearchParams({ $select: 'count(*) AS n', $where: socrataWhere(ds, now) }).toString()}`, headers);
      if (c.status < 400 && Array.isArray(c.body)) n = Number((c.body[0] as { n?: unknown } | undefined)?.n);
    } else if (ds.platform === 'arcgis') {
      const c = await getJson(doFetch, `${ds.layerUrl}/query?${new URLSearchParams({ where: arcgisSaleWhere(ds, now), returnCountOnly: 'true', f: 'json' }).toString()}`, headers);
      if (c.status < 400) n = Number((c.body as { count?: unknown } | null)?.count);
    } else {
      const c = await getJson(doFetch, cartoUrl(`SELECT count(*) AS n FROM ${ds.cartoFrom} WHERE ${cartoSaleWhere(ds, now)}`), headers);
      if (c.status < 400) n = Number(((c.body as { rows?: { n?: unknown }[] } | null)?.rows ?? [])[0]?.n);
    }
    if (Number.isFinite(n)) {
      base.windowCount = n;
      const note = rowCapNote(n, base.rowCap);
      if (note) base.rowCapNote = note;
    }
  } catch {
    /* count unknown */
  }
  const got = await fetchSaleRows(ds, doFetch, now, { limit: PROBE_ROWS, pages: 1, budgetMs: 30_000 });
  base.httpStatus = got.httpStatus;
  if (got.columns && base.columnsFrom === null) {
    base.columns = got.columns;
    base.columnsFrom = 'column list';
  }
  const err = got.logs.find((l) => l.startsWith('error'));
  if (err) {
    const msg = sanitizeHealthError(err) ?? 'error';
    const stale = /no rows in the last \d+ days: newest is (\d{4}-\d{2}-\d{2})/.exec(err);
    if (stale) {
      const out = finish({ ...base, schema: 'no_rows', newestDate: `${stale[1]}T00:00:00.000Z`, freshness: 'stale', freshnessNote: err.replace(/^error: [^:]+: /, '') }, [], [], 0, null);
      out.schema = 'no_rows';
      return out;
    }
    if (/schema mismatch:/.test(err)) {
      return { ...base, schema: 'mismatch', schemaProblem: msg.replace(/^.*schema mismatch: /, ''), missingExpected: base.columnsFrom ? base.expectedColumns.filter((c) => !base.columns.includes(c)) : [], message: msg };
    }
    return { ...base, schema: 'unreachable', message: msg };
  }
  const report = parseSaleRows(got.rows, ds, now);
  base.newestDate = newest(got.rows.map((r) => saleRecordDate(ds, r[ds.dateField])));
  Object.assign(base, freshness(base.newestDate, ds.lookbackDays, now));
  base.schema = 'ok';
  const problem = report.shapeOk === 0 ? saleSchemaProblem(got.rows, ds) ?? (got.rows.length ? 'no row has the id and a readable date' : null) : null;
  return finish(base, got.rows, report.items, report.shapeOk, problem);
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
    const res = await fetchHoustonReport(doFetch, now, TIMEOUT_MS);
    base.httpStatus = res.status;
    if (!res.ok) return { ...base, schema: 'unreachable', message: `HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ' (redirect not followed)' : ''}` };
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

/**
 * Round 20 page watch: robots.txt, one fetch of the page and the same parser and validation as the scan, with no marker read or written
 * and no Firecrawl call (a Firecrawl-only page says so and points to /api/admin/firecrawl-probe). Returns the parsed rows.
 */
export async function probePageWatch(ds: PageWatchDataset, doFetch: typeof fetch, now: Date): Promise<CoverageProbeResult> {
  const r = await runPageWatch(ds, { fetch: doFetch, now, probe: true, db: null, dry: true, budgetMs: 25_000 });
  const reached = r.httpStatus !== null && r.httpStatus < 400;
  const schema: CoverageProbeResult['schema'] =
    r.check === 'parser_mismatch' || r.check === 'not_html' || r.check === 'not_json' ? 'mismatch' : r.check === 'empty' ? 'no_rows' : reached && r.counts.read > 0 ? 'ok' : reached ? 'no_rows' : 'unreachable';
  const dues = r.kept.map((s) => s.expiresAt ?? null).filter((x): x is string => !!x);
  return {
    ...empty(ds.id, { platform: 'page-watch', endpoint: ds.url.split('?')[0], rowCap: PW_ROW_CAP }),
    httpStatus: r.httpStatus,
    rowCount: r.counts.read,
    schema,
    ...(schema === 'mismatch' ? { schemaProblem: `${r.check}${r.detail ? `: ${r.detail}` : ''}` } : {}),
    shapeOk: r.counts.read - r.counts.noTitle,
    parsedRows: r.kept.length,
    newestDate: dues.length ? dues.sort().at(-1) ?? null : null,
    ...(r.check === 'row_cap' ? { rowCapNote: r.notes.find((n) => /row cap/.test(n)) } : {}),
    mapped: r.kept.slice(0, PROBE_MAPPED).map(mappedRow),
    ...(r.detail && schema !== 'mismatch' ? { message: r.detail } : {}),
    pageWatch: {
      check: !ds.verified && r.check === 'terms_not_checked' ? 'terms_not_checked' : r.check,
      detail: r.detail,
      platform: ds.platform,
      parser: ds.parser,
      registered: ds.verified,
      requests: r.requests,
      counts: r.counts,
      rows: r.kept.slice(0, 25).map((s) => {
        const d = (s.data ?? {}) as Record<string, unknown>;
        return { title: s.title, dueDate: typeof d.dueDate === 'string' ? d.dueDate : null, trades: [...s.categories], url: s.url ?? null, proposedLabel: typeof d.proposedLabel === 'string' ? d.proposedLabel : null };
      }),
    },
  };
}

/** Runs the probe for one source. `doFetch` is passed in so a test can answer without a network. Never throws. */
export async function runCoverageProbe(source: string, doFetch: typeof fetch, now: Date = new Date()): Promise<CoverageProbeResult> {
  // Round 21 final review P1-1: the one off switch for every probation request (every source this probe accepts is on probation).
  if (!probationFetchOn() && coverageProbeSourceIds().includes(source)) {
    return { ...empty(source), schema: 'unreachable', message: `${PROBATION_FETCH_FLAG} is off: no request sent` };
  }
  const sale = SALES_DATASETS.find((d) => d.id === source && d.verified && d.probation);
  if (sale) {
    try {
      return await probeSale(sale, doFetch, now);
    } catch (e) {
      return empty(source, { platform: sale.platform, message: msgOf(e) });
    }
  }
  if (source === HOUSTON_PERMITS_ID) return probeHoustonReport(doFetch, now);
  const p = find(source);
  if (!p) return { ...empty(source), status: 'unknown_source', schema: 'unreachable' };
  try {
    if (p.platform === 'page-watch') return await probePageWatch(p.ds, doFetch, now);
    return p.platform === 'socrata' ? await probeSocrata(p.ds, doFetch, now) : await probeArcgis(p.ds, doFetch, now);
  } catch (e) {
    return empty(source, { platform: p.platform, message: msgOf(e) });
  }
}
