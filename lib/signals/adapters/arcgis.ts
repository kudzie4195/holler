import { HOLLER_UA } from '@/lib/user-agent';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { contactSpecFields, extractContacts, extractJobValue } from '@/lib/contacts/extract';
import { civicLabel, moneyFields, publicSummary, scrubText, summaryPart } from './permit-privacy';
import { permitTitleFor } from '@/lib/signals/mapping/permit';
import { permitStageOf } from '@/lib/signals/stage';
import { CAT_V } from '@/lib/signals/mapping/version';
import { INSPECTION_ID_RE, categorize, classifyPermitRow, inspectionPublicText, inspectionTitle, printableValues, privatePosition, publicAddress } from './socrata';
import { ARCGIS_DATASETS, arcgisLookbackDays, arcgisPageUrl, type ArcgisDataset } from './arcgis-datasets';
import { readJsonBody, schemaMismatchLog, schemaProblem, UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { cleanAddress } from '@/lib/contacts/sanitize';

const LIMIT = 500;
const UA = HOLLER_UA;

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

function dateClause(ds: Pick<ArcgisDataset, 'dateType' | 'dateField'>, op: '>=' | '<=', d: Date): string {
  if (ds.dateType === 'dateOnly') return `${ds.dateField} ${op} date '${toTimestampLiteral(d).slice(0, 10)}'`;
  return `${ds.dateField} ${op} timestamp '${toTimestampLiteral(d)}'`;
}

/** The project value columns of a permit layer: its own list, else the money columns it already prints. */
export function valueFieldsOf(ds: ArcgisDataset): string[] {
  return ds.valueFields ?? moneyFields(ds.summaryFields);
}

/** Fields that decide whether a row is parsed at all. Everything else (contacts, value columns) is an extra that may be left out. */
function requiredFields(ds: ArcgisDataset): Set<string> {
  return new Set<string>(
    [ds.idField, ...(ds.idFields ?? []), ds.dateField, ds.confidentialField, ds.latField, ds.lonField, ds.nameField, ds.zipField, ...ds.titleFields, ...ds.textFields, ...ds.summaryFields, ...(ds.addressFields ?? [])].filter(
      (x): x is string => Boolean(x),
    ),
  );
}

/** Extras the layer may or may not have: contact columns and value columns that are not required fields. */
export function optionalFields(ds: ArcgisDataset): string[] {
  const req = requiredFields(ds);
  return [...new Set([...contactSpecFields(ds.contacts), ...valueFieldsOf(ds)])].filter((f) => !req.has(f));
}

/**
 * `allowed` (when given): optional fields are asked for only when they are in this set (the layer's own field list, resolveOptionalFields).
 * Without it every field is asked for, as before.
 */
function outFields(ds: ArcgisDataset, allowed?: ReadonlySet<string>, present?: ReadonlySet<string>): string {
  const req = requiredFields(ds);
  const optional = optionalFields(ds).filter((f) => !allowed || allowed.has(f));
  // The status column is asked for by name (stage tracking), not left to be there because summaryFields happens to list it.
  const all = [...new Set([...req, ...optional, ...(ds.subtype === 'permit' && ds.statusField ? [ds.statusField] : [])])];
  // Round 19 coverage: a schema-unverified layer is asked only for the columns its own field list has (an unknown outField fails the query).
  return (present ? all.filter((f) => present.has(f)) : all).join(',');
}

const FIELD_CACHE_MS = 6 * 3_600_000;
/** Per dataset: the layer's field names with their Esri types ('' when the type was not given), or null when the list could not be read. */
const fieldCache = new Map<string, { at: number; names: Set<string> | null; types?: Map<string, string> }>();

/** Test hook: forget the layers' field lists. */
export function resetArcgisFieldCache(): void {
  fieldCache.clear();
}

/**
 * The optional fields (contacts, project value) that this layer really has, read once per 6 hours from `<layer>?f=json`. An ArcGIS
 * layer answers an unknown outField with an error and no rows, so a wrong candidate column must never reach the data query. Fields
 * the layer lacks are logged once per read. When the field list cannot be read, no optional field is asked for (the permits still
 * arrive, without names or values) and that is logged too. Names match exactly (attributes come back under the layer's own spelling).
 */
export async function resolveOptionalFields(ds: ArcgisDataset, ctx: AdapterContext, now: Date): Promise<Set<string>> {
  const wanted = optionalFields(ds);
  if (wanted.length === 0) return new Set();
  const hit = cachedFields(ds, now);
  if (hit !== undefined) return new Set(wanted.filter((f) => hit?.names.has(f)));
  // Not cached: read it now (layerFields caches it), and say once per read what is missing.
  const read = await layerFields(ds, ctx, now);
  const names = read?.names ?? null;
  if (!names) ctx.log(`${ds.id}: could not read the layer's field list; contact and value columns are skipped this time`);
  else {
    const missing = wanted.filter((f) => !names.has(f));
    if (missing.length) ctx.log(`${ds.id}: layer has no field ${missing.join(', ')}; skipped`);
  }
  return new Set(wanted.filter((f) => names?.has(f)));
}

/**
 * Query parameters for `<layer url>/query`. The where clause is a fixed lookback on the date field
 * (so it does not depend on when the last scan ran), newest first, hard row limit, geometry reprojected to WGS84.
 */
export function buildArcgisQuery(
  ds: ArcgisDataset,
  now: Date = new Date(),
  allowed?: ReadonlySet<string>,
  schema?: { present?: ReadonlySet<string>; dateType?: ArcgisDataset['dateType'] },
): URLSearchParams {
  const from = new Date(now.getTime() - arcgisLookbackDays(ds) * 86_400_000);
  const dated = { dateField: ds.dateField, dateType: schema?.dateType ?? ds.dateType };
  const clauses = [dateClause(dated, '>=', from)];
  if (ds.windowForwardDays != null) clauses.push(dateClause(dated, '<=', new Date(now.getTime() + ds.windowForwardDays * 86_400_000)));
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  const p = new URLSearchParams();
  p.set('where', clauses.join(' AND '));
  p.set('outFields', outFields(ds, allowed, schema?.present));
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

function title(ds: ArcgisDataset, titleBitsRaw: string[], summaryBits: string[], address: string, categories: readonly string[] = [], withheld = false): string {
  // Free-text columns can hold names and phone numbers: titles never copy them raw. Permit titles come from lib/signals/mapping/permit.ts.
  // A 311 or violation title whose own text was withheld (socrata.ts printableValues) uses fixed words for its trades.
  const titleBits = ds.subtype === 'business' ? titleBitsRaw : titleBitsRaw.map(scrubText).filter(Boolean);
  switch (ds.subtype) {
    case '311':
      return `311 request in ${ds.city}: ${trunc([...new Set(titleBits)].join(' / ') || (withheld ? civicLabel(categories, 'service request') : 'service request'), 110)}`;
    case 'business':
      return titleBits[0]
        ? `New business in ${ds.city}: ${trunc(titleBits[0], 100)}`
        : `New business license in ${ds.city}: ${trunc(summaryBits[0] ?? 'business', 100)}`;
    case 'violation':
      return `Code violation in ${ds.city}: ${trunc(titleBits[0] ?? (withheld ? civicLabel(categories, 'property violation') : 'property violation'), 110)}`;
    case 'event-permit':
      return `Permitted event in ${ds.city}: ${trunc(titleBits[0] ?? 'special event', 80)}${address ? ` at ${trunc(address, 60)}` : ''}`;
    default:
      return inspectionTitle(ds.city);
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
      const externalId = arcgisExternalId(a, ds);
      const text = ds.textFields.map((x) => str(a, x)).filter(Boolean).join(' | ');
      if (!occurredAt || !externalId || !text) continue;
      // review4 P2-4: an inspection id is part of the public row only when it is a plain id.
      if (ds.subtype === 'inspection' && !INSPECTION_ID_RE.test(externalId)) continue;
      report.shapeOk += 1;
      if (seen.has(externalId)) continue;
      // Round 19 coverage (review P1-A): a confidential case is dropped whole, and so is a row that does not carry the flag at all.
      if (ds.confidentialField && (!(ds.confidentialField in a) || isConfidential(a[ds.confidentialField]))) continue;

      const permitClass = ds.subtype === 'permit' ? classifyPermitRow(ds, (x) => str(a, x)) : null;
      const { categories, severity } = permitClass ? { categories: permitClass.categories, severity: 1 as const } : categorize(ds, text);
      if (categories.length === 0) continue;

      seen.add(externalId);
      // Who to contact: private, from the columns the layer's contact spec names only (arcgis-datasets.ts CONTACT_SPECS).
      const contacts = ds.contacts ? extractContacts((x) => str(a, x), ds.contacts, { city: ds.city, state: ds.state }, ds.subtype) : [];
      // Permits: the project value the layer published, as a number (PLAN-2.0 1.3). The summary prints the same amount where it has one.
      const jobValue = ds.subtype === 'permit' ? extractJobValue((x) => str(a, x), valueFieldsOf(ds)) : null;
      const pos = privatePosition(position({ attributes: a, geometry: feat.geometry }, ds), ds.subtype);
      let itemTitle: string;
      let summary: string | null;
      let zip: string | null;
      if (ds.subtype === 'inspection') {
        // Public output by construction: no name column, no title field, no free text (socrata.ts inspectionPublicText).
        const pub = inspectionPublicText(ds, (x) => str(a, x));
        itemTitle = pub.title;
        summary = pub.summary;
        zip = pub.zip;
      } else {
        const titlePrint = printableValues(ds, ds.titleFields, (x) => str(a, x));
        const titleBits = titlePrint.values;
        const joined = (ds.addressFields ?? []).map((x) => str(a, x)).filter(Boolean).join(' ');
        // Review P1-B: an unverified address column may hold a name. Only what the shared site-address rule keeps is used, else nothing.
        const rawAddress = ds.strictAddress ? (cleanAddress(joined) ?? '') : joined;
        const summaryBits = ds.summaryFields
          .filter((x) => printableValues(ds, [x], (y) => str(a, y)).values.length > 0)
          .map((x) => summaryPart(x, str(a, x)))
          // DeKalb's statusDescription holds the literal text "Issued Status Code" on live rows: a field label, not a status (final review, Q3 pattern 3).
          .filter((b) => Boolean(b) && !/^issued status code$/i.test(b.trim()));
        // Business rows never carry a street address (home addresses of sole proprietors).
        const address = ds.subtype === 'business' ? '' : publicAddress(ds.subtype, rawAddress);
        const parts = [...new Set(summaryBits)];
        if (address && ds.subtype !== '311') parts.push(address);
        itemTitle = permitClass ? permitTitleFor(ds.city, permitClass.label) : title(ds, titleBits, summaryBits, address, categories, titlePrint.withheld);
        summary = ds.subtype === 'business' ? trunc(parts.join(' | '), 280) || null : publicSummary(parts, { minChars: ds.subtype === 'permit' ? 15 : undefined });
        zip = str(a, ds.zipField).slice(0, 5) || null;
      }
      const permitStage = ds.subtype === 'permit' && ds.statusField ? permitStageOf(str(a, ds.statusField)) : null;
      report.items.push({
        source: ds.id,
        externalId,
        kind: ds.kind,
        title: itemTitle,
        summary,
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
          cat_v: CAT_V,
          ...(pos?.approx ? { approxLocation: true } : {}),
          ...(jobValue !== null ? { jobValue } : {}),
        },
        ...(contacts.length ? { contacts } : {}),
        ...(permitStage ? { permitStage } : {}),
      });
    } catch {
      // skip malformed feature
    }
  }
  return report;
}

/** The row's id: the id column, or the composite id columns joined with ':' (all must be present). */
export function arcgisExternalId(a: Attrs, ds: Pick<ArcgisDataset, 'idField' | 'idFields'>): string {
  if (ds.idFields?.length) {
    const parts = ds.idFields.map((f) => str(a, f));
    return parts.every(Boolean) ? parts.join(':') : '';
  }
  return str(a, ds.idField);
}

/**
 * Round 19 coverage: what the layer's own field list says about a schema-unverified dataset BEFORE the query. `problem` is set when the
 * id or date column is missing, the date column is text, or no text column exists (no row could ever parse): the adapter then reports
 * "schema mismatch: ..." and does not query. `present` is the layer's field names (the query asks only for those); `dateType` follows
 * the layer's own type. Null when the field list could not be read (the configured query is then sent as is).
 */
export function layerSchemaCheck(
  ds: ArcgisDataset,
  fields: { names: ReadonlySet<string>; types?: ReadonlyMap<string, string> } | null,
): { problem: string | null; present: ReadonlySet<string>; dateType: ArcgisDataset['dateType'] } | null {
  if (!fields) return null;
  const { names, types } = fields;
  const missing = [...(ds.idFields?.length ? ds.idFields : [ds.idField]), ds.dateField, ...(ds.confidentialField ? [ds.confidentialField] : [])].filter((f) => !names.has(f));
  if (missing.length) return { problem: `expected ${[...new Set(missing)].join(', ')}`, present: names, dateType: ds.dateType };
  const t = types?.get(ds.dateField) ?? '';
  if (t === 'esriFieldTypeString') return { problem: `${ds.dateField} is text, not a date field`, present: names, dateType: ds.dateType };
  if (!ds.textFields.some((f) => names.has(f))) return { problem: `expected one of ${ds.textFields.join(', ')}`, present: names, dateType: ds.dateType };
  const dateType: ArcgisDataset['dateType'] = t === 'esriFieldTypeDateOnly' ? 'dateOnly' : t === 'esriFieldTypeDate' ? 'date' : ds.dateType;
  return { problem: null, present: names, dateType };
}

/** The cached field list of a layer (read by resolveOptionalFields or layerFields), or undefined when none is cached. */
function cachedFields(ds: ArcgisDataset, now: Date): { names: Set<string>; types?: Map<string, string> } | null | undefined {
  const hit = fieldCache.get(ds.id);
  if (!hit || now.getTime() - hit.at >= FIELD_CACHE_MS) return undefined;
  return hit.names ? { names: hit.names, types: hit.types } : null;
}

/** The layer's field list (names and types), read once per 6 hours like resolveOptionalFields; null when it cannot be read. */
export async function layerFields(ds: ArcgisDataset, ctx: AdapterContext, now: Date): Promise<{ names: Set<string>; types?: Map<string, string> } | null> {
  const hit = cachedFields(ds, now);
  if (hit !== undefined) return hit;
  let out: { names: Set<string>; types?: Map<string, string> } | null = null;
  try {
    const res = await ctx.fetch(`${ds.layerUrl}?f=json`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(requestTimeoutMs(ds)) });
    if (res.ok) {
      const body = (await res.json()) as { fields?: { name?: unknown; type?: unknown }[] };
      if (Array.isArray(body.fields) && body.fields.length > 0) {
        const pairs = body.fields.map((f) => [String(f?.name ?? ''), typeof f?.type === 'string' ? f.type : ''] as [string, string]).filter(([n]) => Boolean(n));
        out = { names: new Set(pairs.map(([n]) => n)), types: new Map(pairs) };
      }
    }
  } catch {
    out = null;
  }
  fieldCache.set(ds.id, { at: now.getTime(), names: out?.names ?? null, types: out?.types });
  return out;
}

/** Round 19 coverage: why no row of a schema-unverified layer parsed (rows came back, none had the id or a readable date), or null. */
export function arcgisSchemaProblem(features: readonly unknown[], ds: ArcgisDataset): string | null {
  const attrs = features.map((f) => (f && typeof f === 'object' ? (f as { attributes?: unknown }).attributes : null));
  return schemaProblem(attrs, {
    idFields: ds.idFields?.length ? ds.idFields : [ds.idField],
    dateField: ds.dateField,
    readsAsDate: (v) => arcgisDateToIso(v) !== null,
  });
}

/** Review P1-A: any truthy flag value marks a confidential case: Y, YES, TRUE, T, 1 (any case, spaces ignored), or boolean true / number 1. */
export function isConfidential(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v !== 'string' && typeof v !== 'number') return false;
  return ['Y', 'YES', 'TRUE', 'T', '1'].includes(String(v).replace(/\s+/g, '').toUpperCase());
}

/** Per-request limit: short for a schema-unverified (probation) layer, so an unchecked portal cannot hold the scan (review P2-E). */
export function requestTimeoutMs(ds: Pick<ArcgisDataset, 'schemaUnverified'>): number {
  return ds.schemaUnverified ? UNVERIFIED_REQUEST_TIMEOUT_MS : 15000;
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
    ...(ds.probation ? { probation: true } : {}),
    sourceUrl: arcgisPageUrl(ds),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const now = ctx.now ?? new Date();
        // Round 19 coverage: a schema-unverified layer is checked against its own field list first (layerSchemaCheck).
        let schema: ReturnType<typeof layerSchemaCheck> = null;
        if (ds.schemaUnverified) {
          schema = layerSchemaCheck(ds, await layerFields(ds, ctx, now));
          if (!schema) {
            // Review P1-A: without the field list no column can be checked (the confidential flag included), so no data query is sent.
            ctx.log(`error: ${ds.id}: could not read the layer's field list; no query sent this run`);
            return [];
          }
          if (schema.problem) {
            ctx.log(`error: schema mismatch: ${schema.problem} (${ds.id}: from the layer's field list; no query sent)`);
            return [];
          }
        }
        const allowed = await resolveOptionalFields(ds, ctx, now);
        const url = `${ds.layerUrl}/query?${buildArcgisQuery(ds, now, allowed, schema ? { present: schema.present, dateType: schema.dateType } : undefined).toString()}`;
        const res = await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(requestTimeoutMs(ds)) });
        if (!res.ok) {
          ctx.log(`${ds.id}: HTTP ${res.status}`);
          return [];
        }
        let body: unknown;
        if (ds.schemaUnverified) {
          const read = await readJsonBody(res);
          if (!read.ok) {
            ctx.log(`error: ${ds.id}: ${read.problem} (HTTP ${res.status})`);
            return [];
          }
          body = read.body;
        } else body = await res.json();
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
          const feats = (body as { features: unknown[] }).features;
          const problem = report.shapeOk === 0 && ds.schemaUnverified ? arcgisSchemaProblem(feats, ds) : null;
          if (problem) {
            ctx.log(schemaMismatchLog(ds.id, problem, feats.map((f) => (f && typeof f === 'object' ? (f as { attributes?: unknown }).attributes : null))));
          } else if (report.shapeOk === 0) {
            ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
          } else {
            ctx.log(`${ds.id}: ${report.rows} rows, 0 matched a trade`);
          }
        }
        // Review P2-F: a full page (or the server's own flag) means older rows in the window were not read. Paging is a promotion step.
        if (ds.schemaUnverified && (report.rows >= LIMIT || (body as { exceededTransferLimit?: unknown }).exceededTransferLimit === true)) {
          ctx.log(`${PROBATION_NOTE_PREFIX} row cap reached: ${report.rows} rows read (limit ${LIMIT}); older rows in the window were not read`);
        }
        return report.items;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Review P2-C: for an unverified source every failure reads as an error, so it never shows as "ok".
        ctx.log(ds.schemaUnverified ? `error: ${ds.id}: ${msg}` : `${ds.id}: ${msg}`);
        return [];
      }
    },
  };
}

/** Only verified layers are enabled by default. */
export const adapters: Adapter[] = ARCGIS_DATASETS.filter((d) => d.verified).map(buildArcgisAdapter);
