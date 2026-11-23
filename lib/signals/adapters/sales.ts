import { HOLLER_UA } from '@/lib/user-agent';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import type { CategoryId } from '@/lib/signals/categories';
import { cleanAddress } from '@/lib/contacts/sanitize';
import { cityBySlug, haversineMi, lookupZip } from '@/lib/geo';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { readJsonBody, schemaMismatchLog, schemaProblem, UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import { blockAddress, toFloatingLocal, toIso } from './socrata';
import { arcgisDateToIso, toTimestampLiteral } from './arcgis';
import { normalizeCartoDate } from './carto';
import { MIN_SALE_PRICE, PHL_CARTO, RESIDENTIAL_CLASSES, SALES_DATASETS, saleRequestColumns, type SaleClass, type SaleDataset } from './sales-datasets';

/**
 * Round 20 SALES: the adapter for recorded property sales and deed transfers (configs in sales-datasets.ts, every one on probation).
 *
 * PRIVACY, enforced in the query: every request names its columns (Socrata $select, ArcGIS outFields, Carto SELECT list) from the config,
 * and every builder refuses (throws) a column that could hold a party (PARTY_COLUMN_RE), so a buyer, seller, grantor, grantee, owner,
 * mailing or attention value is never fetched. A record then keeps ONLY: the street address as lib/contacts cleanAddress keeps it (in a
 * private 'site' contact, never in the title or summary), the sale or recording date, a price BAND (the price itself is never stored), the
 * property class, a known place name (borough or city from the gazetteer, never a raw column value), and a point rounded to a block.
 *
 * Title: "Home sold in Brooklyn, NY", "Condo sold in ...", "Multi-family building sold in ...", "Commercial property sold in ...".
 * Summary: "Price band: $250k–$500k | Single-family home". Never a name, never "new owner", never "they need you".
 *
 * Failure states (the same strings the coverage feeds write, read by lib/signals/probation.ts probationCheck):
 *   schema mismatch  "error: schema mismatch: ..."            (missing id / date / price / class / address column, 400 on the column list)
 *   not JSON         "error: <id>: response was not JSON" / "empty response body"
 *   no recent rows   "error: <id>: no rows in the last N days: newest is YYYY-MM-DD"
 *   row cap          "probation note: row cap reached: ..."     (not a failure)
 *   timeout          the scan's own "timeout" (run.ts), and this adapter stops itself inside SALE_BUDGET_MS
 */

// Round 21: the one Holler user agent (lib/user-agent.ts, round 20 WATCH), here too.
const UA = HOLLER_UA;
/** Rows per page. */
export const SALE_PAGE = 500;
/** Pages per run (newest first): the row cap is SALE_PAGE x SALE_MAX_PAGES. */
export const SALE_MAX_PAGES = 2;
/** Keys per join request (Socrata `in (...)`). */
export const JOIN_BATCH = 100;
/** The adapter's own time budget: under the scan's 12 s probation limit (run.ts PROBATION_TIMEOUT_MS), so it ends cleanly first. */
export const SALE_BUDGET_MS = 10_000;
/** A second page is read only with this much budget left, so the join still has time (review P3). */
export const PAGE2_MIN_LEFT_MS = 6_500;

/**
 * A column that could hold a party to a sale. A request naming one is refused before it is sent. `name` alone is not here: street_name and
 * prop_address_city_name are places; any other *_name column must be listed in SALE_NAME_COLUMN_OK to be requested at all.
 */
export const PARTY_COLUMN_RE = /buyer|seller|grantor|grantee|part(?:y|ies)|owner|own_|attention|\battn|mail|legal|taxpayer|purchaser|vendor|occupant|resident|contact/i;
export const SALE_NAME_COLUMN_OK: readonly string[] = ['street_name', 'prop_address_city_name'];

/** Throws when a column could name a party. Used by every request builder (defence in depth: the configs never list one). */
export function assertSafeColumn(col: string): string {
  const bare = col.replace(/^[a-z]\./i, '');
  if (PARTY_COLUMN_RE.test(bare)) throw new Error(`sale query refused: ${bare} could name a party`);
  if (/name/i.test(bare) && !SALE_NAME_COLUMN_OK.includes(bare)) throw new Error(`sale query refused: ${bare} could name a party`);
  return col;
}

function safe(cols: readonly string[]): string[] {
  return cols.map(assertSafeColumn);
}

// ---- what a record says -------------------------------------------------------------------------------------------------------------

export const PRICE_BANDS = ['under $250k', '$250k–$500k', '$500k–$1M', 'over $1M'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export function priceBand(price: number): PriceBand {
  if (price < 250_000) return 'under $250k';
  if (price < 500_000) return '$250k–$500k';
  if (price < 1_000_000) return '$500k–$1M';
  return 'over $1M';
}

/** A price column value as a number (12345, "12345.00", "$1,250,000"), or null. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const SALE_TITLE_NOUN: Record<SaleClass, string> = {
  residential_single: 'Home',
  condo: 'Condo',
  multi_family: 'Multi-family building',
  commercial: 'Commercial property',
};

export const SALE_CLASS_LABEL: Record<SaleClass, string> = {
  residential_single: 'Single-family home',
  condo: 'Condo',
  multi_family: 'Multi-family building',
  commercial: 'Commercial property',
};

/**
 * Trades a sale is a heads-up for. A deed is published 2 to 8 weeks after closing, so only work that a home or building still needs in
 * its first months is listed (review P2-2): yard care and fences, painting, flooring, handyman work, recurring cleaning, pest control and
 * HVAC service plans, and alarm and security systems; for a commercial property, commercial cleaning and security. NOT listed: moving
 * (the move is over), locksmith (rekeying happens at closing), signs and printing (they follow a new business, not a deed). Pool service
 * only where pools are common (saleTradesFor: Miami single-family homes).
 */
export const SALE_TRADES: Record<SaleClass, readonly CategoryId[]> = {
  residential_single: ['cleaning', 'landscaping', 'lawn-care', 'painting', 'flooring', 'fencing', 'security', 'pest-control', 'handyman', 'hvac'],
  condo: ['cleaning', 'painting', 'flooring', 'security', 'pest-control', 'handyman', 'hvac'],
  multi_family: ['cleaning', 'landscaping', 'lawn-care', 'painting', 'flooring', 'fencing', 'security', 'pest-control', 'handyman', 'hvac'],
  commercial: ['janitorial-commercial', 'security'],
};

/** Metros where a single-family sale also tags pool service (pools are common there). */
export const POOL_METROS: ReadonlySet<string> = new Set(['miami']);

/** The trades a sale of this class in this source's metro reaches. */
export function saleTradesFor(ds: { metro: string }, cls: SaleClass): CategoryId[] {
  return [...SALE_TRADES[cls], ...(cls === 'residential_single' && POOL_METROS.has(ds.metro) ? (['pool-spa'] as CategoryId[]) : [])];
}

export function saleTitle(cls: SaleClass, place: string, state: string): string {
  return `${SALE_TITLE_NOUN[cls]} sold in ${place}, ${state}`;
}

/**
 * "Price band: $250k–$500k | Single-family home | 3400 block of N Lakewood Ave". The place part is the block for a residential sale (no
 * house number, no unit) and the street address for a commercial one.
 */
export function saleSummary(cls: SaleClass, band: PriceBand, place?: string | null): string {
  return [`Price band: ${band}`, SALE_CLASS_LABEL[cls], ...(place ? [place] : [])].join(' | ');
}

const titleWord = (w: string) => (/^\d/.test(w) ? w.toLowerCase() : /^[NSEW]$|^(NE|NW|SE|SW)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/**
 * Review P1-2 (owner decision, round 20): a residential sale is stored and shown at BLOCK level only. "3412 N LAKEWOOD AVE UNIT 2" becomes
 * "3400 block of N Lakewood Ave": the house number rounded down to the hundred, the unit dropped (lib/signals/adapters/socrata.ts
 * blockAddress). Null when no block can be read.
 */
export function saleBlock(cleanStreet: string): string | null {
  const b = blockAddress(cleanStreet);
  const m = /^(\d+|0-99) block of (.+)$/.exec(b);
  if (!m) return null;
  return `${m[1]} block of ${m[2].split(' ').map(titleWord).join(' ')}`;
}

const NYC_BOROUGHS: Record<string, { name: string; lat: number; lon: number }> = {
  '1': { name: 'Manhattan', lat: 40.7831, lon: -73.9712 },
  '2': { name: 'Bronx', lat: 40.8448, lon: -73.8648 },
  '3': { name: 'Brooklyn', lat: 40.6782, lon: -73.9442 },
  '4': { name: 'Queens', lat: 40.7282, lon: -73.7949 },
  '5': { name: 'Staten Island', lat: 40.5795, lon: -74.1502 },
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The place printed in the title: an NYC borough by its code, else a city the gazetteer knows in the dataset's state (its own spelling),
 * else the dataset's own place. A raw column value is never printed, so a name typed into a city column can never reach a title.
 */
export function placeOf(ds: Pick<SaleDataset, 'id' | 'city' | 'state' | 'placeField'>, row: Record<string, unknown>): { name: string; anchor?: { lat: number; lon: number } } {
  const raw = ds.placeField ? String(row[ds.placeField] ?? '').trim() : '';
  if (ds.id === 'socrata-nyc-acris-sales') {
    const b = NYC_BOROUGHS[raw];
    return b ? { name: b.name, anchor: { lat: b.lat, lon: b.lon } } : { name: 'New York' };
  }
  if (raw && /^[A-Za-z .'-]{2,40}$/.test(raw)) {
    const c = cityBySlug(`${slugify(raw)}-${ds.state.toLowerCase()}`);
    if (c) return { name: c.name };
  }
  return { name: ds.city };
}

// ---- rows to records ----------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v).trim());
/** Each id part is digits (dashes allowed), with NYC's FT_ / BK_ microfilm prefix allowed (review P3): no word can ride in an id. */
const ID_PART_RE = /^(?:FT_|BK_)?\d[\d-]{0,39}$/;

export interface SaleParseReport {
  items: SignalInput[];
  rows: number;
  /** Rows with the id and a readable date. */
  shapeOk: number;
  /** Rows dropped for no price, a price under MIN_SALE_PRICE, no known class, or no address cleanAddress keeps. */
  dropped: { price: number; class: number; address: number; old: number };
}

/** The record date of a raw date value, the way the platform writes it. */
export function saleRecordDate(ds: SaleDataset, v: unknown): string | null {
  if (ds.platform === 'arcgis') return arcgisDateToIso(v);
  if (ds.platform === 'carto') return toIso(normalizeCartoDate(v), ds.tz);
  return toIso(v, ds.tz);
}

function idOf(ds: SaleDataset, row: Row): string | null {
  const parts = (ds.idFields?.length ? ds.idFields : [ds.idField]).map((f) => str(row[f]));
  if (parts.some((p) => !ID_PART_RE.test(p))) return null;
  return parts.join(':');
}

/** The row's point rounded to 3 decimals (a block), its ZIP centroid, or its borough or county stand-in (approx). */
function positionOf(ds: SaleDataset, row: Row, zip: string | null, anchor?: { lat: number; lon: number }): { lat: number; lon: number; approx: boolean } | null {
  const lat = Number(row[ds.latField ?? '__lat']);
  const lon = Number(row[ds.lonField ?? '__lon']);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  if (row[ds.latField ?? '__lat'] != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
    return { lat: r3(lat), lon: r3(lon), approx: false };
  }
  const centre = anchor ?? ds.countyAnchor;
  if (zip) {
    const z = lookupZip(zip);
    if (z && z.state === ds.state && (!centre || haversineMi(centre.lat, centre.lon, z.lat, z.lon) <= 60)) return { lat: z.lat, lon: z.lon, approx: true };
  }
  return anchor ? { ...anchor, approx: true } : null;
}

/**
 * Rows (main columns, plus the join's when there is one) to sale records. Pure: no I/O. Rows older than the window are dropped.
 *
 * One deed, one record (review P2-1, P2-6): rows that share an external id (a Cook County deed over several PINs, an NYC deed over several
 * lots, a repeated Philadelphia document) make ONE record, built from the first row (in the given order) whose class is residential, else
 * from the first row. A residential record keeps the block only, in its summary, and NO contact (review P1-2); a commercial record keeps
 * the street address cleanAddress allows, in its summary and as a private site contact.
 */
export function parseSaleRows(rows: readonly unknown[], ds: SaleDataset, now: Date = new Date()): SaleParseReport {
  const report: SaleParseReport = { items: [], rows: rows.length, shapeOk: 0, dropped: { price: 0, class: 0, address: 0, old: 0 } };
  const oldest = now.getTime() - (ds.lookbackDays + 1) * 86_400_000;
  const latest = now.getTime() + 86_400_000;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const row = r as Row;
    const externalId = idOf(ds, row);
    if (!externalId || !saleRecordDate(ds, row[ds.dateField])) continue;
    report.shapeOk++;
    const g = groups.get(externalId);
    if (g) g.push(row);
    else groups.set(externalId, [row]);
  }
  const classOfRow = (row: Row): SaleClass | null => {
    const cls = ds.classOf(str(row[ds.classField]));
    // Miami-Dade flags condo units apart from the land-use code.
    return cls === 'residential_single' && /^(y|yes|t|true|1)$/i.test(str(row.CONDO_FLAG)) ? 'condo' : cls;
  };
  for (const [externalId, group] of groups) {
    const row = group.find((x) => { const c = classOfRow(x); return c !== null && RESIDENTIAL_CLASSES.has(c); }) ?? group[0];
    const occurredAt = saleRecordDate(ds, row[ds.dateField])!;
    const t = Date.parse(occurredAt);
    if (t < oldest || t > latest) {
      report.dropped.old++;
      continue;
    }
    const price = parsePrice(row[ds.priceField]);
    if (price === null || price < MIN_SALE_PRICE) {
      report.dropped.price++;
      continue;
    }
    const cls = classOfRow(row);
    if (!cls) {
      report.dropped.class++;
      continue;
    }
    const residential = RESIDENTIAL_CLASSES.has(cls);
    const street = cleanAddress(ds.addressFields.map((f) => str(row[f])).filter(Boolean).join(' '));
    // A unit is kept for a commercial property only; a home's unit is never read into anything stored.
    const unit = !residential && ds.unitField ? str(row[ds.unitField]) : '';
    const shownPlace = !street ? null : residential ? saleBlock(street) : unit && /^[A-Za-z0-9-]{1,6}$/.test(unit) ? cleanAddress(`${street} UNIT ${unit}`) ?? street : street;
    if (!shownPlace) {
      report.dropped.address++;
      continue;
    }
    const zipRaw = ds.zipField ? str(row[ds.zipField]).slice(0, 5) : '';
    const zip = /^\d{5}$/.test(zipRaw) ? zipRaw : null;
    const place = placeOf(ds, row);
    const pos = positionOf(ds, row, zip, place.anchor);
    const band = priceBand(price);
    report.items.push({
      source: ds.id,
      externalId,
      kind: 'civic',
      title: saleTitle(cls, place.name, ds.state),
      summary: saleSummary(cls, band, shownPlace),
      url: ds.sourceUrl,
      lat: pos?.lat ?? null,
      lon: pos?.lon ?? null,
      city: place.name,
      state: ds.state,
      zip,
      categories: saleTradesFor(ds, cls),
      severity: 1,
      occurredAt,
      data: { subtype: 'sale', recordKind: 'property-sale', saleClass: cls, priceBand: band, ...(pos?.approx ? { approxLocation: true } : {}) },
      ...(residential ? {} : { contacts: [{ role: 'site' as const, name: '', address: shownPlace, city: place.name, state: ds.state, zip }] }),
    });
  }
  return report;
}

/** Why no row parsed (missing id or date column, unreadable date), or null. Column names only. */
export function saleSchemaProblem(rows: readonly unknown[], ds: SaleDataset): string | null {
  return schemaProblem(rows, { idFields: ds.idFields?.length ? ds.idFields : [ds.idField], dateField: ds.dateField, readsAsDate: (v) => saleRecordDate(ds, v) !== null });
}

// ---- requests -----------------------------------------------------------------------------------------------------------------------

function windowStart(ds: SaleDataset, now: Date): Date {
  return new Date(now.getTime() - ds.lookbackDays * 86_400_000);
}

/** Socrata: the main query (explicit $select, date window, newest first, page). */
export function buildSocrataSaleQuery(ds: SaleDataset, now: Date, page = 0, limit = SALE_PAGE): URLSearchParams {
  const p = new URLSearchParams();
  p.set('$select', safe(ds.columns).join(','));
  p.set('$where', socrataWhere(ds, now));
  p.set('$order', [`${ds.dateField} DESC`, ds.idField, ...(ds.orderTiebreak ?? [])].map(assertSafeColumn).join(', '));
  p.set('$limit', String(limit));
  if (page > 0) p.set('$offset', String(page * limit));
  return p;
}

export function socrataWhere(ds: SaleDataset, now: Date): string {
  const clauses = [`${assertSafeColumn(ds.dateField)} > '${toFloatingLocal(windowStart(ds, now), ds.tz)}'`];
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  return clauses.join(' AND ');
}

/** Socrata: the newest row's date only (to tell a quiet window from a stale feed). */
export function buildSocrataNewestQuery(ds: SaleDataset): URLSearchParams {
  const p = new URLSearchParams();
  p.set('$select', assertSafeColumn(ds.dateField));
  p.set('$where', `${ds.dateField} IS NOT NULL`);
  p.set('$order', `${ds.dateField} DESC`);
  p.set('$limit', '1');
  return p;
}

const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Socrata: the join request for a batch of keys (explicit $select; keys are checked, never quoted from free text). */
export function buildSocrataJoinQuery(ds: SaleDataset, keys: readonly string[]): URLSearchParams | null {
  const j = ds.join;
  if (!j) return null;
  const ok = keys.filter((k) => KEY_RE.test(k));
  if (!ok.length) return null;
  const p = new URLSearchParams();
  p.set('$select', safe(j.columns).join(','));
  p.set('$where', `${assertSafeColumn(j.keyField)} in (${ok.map((k) => `'${k}'`).join(',')})`);
  if (j.orderField) p.set('$order', `${assertSafeColumn(j.orderField)} DESC`);
  else if (j.sortFields?.length) p.set('$order', [j.keyField, ...j.sortFields].map(assertSafeColumn).join(', '));
  p.set('$limit', String(Math.min(5000, ok.length * (j.orderField ? 5 : 20))));
  return p;
}

function dateLiteral(dateType: 'date' | 'dateOnly', d: Date): string {
  return dateType === 'dateOnly' ? `date '${toTimestampLiteral(d).slice(0, 10)}'` : `timestamp '${toTimestampLiteral(d)}'`;
}

/** ArcGIS: the where clause of the window (the layer's own date type). */
export function arcgisSaleWhere(ds: SaleDataset, now: Date, dateType: 'date' | 'dateOnly' = 'date'): string {
  const clauses = [`${assertSafeColumn(ds.dateField)} >= ${dateLiteral(dateType, windowStart(ds, now))}`];
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  return clauses.join(' AND ');
}

/** ArcGIS: the main query. outFields is the config's columns that the layer has (never '*'). */
export function buildArcgisSaleQuery(ds: SaleDataset, now: Date, present: ReadonlySet<string> | null, dateType: 'date' | 'dateOnly' = 'date', limit = SALE_PAGE * SALE_MAX_PAGES): URLSearchParams {
  const p = new URLSearchParams();
  p.set('where', arcgisSaleWhere(ds, now, dateType));
  p.set('outFields', safe(ds.columns.filter((c) => !present || present.has(c))).join(','));
  p.set('orderByFields', `${ds.dateField} DESC`);
  p.set('resultRecordCount', String(limit));
  p.set('returnGeometry', 'true');
  p.set('outSR', '4326');
  p.set('f', 'json');
  return p;
}

/** ArcGIS: the newest row's date only. */
export function buildArcgisNewestQuery(ds: SaleDataset): URLSearchParams {
  const p = new URLSearchParams();
  p.set('where', `${assertSafeColumn(ds.dateField)} IS NOT NULL`);
  p.set('outFields', ds.dateField);
  p.set('orderByFields', `${ds.dateField} DESC`);
  p.set('resultRecordCount', '1');
  p.set('returnGeometry', 'false');
  p.set('f', 'json');
  return p;
}

/** Carto: the WHERE of the window. */
export function cartoSaleWhere(ds: SaleDataset, now: Date): string {
  const date = ds.cartoDateExpr ?? ds.dateField;
  const price = ds.cartoPriceExpr ?? ds.priceField;
  const clauses = [`${assertSafeColumn(date)} IS NOT NULL`, `${date} > '${windowStart(ds, now).toISOString()}'`, `${assertSafeColumn(price)} >= ${MIN_SALE_PRICE}`];
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  return clauses.join(' AND ');
}

/** Carto: the SQL. Explicit SELECT list (never *), window, newest first, LIMIT. */
export function buildCartoSaleSql(ds: SaleDataset, now: Date, limit = SALE_PAGE * SALE_MAX_PAGES): string {
  const sel = Object.entries(ds.cartoSelect ?? {}).map(([as, expr]) => {
    assertSafeColumn(as);
    for (const tok of expr.match(/[a-z]\.[a-z_]+/gi) ?? []) assertSafeColumn(tok);
    return `${expr} AS ${as}`;
  });
  return `SELECT ${sel.join(', ')} FROM ${ds.cartoFrom} WHERE ${cartoSaleWhere(ds, now)} ORDER BY ${ds.cartoDateExpr ?? ds.dateField} DESC LIMIT ${limit}`;
}

export function buildCartoNewestSql(ds: SaleDataset): string {
  const date = ds.cartoDateExpr ?? ds.dateField;
  return `SELECT ${assertSafeColumn(date)} AS ${ds.dateField} FROM ${ds.cartoFrom} WHERE ${date} IS NOT NULL ORDER BY ${date} DESC LIMIT 1`;
}

export const cartoUrl = (sql: string) => `${PHL_CARTO}?q=${encodeURIComponent(sql)}&format=json`;
export const socrataUrl = (domain: string, datasetId: string, q: URLSearchParams) => `https://${domain}/resource/${datasetId}.json?${q.toString()}`;

/** Every request URL a run of this source can send (main, newest, join, field list), for the privacy tests. */
export function saleRequestUrls(ds: SaleDataset, now: Date, sampleKeys: readonly string[] = ['1', '2']): string[] {
  if (ds.platform === 'socrata') {
    const out = [0, 1].map((pg) => socrataUrl(ds.domain!, ds.datasetId!, buildSocrataSaleQuery(ds, now, pg)));
    out.push(socrataUrl(ds.domain!, ds.datasetId!, buildSocrataNewestQuery(ds)));
    const jq = buildSocrataJoinQuery(ds, sampleKeys);
    if (jq) out.push(socrataUrl(ds.domain!, ds.join!.datasetId, jq));
    return out;
  }
  if (ds.platform === 'arcgis') {
    return [`${ds.layerUrl}?f=json`, `${ds.layerUrl}/query?${buildArcgisSaleQuery(ds, now, null).toString()}`, `${ds.layerUrl}/query?${buildArcgisNewestQuery(ds).toString()}`];
  }
  return [cartoUrl(buildCartoSaleSql(ds, now)), cartoUrl(buildCartoNewestSql(ds))];
}

// ---- fetching ------------------------------------------------------------------------------------------------------------------------

export interface SaleFetch {
  /** Rows with the main columns and, for a joined source, the join's columns merged in. Never a column the config does not name. */
  rows: Row[];
  /** The log lines (error lines read by run.ts; a probation note for the row cap). */
  logs: string[];
  httpStatus: number | null;
  /** Column names the source reported (Socrata metadata is not read here; ArcGIS field list; Carto `fields`). */
  columns: string[] | null;
  capped: boolean;
}

interface FetchOpts {
  limit?: number;
  pages?: number;
  budgetMs?: number;
}

type Got = { ok: true; status: number; body: unknown } | { ok: false; status: number | null; problem: string };

async function getJson(doFetch: typeof fetch, url: string, timeoutMs: number): Promise<Got> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
    // Socrata app token, as the main Socrata adapter sends it (review P3: unthrottled join batches).
    const token = process.env.SOCRATA_APP_TOKEN;
    if (token && url.includes('/resource/')) headers['X-App-Token'] = token;
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(Math.max(500, timeoutMs)) });
    // Review P3: a portal's error text is never logged or stored (it could echo a value); the HTTP status says enough.
    if (!res.ok) return { ok: false, status: res.status, problem: `HTTP ${res.status}` };
    const read = await readJsonBody(res);
    if (!read.ok) return { ok: false, status: res.status, problem: read.problem };
    return { ok: true, status: res.status, body: read.body };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return { ok: false, status: null, problem: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'request failed' };
  }
}

/** Stable order of join rows: numeric where both values read as numbers, else as text. */
function compareBy(a: Row, b: Row, fields: readonly string[]): number {
  for (const f of fields) {
    const x = str(a[f]);
    const y = str(b[f]);
    const nx = Number(x);
    const ny = Number(y);
    const c = x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c;
  }
  return 0;
}

/** Keeps only the named columns of a row (a portal that ignores $select or outFields still hands nothing else on). */
function pick(row: unknown, cols: readonly string[]): Row | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const out: Row = {};
  for (const c of cols) if (c in (row as Row)) out[c] = (row as Row)[c];
  return out;
}

function failLine(ds: SaleDataset, g: Extract<Got, { ok: false }>, what = ''): string {
  const where = what ? ` ${what}` : '';
  if (g.problem === 'response was not JSON' || g.problem === 'empty response body') return `error: ${ds.id}:${where} ${g.problem}${g.status ? ` (HTTP ${g.status})` : ''}`;
  if (g.status === 400) return `error: schema mismatch: the portal refused the column list (${ds.id}${where}: ${g.problem})`;
  return `error: ${ds.id}:${where} ${g.problem}`;
}

async function staleLine(ds: SaleDataset, doFetch: typeof fetch, timeoutMs: number): Promise<string> {
  let newest: string | null = null;
  if (ds.platform === 'socrata') {
    const g = await getJson(doFetch, socrataUrl(ds.domain!, ds.datasetId!, buildSocrataNewestQuery(ds)), timeoutMs);
    if (g.ok && Array.isArray(g.body) && g.body[0]) newest = saleRecordDate(ds, (g.body[0] as Row)[ds.dateField]);
  } else if (ds.platform === 'arcgis') {
    const g = await getJson(doFetch, `${ds.layerUrl}/query?${buildArcgisNewestQuery(ds).toString()}`, timeoutMs);
    const f = g.ok ? (g.body as { features?: { attributes?: Row }[] } | null)?.features : null;
    if (Array.isArray(f) && f[0]?.attributes) newest = saleRecordDate(ds, f[0].attributes[ds.dateField]);
  } else {
    const g = await getJson(doFetch, cartoUrl(buildCartoNewestSql(ds)), timeoutMs);
    const rows = g.ok ? (g.body as { rows?: Row[] } | null)?.rows : null;
    if (Array.isArray(rows) && rows[0]) newest = saleRecordDate(ds, rows[0][ds.dateField]);
  }
  return `error: ${ds.id}: no rows in the last ${ds.lookbackDays} days: ${newest ? `newest is ${newest.slice(0, 10)}` : 'the newest date could not be read'}`;
}

async function fetchSocrata(ds: SaleDataset, doFetch: typeof fetch, now: Date, o: Required<FetchOpts>, deadline: number, out: SaleFetch): Promise<void> {
  const left = () => deadline - Date.now();
  const main: Row[] = [];
  for (let page = 0; page < o.pages; page++) {
    if (page > 0 && left() < PAGE2_MIN_LEFT_MS) break;
    const g = await getJson(doFetch, socrataUrl(ds.domain!, ds.datasetId!, buildSocrataSaleQuery(ds, now, page, o.limit)), Math.min(UNVERIFIED_REQUEST_TIMEOUT_MS, left()));
    if (!g.ok) {
      out.httpStatus = g.status;
      out.logs.push(failLine(ds, g));
      if (page === 0) return;
      break;
    }
    out.httpStatus = g.status;
    if (!Array.isArray(g.body)) {
      out.logs.push(`error: ${ds.id} returned a non-array response, shape may have changed`);
      if (page === 0) return;
      break;
    }
    for (const r of g.body) {
      const p = pick(r, ds.columns);
      if (p) main.push(p);
    }
    if (g.body.length < o.limit) break;
    if (page === o.pages - 1 || left() < PAGE2_MIN_LEFT_MS) out.capped = true;
  }
  if (!ds.join || !main.length) {
    out.rows = main;
    return;
  }
  const j = ds.join;
  const keys = [...new Set(main.map((r) => str(r[j.mainKeyField])).filter((k) => KEY_RE.test(k)))];
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += JOIN_BATCH) batches.push(keys.slice(i, i + JOIN_BATCH));
  const answers = await Promise.all(
    batches.map((b) => {
      const q = buildSocrataJoinQuery(ds, b);
      return q ? getJson(doFetch, socrataUrl(ds.domain!, j.datasetId, q), Math.min(UNVERIFIED_REQUEST_TIMEOUT_MS, left())) : Promise.resolve<Got>({ ok: true, status: 200, body: [] });
    }),
  );
  // With orderField (Cook County, newest tax year first) one row per key is kept; without it (NYC: one deed, several lots) every row is
  // kept, sorted by sortFields, and the parser keeps one record per deed (first residential lot, else the first lot).
  const byKey = new Map<string, Row[]>();
  for (const g of answers) {
    if (!g.ok) {
      out.logs.push(failLine(ds, g, `join ${j.datasetId}:`));
      return;
    }
    if (!Array.isArray(g.body)) {
      out.logs.push(`error: ${ds.id}: join ${j.datasetId} returned a non-array response, shape may have changed`);
      return;
    }
    for (const r of g.body) {
      const p = pick(r, j.columns);
      const k = p ? str(p[j.keyField]) : '';
      if (!p || !k) continue;
      const list = byKey.get(k);
      if (!list) byKey.set(k, [p]);
      else if (!j.orderField) list.push(p);
    }
  }
  if (!keys.some((k) => byKey.has(k))) {
    out.logs.push(`error: schema mismatch: join ${j.datasetId} matched none of ${keys.length} keys on ${j.keyField} (${ds.id})`);
    return;
  }
  if (j.sortFields?.length) for (const list of byKey.values()) list.sort((a, b) => compareBy(a, b, j.sortFields!));
  out.rows = main.flatMap((r) => (byKey.get(str(r[j.mainKeyField])) ?? [{}]).map((jr) => ({ ...jr, ...r })));
}

/** ArcGIS: the layer's field list, then the query. Returns the names present (null when the list could not be read). */
async function fetchArcgis(ds: SaleDataset, doFetch: typeof fetch, now: Date, o: Required<FetchOpts>, deadline: number, out: SaleFetch): Promise<void> {
  const left = () => deadline - Date.now();
  const meta = await getJson(doFetch, `${ds.layerUrl}?f=json`, Math.min(UNVERIFIED_REQUEST_TIMEOUT_MS, left()));
  const list = meta.ok ? (meta.body as { fields?: { name?: unknown; type?: unknown }[] } | null)?.fields : null;
  if (!meta.ok || !Array.isArray(list) || !list.length) {
    out.httpStatus = meta.status;
    out.logs.push(meta.ok ? `error: ${ds.id}: could not read the layer's field list; no query sent` : failLine(ds, meta, "field list:"));
    return;
  }
  const types = new Map(list.map((f) => [String(f?.name ?? ''), typeof f?.type === 'string' ? f.type : '']));
  out.columns = [...types.keys()].filter(Boolean).sort();
  const required = [...(ds.idFields?.length ? ds.idFields : [ds.idField]), ds.dateField, ds.priceField, ds.classField, ds.addressFields[0]];
  const missing = [...new Set(required)].filter((c) => !types.has(c));
  if (missing.length) {
    out.logs.push(`error: schema mismatch: expected ${missing.join(', ')} (${ds.id}: no query sent)`);
    return;
  }
  const t = types.get(ds.dateField) ?? '';
  if (t && t !== 'esriFieldTypeDate' && t !== 'esriFieldTypeDateOnly') {
    out.logs.push(`error: schema mismatch: ${ds.dateField} is ${t.replace('esriFieldType', '').toLowerCase()}, not a date field (${ds.id})`);
    return;
  }
  const present = new Set(types.keys());
  const limit = o.limit * o.pages;
  const g = await getJson(doFetch, `${ds.layerUrl}/query?${buildArcgisSaleQuery(ds, now, present, t === 'esriFieldTypeDateOnly' ? 'dateOnly' : 'date', limit).toString()}`, Math.min(UNVERIFIED_REQUEST_TIMEOUT_MS, left()));
  if (!g.ok) {
    out.httpStatus = g.status;
    out.logs.push(failLine(ds, g));
    return;
  }
  out.httpStatus = g.status;
  const b = g.body as { features?: unknown; error?: { code?: unknown; message?: unknown }; exceededTransferLimit?: unknown } | null;
  if (!b || b.error || !Array.isArray(b.features)) {
    out.logs.push(b?.error ? `error: ${ds.id}: ArcGIS ${String(b.error.code ?? '')} ${String(b.error.message ?? '').slice(0, 80)}`.trim() : `error: ${ds.id} returned no features array, shape may have changed`);
    return;
  }
  for (const f of b.features as { attributes?: unknown; geometry?: { x?: unknown; y?: unknown } }[]) {
    const p = pick(f?.attributes, ds.columns);
    if (!p) continue;
    if (f.geometry && typeof f.geometry.x === 'number' && typeof f.geometry.y === 'number') {
      p.__lon = f.geometry.x;
      p.__lat = f.geometry.y;
    }
    out.rows.push(p);
  }
  if ((b.features as unknown[]).length >= limit || b.exceededTransferLimit === true) out.capped = true;
}

async function fetchCarto(ds: SaleDataset, doFetch: typeof fetch, now: Date, o: Required<FetchOpts>, deadline: number, out: SaleFetch): Promise<void> {
  const limit = o.limit * o.pages;
  const g = await getJson(doFetch, cartoUrl(buildCartoSaleSql(ds, now, limit)), Math.min(UNVERIFIED_REQUEST_TIMEOUT_MS, deadline - Date.now()));
  if (!g.ok) {
    out.httpStatus = g.status;
    out.logs.push(failLine(ds, g));
    return;
  }
  out.httpStatus = g.status;
  const b = g.body as { rows?: unknown; fields?: Record<string, unknown> } | null;
  if (!b || !Array.isArray(b.rows)) {
    out.logs.push(`error: ${ds.id} returned no rows array, shape may have changed`);
    return;
  }
  if (b.fields && typeof b.fields === 'object') out.columns = Object.keys(b.fields).sort();
  for (const r of b.rows) {
    const p = pick(r, ds.columns);
    if (p) out.rows.push(p);
  }
  if (b.rows.length >= limit) out.capped = true;
}

/**
 * One run's rows of a sale source, never throwing. Stops itself inside the time budget. When the window holds no row, one more tiny request
 * reads the newest date so a stale feed says "no rows in the last N days: newest is ..." (an error), not "quiet".
 */
export async function fetchSaleRows(ds: SaleDataset, doFetch: typeof fetch, now: Date, opts: FetchOpts = {}): Promise<SaleFetch> {
  const o: Required<FetchOpts> = { limit: opts.limit ?? SALE_PAGE, pages: opts.pages ?? SALE_MAX_PAGES, budgetMs: opts.budgetMs ?? SALE_BUDGET_MS };
  const deadline = Date.now() + o.budgetMs;
  const out: SaleFetch = { rows: [], logs: [], httpStatus: null, columns: null, capped: false };
  try {
    if (ds.platform === 'socrata') await fetchSocrata(ds, doFetch, now, o, deadline, out);
    else if (ds.platform === 'arcgis') await fetchArcgis(ds, doFetch, now, o, deadline, out);
    else await fetchCarto(ds, doFetch, now, o, deadline, out);
    const failed = out.logs.some((l) => l.startsWith('error'));
    if (!failed && out.rows.length === 0 && deadline - Date.now() > 1000) out.logs.push(await staleLine(ds, doFetch, Math.min(UNVERIFIED_REQUEST_TIMEOUT_MS, deadline - Date.now())));
    if (!failed && out.capped) out.logs.push(`${PROBATION_NOTE_PREFIX} row cap reached: ${out.rows.length} rows read (limit ${o.limit * o.pages}); older rows in the window were not read`);
  } catch (e) {
    out.logs.push(`error: ${ds.id}: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
  }
  return out;
}

export function buildSaleAdapter(ds: SaleDataset): Adapter {
  return {
    id: ds.id,
    label: `${ds.city} open data: property sales`,
    kind: 'civic',
    cadenceMinutes: ds.cadenceMinutes,
    ...(ds.probation ? { probation: true } : {}),
    sourceUrl: ds.sourceUrl,
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      const now = ctx.now ?? new Date();
      const got = await fetchSaleRows(ds, ctx.fetch, now);
      for (const l of got.logs) ctx.log(l);
      if (got.logs.some((l) => l.startsWith('error'))) return [];
      const report = parseSaleRows(got.rows, ds, now);
      if (report.rows > 0 && report.items.length === 0) {
        const problem = report.shapeOk === 0 ? saleSchemaProblem(got.rows, ds) : null;
        if (problem) ctx.log(schemaMismatchLog(ds.id, problem, got.rows));
        else if (report.shapeOk === 0) ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
        else {
          const d = report.dropped;
          // Every row kept its shape but none passed (price, class or address): said plainly, not an error (a code table may need a value).
          ctx.log(`${ds.id}: ${report.rows} rows, 0 kept (price ${d.price}, class ${d.class}, address ${d.address}, old ${d.old})`);
        }
      }
      return report.items;
    },
  };
}

export const adapters: Adapter[] = SALES_DATASETS.map(buildSaleAdapter);

/** Expose the request columns for tests and the probe. */
export { saleRequestColumns };
