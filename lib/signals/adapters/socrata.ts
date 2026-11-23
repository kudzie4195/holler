import { classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput, StageQueryOutcome } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { contactSpecFields, extractContacts, extractJobValue, extractLicenseRefs } from '@/lib/contacts/extract';
import { STREET_SUFFIX_WORDS, foldName } from '@/lib/contacts/org';
import { moneyFields, publicSummary, scrubText, summaryPart, civicLabel, cutAfterStreetSuffix, looksLikeProse, categoryValueHasName, stripActor } from './permit-privacy';
import { classifyPermit, isStructuredField, permitTitleFor } from '@/lib/signals/mapping/permit';
import { CAT_V } from '@/lib/signals/mapping/version';
import { isTriggerStage, permitStageOf, STAGE_STATUS_FRAGMENTS } from '@/lib/signals/stage';
import { haversineMi, lookupZip } from '@/lib/geo';
import { readJsonBody, schemaMismatchLog, schemaProblem, UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { cleanAddress } from '@/lib/contacts/sanitize';
import { nycBlockAddress, nycBuildingAddress, nameBeforeStreet } from './nyc-address';
import { createHash, randomUUID } from 'node:crypto';
import { buildingRefOf, isWholeBuildingHeat } from '@/lib/signals/building-ref';
import { nycWholeBuildingContact, site311Contact } from '@/lib/signals/site-311';
import { idKeySecret } from '@/lib/signals/id-key';
import { OCCUPANCY_TRADES, businessSummary, hashedId, occupancyAddress, occupancyClassOf, occupancyTitle, occupancyTypeText, premisesAddressOf } from './next-rules';
import {
  CIVIC_TYPE_KEYWORDS,
  NAICS_SECTORS,
  RULES_BY_SUBTYPE,
  SOCRATA_DATASETS,
  datasetPageUrl,
  lookbackDays,
  type InspectionSummaryField,
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
  if (ds.zipCentroid && ds.zipField) {
    // Round 19 coverage (Dallas): no coordinates in the feed, so the ZIP centroid, only when the ZIP is in the dataset's own state AND
    // within maxMi of the dataset's city (review P3-H: an El Paso ZIP on a Dallas row is not placed in El Paso).
    const z = lookupZip(s(row, ds.zipField));
    const near = ds.zipCentroid.near;
    if (z && z.state === ds.state && haversineMi(near.lat, near.lon, z.lat, z.lon) <= ds.zipCentroid.maxMi) {
      const p = validLatLon(z.lat, z.lon);
      if (p) return { ...p, approx: true };
    }
  }
  if (ds.fallbackCenter) return { ...ds.fallbackCenter, approx: true };
  return null;
}

/**
 * "11/16/26" or "11/16/2026" (month/day/year, a local calendar day) as a floating timestamp "2026-11-16T00:00:00", else null. A two-digit
 * year is 20xx (the feeds read here start long after 2000). An impossible day ("02/30/26") is null.
 */
export function mdyToFloating(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00`;
}

/** "2026-11-16" or "2026-11-16T00:00:00.000" (optionally with a zone) naming a real calendar day; anything else false. */
function strictIsoDay(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * The record's own date as an ISO instant. dateFormat 'mdy' (Dallas) is STRICT (review P3-G): the MM/DD/YY(YY) form, or a strict
 * yyyy-mm-dd prefix naming a real day; anything else (an impossible "02/30/26", free text) is null, never a lenient guess. Other datasets:
 * the usual SODA timestamp (toIso).
 */
export function recordDateIso(v: unknown, ds: Pick<SocrataDataset, 'tz' | 'dateFormat'>): string | null {
  if (ds.dateFormat === 'mdy') {
    const f = mdyToFloating(v);
    if (f) return toIso(f, ds.tz);
    return strictIsoDay(v) ? toIso(v.trim().length === 10 ? `${v.trim()}T00:00:00` : v.trim(), ds.tz) : null;
  }
  return toIso(v, ds.tz);
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

export function categorize(ds: Pick<SocrataDataset, 'subtype'> & { extraRules?: SocrataDataset['extraRules'] }, text: string): { categories: CategoryId[]; severity: Severity } {
  // Permits: one classification for trades and title (lib/signals/mapping/permit.ts). Plain text is read as description values.
  if (ds.subtype === 'permit') return { categories: classifyPermit({ structured: [], free: text.split(' | ') }).categories, severity: 1 };
  const set = new Set<CategoryId>();
  let severity: Severity = ds.subtype === 'inspection' ? 2 : 1;
  // Round 20 (NEXT): a dataset's own extra rules run after the subtype's (a liquor licence layer that is all restaurants; NYC HPD order wording).
  for (const rule of [...RULES_BY_SUBTYPE[ds.subtype], ...(ds.extraRules ?? [])]) {
    if (rule.re.test(text) && !rule.unless?.test(text)) {
      rule.add.forEach((c) => set.add(c));
      if (rule.severity && rule.severity > severity) severity = rule.severity;
    }
  }
  // A new roofing business is a competitor, not a roofing lead: business and event rules decide alone. Code violations decide alone too
  // (round 15 quality gate: "REPAIR GUTTER & DOWNSPOUT" was tagged roofing by the keyword list; VIOLATION_RULES already routes gutters).
  if (ds.subtype !== 'business' && ds.subtype !== 'event-permit' && ds.subtype !== 'violation') classifyText(text).forEach((c) => set.add(c));
  return { categories: [...set], severity };
}

/**
 * Permit classification from a row's own columns: the dataset's type, class, category and use columns are structured values, the rest
 * of its text and title columns are descriptions (read, never printed). Returns the trades and the fixed title label together.
 */
export function classifyPermitRow(
  ds: { city: string; textFields: string[]; titleFields: string[]; mixedTextFields?: string[] },
  get: (field: string) => string,
): { categories: CategoryId[]; label: string | null } {
  const fields = [...new Set([...ds.textFields, ...ds.titleFields])];
  const mixedSet = new Set(ds.mixedTextFields ?? []);
  const structured = fields.filter(isStructuredField).map(get).filter(Boolean);
  const free = fields.filter((f) => !isStructuredField(f) && !mixedSet.has(f)).map(get).filter(Boolean);
  // Columns that mix a street address, a description and a name: only unambiguous work phrases count (lib/signals/mapping/permit.ts).
  const mixed = fields.filter((f) => mixedSet.has(f)).map(get).filter(Boolean);
  const c = classifyPermit({ structured, free, mixed }, ds.city);
  return { categories: c.categories, label: c.label };
}

/**
 * Business rows are rounded to 2 decimals (about 1 km): enough for a 5 mile alert radius and the nearest-city lookup, too coarse to
 * point at a home. Code-violation rows, EVERY inspection row and EVERY 311 row (final review P2-1: a heat complaint is about a home)
 * are rounded to 3 decimals (about 100 m, a block): holler_signals is public, and such a record is often a private home (a home
 * daycare, an apartment building). Everything else keeps its exact point. A NYC heat row keeps its building as a keyed hash
 * (building-ref.ts), never as a point.
 */
export function privatePosition<T extends { lat: number; lon: number }>(pos: T | null, subtype: string): T | null {
  if (!pos) return pos;
  const f = subtype === 'business' ? 100 : subtype === 'violation' || subtype === 'inspection' || subtype === '311' ? 1000 : 0;
  if (!f) return pos;
  return { ...pos, lat: Math.round(pos.lat * f) / f, lon: Math.round(pos.lon * f) / f };
}

/**
 * Street address at block level only: "2318 W 47TH ST" becomes "2300 block of W 47TH ST" (house number rounded down to the hundred,
 * "0-99 block of" below 100). Apartment, unit and suite suffixes ("APT 4", "APT4", "#5B", "UNIT 5", "STE 100") are dropped, and so is a
 * fractional house number ("1915 1/4"). The whole address is DROPPED (returns '') when it
 *  - names a lot, trailer or space number, written with or without a space ("12 MAIN ST LOT 34", "LOT34", "SP34", "TRLR24", "SPACE A-12",
 *    "TRAILER #24", "SPC 7": one mobile-home pad, still identifying at block level), or
 *  - joins a second address with "&" or "and" ("123 MAIN ST & 45 ELM ST": a second exact address would survive the cut), or
 *  - does not start with a house number followed by a street (an intersection, a parcel id, free text).
 */
export function blockAddress(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (/&|\band\b/i.test(t)) return '';
  if (/\b(?:lot|trlr|trailer|trl|tr|space|spc|sp)(?=[\s#.\-]*[A-Za-z]?-?\d)/i.test(t)) return '';
  const m = t.match(/^(\d{1,6})(?:\s*-\s*\d{1,6})?[A-Za-z]?(?:\s+\d\/\d)?\s+(.+)$/);
  if (!m) return '';
  const street = m[2]
    .replace(/\s*(#|\b(?:apt|apartment|unit|ste|suite|fl|floor|rm|room|bldg)\b|\b(?:apt|unit|ste|rm)(?=\d)).*$/i, '')
    .replace(/[,;|].*$/, '')
    .trim();
  if (!street || /^\d+$/.test(street) || /\d{3,}/.test(street.replace(/\b\d+(?:ST|ND|RD|TH)\b/gi, ''))) return '';
  const hundred = Math.floor(Number(m[1]) / 100) * 100;
  return hundred === 0 ? `0-99 block of ${street}` : `${hundred} block of ${street}`;
}

/**
 * Review P3-7: the shared site-address rule (lib/contacts cleanAddress), and nothing at all when a person-like name sits in front of the
 * street ("8701 ZELDA GEORGIA AVE": a name typed into the house-number column must not become "8700 block of ZELDA GEORGIA AVE").
 */
export function strictSiteAddress(raw: string): string {
  const kept = cleanAddress(raw);
  if (!kept) return '';
  return nameBeforeStreet(kept) ? '' : kept;
}

/** A per-process salt: a visit key is never stored, and even a copy of one cannot be matched to an address without it. */
const VISIT_SALT = randomUUID();

/**
 * Review P3-11: the visit of a New York violation row is its BUILDING on that day (house number and street), not the 100 m point, so two
 * buildings inspected the same day on one block stay two cards. The key is a salted hash, held in memory for the scan only (store.ts toRow
 * and samples.ts sanitizeSample never write it). A row with no readable building address keeps the point rule (no key here).
 */
export function visitKeyFor(source: string, rawAddress: string, occurredAt: string): { visitKey?: string } {
  const building = nycBuildingAddress(rawAddress);
  const day = occurredAt.slice(0, 10);
  if (!building || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return {};
  return { visitKey: `${source}|bldg:${createHash('sha256').update(`${VISIT_SALT}|${building}`).digest('hex').slice(0, 24)}|${day}` };
}

/** Violation rows store a block-level address; every other subtype keeps what the config asks for. */
export function publicAddress(subtype: string, raw: string): string {
  // Anything after the street suffix of a permit or violation address (" - SMITH RESIDENCE", a name typed into the street column) is
  // cut (review r1 P2). Event locations ("5 AVENUE between 9 STREET and 10 STREET") are not street addresses and are left as given.
  if (subtype === 'violation') return cutAfterStreetSuffix(blockAddress(raw));
  return subtype === 'permit' ? cutAfterStreetSuffix(raw) : raw;
}

/**
 * Values of a 311 or violation row that may be printed in its title or summary: never a column listed in the dataset's freeTextFields,
 * never a value that reads like prose (permit-privacy.ts looksLikeProse), and never a value with what looks like a person's name
 * (categoryValueHasName; also applied to permit rows). Other subtypes: every value except freeTextFields.
 */
export function printableValues(
  ds: { subtype: string; freeTextFields?: string[] },
  fields: string[],
  get: (field: string) => string,
): { values: string[]; withheld: boolean } {
  const free = new Set(ds.freeTextFields ?? []);
  const civic = ds.subtype === '311' || ds.subtype === 'violation';
  // Category and type values of 311, violation and permit rows are printed only when no token looks like a person's name
  // (categoryValueHasName, commander decision 7: "Roof leak - John Doe" never reaches a title or summary).
  const nameChecked = civic || ds.subtype === 'permit';
  let withheld = false;
  const values: string[] = [];
  for (const f of fields) {
    // Review P3-7: who acted on a 311 or violation row is never printed ("Initial by OFFICER KRUPKE" prints "Initial").
    const v = civic ? stripActor(get(f)) : get(f);
    if (!v) continue;
    if (free.has(f) || (civic && looksLikeProse(v)) || (nameChecked && categoryValueHasName(v))) {
      withheld = true;
      continue;
    }
    values.push(v);
  }
  return { values, withheld };
}

// ---- inspections: public output by construction (round 5 FIX-E) -----------------------------------------------------------------
// The public side of an inspection row never reads the establishment name column, a title field or any free-text column: three review
// rounds kept getting a person's name through a name classifier onto public rows, so the public path depends on no classifier at all.

/** An inspection id column value that may form part of the public external id (review4 P2-4). */
export const INSPECTION_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The generic noun every public inspection title ends with. */
export const INSPECTION_NOUN = 'food establishment';

/** "Failed inspection in <dataset city>: food establishment", for EVERY inspection row whatever its name column says. */
export function inspectionTitle(city: string): string {
  return `Failed inspection in ${city}: ${INSPECTION_NOUN}`;
}

/**
 * One summary value of an inspection row, or null. Only a value in the column's FIXED list (the canonical spelling from the list is
 * printed, never the raw text), a score of 1 to 3 digits, or a grade of one letter. Anything else is dropped.
 */
export function inspectionSummaryValue(f: InspectionSummaryField, raw: string): string | null {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v) return null;
  if (f.kind === 'score') return /^\d{1,3}$/.test(v) ? v : null;
  if (f.kind === 'grade') return /^[A-Za-z]$/.test(v) ? v.toUpperCase() : null;
  const want = v.toLowerCase();
  return (f.values ?? []).find((x) => x.toLowerCase() === want) ?? null;
}

const DIRECTION_WORDS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']);
const STREET_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9'.-]*$/;

/**
 * The block-level address of an inspection row: the house number rounded down to the hundred ("0-99 block of" below 100) and the street
 * name CUT right after the first street suffix word ("5521 S KOMENSKY AVE 2B MARIA" -> "5500 block of S KOMENSKY AVE"). At most three street-name
 * words after an optional leading direction, each letters, digits, "'", "-" or a final "." only (no inner period), at least one before
 * the suffix, and at most one all-digit word (FIX-F, review4 P2-5). No street suffix, no
 * house number first, a word with three or more digits, or anything else unexpected: '' (no address at all; the title already names the
 * city). A house number that already ends in 00 prints as "<n> block of" too (no more precise than any other house on the block).
 */
export function inspectionBlockAddress(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\d{1,6})(?:\s*-\s*\d{1,6})?[A-Za-z]?(?:\s+\d\/\d)?\s+(.+)$/);
  if (!m) return '';
  const words = m[2].split(' ').map((w) => w.replace(/[,;]+$/, ''));
  const k = (w: string) => foldName(w).replace(/\.+$/, '');
  // review4 P2-5: at most three street-name words before the suffix (after an optional leading direction).
  const d = DIRECTION_WORDS.has(k(words[0] ?? '')) ? 1 : 0;
  let end = -1;
  for (let i = d; i < words.length && i <= d + 3; i++) {
    if (!STREET_TOKEN_RE.test(words[i])) return '';
    if (/\.\S/.test(words[i])) return ''; // review4 P2-5: an inner period ("maria.lopez.gmail.com")
    if (STREET_SUFFIX_WORDS.has(k(words[i])) && i > d) {
      end = i;
      break;
    }
  }
  if (end < 0) return '';
  const street = words.slice(0, end + 1);
  if (street.some((w) => /\d{3,}/.test(w.replace(/^\d+(?:st|nd|rd|th)$/i, '')))) return '';
  if (street.filter((w) => /^\d+$/.test(w)).length > 1) return ''; // review4 P2-5: a phone in 2-digit chunks
  const hundred = Math.floor(Number(m[1]) / 100) * 100;
  return `${hundred === 0 ? '0-99' : hundred} block of ${street.join(' ')}`;
}

/** A zip that is exactly five digits, or null. */
export function inspectionZip(raw: string): string | null {
  const z = raw.trim();
  return /^\d{5}$/.test(z) ? z : null;
}

/**
 * Title, summary and zip of a public inspection row, read from a FIXED set of columns only: the configured categorical summary columns
 * (values checked by inspectionSummaryValue), the address columns (block level, inspectionBlockAddress) and the zip column. Never the
 * name column, a title field or a free-text column.
 */
export function inspectionPublicText(
  cfg: { city: string; inspectionSummary?: InspectionSummaryField[]; addressFields?: string[]; zipField?: string },
  read: (field: string) => string,
): { title: string; summary: string | null; zip: string | null } {
  const parts = (cfg.inspectionSummary ?? []).map((f) => inspectionSummaryValue(f, read(f.field))).filter((v): v is string => Boolean(v));
  const address = inspectionBlockAddress((cfg.addressFields ?? []).map(read).filter(Boolean).join(' '));
  const all = [...new Set(parts)];
  if (address) all.push(address);
  return {
    title: inspectionTitle(cfg.city),
    summary: all.length ? trunc(all.join(' | '), 280) : null,
    zip: cfg.zipField ? inspectionZip(read(cfg.zipField)) : null,
  };
}

export interface ParseReport {
  items: SignalInput[];
  /** raw rows received */
  rows: number;
  /** rows that had an id, a parseable date and at least one non-empty text field: the shape the config expects */
  shapeOk: number;
  /** Round 19 coverage (review P2-D): rows of the expected shape dropped because their own date is older than maxRecordAgeDays. */
  tooOld?: number;
  /** The newest record date among those rows. */
  newestTooOld?: string | null;
  /** Review fix P1-1: rows of the expected shape dropped by the dataset's keep rule (keepRow). */
  keptOut?: number;
}

/** Review fix P1-2: the dataset sends its column allow-list ($select) on this request. */
export function sendsSelect(ds: Pick<SocrataDataset, 'schemaUnverified' | 'selectOnly'>): boolean {
  return Boolean(ds.schemaUnverified || ds.selectOnly);
}

function externalIdFor(row: Row, ds: SocrataDataset): string {
  let raw: string;
  if (ds.idFields?.length) {
    const parts = ds.idFields.map((f) => s(row, f));
    raw = parts.every(Boolean) ? parts.join(':') : '';
  } else raw = s(row, ds.idField);
  // Round 20 (NEXT): an id that embeds a taxpayer number is stored as a hash only.
  return ds.hashId ? hashedId(raw) : raw;
}

function buildTitle(ds: SocrataDataset, titleBitsRaw: string[], summaryBits: string[], address: string, categories: readonly string[] = [], withheld = false): string {
  // Free-text columns (permit descriptions, 311 details, violation text) can hold names and phone numbers: titles never copy them raw.
  // Permit titles come from lib/signals/mapping/permit.ts (fixed labels), never from here. A 311 or violation title whose own text was
  // withheld (printableValues) uses fixed words for its trades instead (civicLabel).
  const titleBits = ds.subtype === 'business' ? titleBitsRaw : titleBitsRaw.map(scrubText).filter(Boolean);
  switch (ds.subtype) {
    case '311': {
      const uniq = [...new Set(titleBits.map((b) => b.toLowerCase()))].map(
        (l) => titleBits.find((b) => b.toLowerCase() === l) as string,
      );
      return `311 request in ${ds.city}: ${trunc(uniq.join(' / ') || (withheld ? civicLabel(categories, 'service request') : 'service request'), 110)}`;
    }
    case 'business':
      return titleBits[0]
        ? `New business in ${ds.city}: ${trunc(titleBits[0], 100)}`
        : summaryBits[0]
          ? `New business license in ${ds.city}: ${trunc(summaryBits[0], 100)}`
          : `New business license in ${ds.city}`;
    case 'violation':
      return `Code violation in ${ds.city}: ${trunc(titleBits[0] ?? (withheld ? civicLabel(categories, 'property violation') : 'property violation'), 110)}`;
    case 'event-permit':
      return `Permitted event in ${ds.city}: ${trunc(titleBits[0] ?? 'special event', 80)}${address ? ` at ${trunc(address, 60)}` : ''}`;
    default:
      return inspectionTitle(ds.city);
  }
}

/**
 * Pure parser with counts. Rows with no matching trade are dropped (a permit for a doghouse or a 311 pothole is noise
 * for local trades). Inspections are kept only when the dataset's failure rule says so.
 * `shapeOk` counts rows that look like the configured shape before any trade filtering, so the adapter can tell
 * "columns changed" (shapeOk 0) from "nothing relevant today". Never throws: malformed input returns an empty report.
 */
export function parseSocrataReport(raw: unknown, ds: SocrataDataset, opts: { now?: Date } = {}): ParseReport {
  const report: ParseReport = { items: [], rows: 0, shapeOk: 0 };
  // Round 19 coverage: with a query column other than the record date, an old record touched again is dropped by its own date.
  // Applied only when the caller passes `now` (the adapter and the probe do), so a pure parse of fixture rows does not depend on the clock.
  const oldest = ds.maxRecordAgeDays != null && opts.now ? opts.now.getTime() - ds.maxRecordAgeDays * 86_400_000 : null;
  if (!Array.isArray(raw)) return report;
  report.rows = raw.length;
  const out = report.items;
  const seen = new Set<string>();
  for (const item of raw) {
    try {
      if (!item || typeof item !== 'object') continue;
      const row = item as Row;
      const occurredAt = recordDateIso(row[ds.dateField], ds);
      const rawId = externalIdFor(row, ds);
      const baseText = ds.textOf ? ds.textOf((f) => s(row, f)) : ds.textFields.map((f) => s(row, f)).filter(Boolean).join(' | ');
      // Round 20 (NEXT): a code-only feed adds its NAICS sector words to the classifier text (never printed beyond the summary's sector).
      const sectorWords = ds.naicsText && ds.naicsField ? NAICS_SECTORS[s(row, ds.naicsField).slice(0, 2)] ?? '' : '';
      const text = sectorWords && baseText ? `${baseText} | ${sectorWords}` : baseText;
      if (!occurredAt || !rawId || !text) continue;
      report.shapeOk += 1;
      if (oldest !== null && Date.parse(occurredAt) < oldest) {
        report.tooOld = (report.tooOld ?? 0) + 1;
        if (!report.newestTooOld || occurredAt > report.newestTooOld) report.newestTooOld = occurredAt;
        continue;
      }
      // Round 20 (NEXT): a row the dataset does not keep (a sole proprietor, a non-storefront NAICS) is dropped before anything is built.
      if (ds.keepRow && !ds.keepRow((f) => s(row, f))) {
        report.keptOut = (report.keptOut ?? 0) + 1;
        continue;
      }
      if (ds.subtype === 'inspection' && ds.isFailure && !ds.isFailure(row)) continue;

      // review4 P2-4: an inspection id is kept only when it is a plain id, and the date half comes from the parsed date, never raw text.
      if (ds.subtype === 'inspection' && !INSPECTION_ID_RE.test(rawId)) continue;
      const externalId = ds.subtype === 'inspection' ? `${rawId}:${occurredAt.slice(0, 10)}` : rawId;
      if (seen.has(externalId)) continue;

      const permitClass = ds.subtype === 'permit' ? classifyPermitRow(ds, (f) => s(row, f)) : null;
      const classified = permitClass ? { categories: permitClass.categories, severity: 1 as Severity } : categorize(ds, text);
      // Round 20 (NEXT): a certificate of occupancy is a heads-up for the trades that work on a finished, newly occupied building.
      const categories = ds.occupancy && ds.subtype === 'permit' ? [...new Set([...classified.categories, ...OCCUPANCY_TRADES])] : classified.categories;
      const severity = classified.severity;
      if (categories.length === 0) continue;

      seen.add(externalId);
      // Who to contact: private, from the columns the dataset's contact spec names only. Never part of title, summary or data.
      const contacts = ds.contacts ? extractContacts((f) => s(row, f), ds.contacts, { city: ds.city, state: ds.state }, ds.subtype) : [];
      // Round 20 (LIC): a contractor licence number for the insert-time lookup (only where the spec names a licence state).
      const licenseRefs = ds.contacts ? extractLicenseRefs((f) => s(row, f), ds.contacts, ds.subtype) : [];

      if (ds.subtype === 'inspection') {
        // Public output by construction: no name column, no title field, no free text (inspectionPublicText).
        const pub = inspectionPublicText(ds, (f) => s(row, f));
        const pos = privatePosition(extractLatLon(row, ds), ds.subtype);
        out.push({
          source: ds.id,
          externalId,
          kind: ds.kind,
          title: pub.title,
          summary: pub.summary,
          url: datasetPageUrl(ds),
          lat: pos?.lat ?? null,
          lon: pos?.lon ?? null,
          city: ds.city,
          state: ds.state,
          zip: pub.zip,
          categories,
          severity,
          occurredAt,
          data: { dataset: ds.datasetId, domain: ds.domain, subtype: ds.subtype, cat_v: CAT_V, ...(pos?.approx ? { approxLocation: true } : {}) },
          ...(contacts.length ? { contacts } : {}),
          ...(licenseRefs.length ? { licenseRefs } : {}),
        });
        continue;
      }

      const titlePrint = printableValues(ds, ds.titleFields, (f) => s(row, f));
      const titleBits = titlePrint.values;
      // Business rows never carry a street address: sole proprietors, home-based nurses and short-term-rental hosts list home addresses.
      const rawAddress = (ds.addressFields ?? []).map((f) => s(row, f)).filter(Boolean).join(' ');
      // Review P1-B: an unverified address column is used only as the shared site-address rule keeps it (lib/contacts cleanAddress).
      // Round 20 (NEXT): a business with a `premises` rule prints its premises address only when its name passed (premisesAddressOf).
      // Round 20 (review P2-4): New York addresses are read by the New York rule (numbered streets, Queens house numbers, named streets).
      const baseAddress = ds.subtype === 'business'
        ? (ds.premises ? premisesAddressOf((f) => s(row, f), ds.premises, { city: ds.city, state: ds.state }, ds.premisesWhen) : '')
        : ds.addressRule === 'nyc'
          ? nycBlockAddress(rawAddress)
          : publicAddress(ds.subtype, ds.strictAddress ? strictSiteAddress(rawAddress) : rawAddress);
      // Review fix P2-3: a certificate of occupancy at a home prints its block (residential) or nothing (home occupation); DC keeps its quadrant.
      const occ = ds.occupancy && ds.subtype === 'permit'
        ? occupancyAddress(rawAddress, baseAddress, occupancyClassOf(ds.occupancy.typeFields.map((f) => s(row, f)), ds.occupancy.unknownType), ds.keepQuadrant)
        : null;
      const address = occ ? occ.address : baseAddress;
      const summaryFields = ds.summaryFields.filter((f) => printableValues(ds, [f], (x) => s(row, x)).values.length > 0);
      // Review P3-7: a printed status or type value of a 311 or violation row never carries who acted on it.
      const civicRow = ds.subtype === '311' || ds.subtype === 'violation';
      const summaryBits = summaryFields.map((f) => summaryPart(f, civicRow ? stripActor(s(row, f)) : s(row, f))).filter(Boolean);
      // A feed with only a NAICS code (San Francisco): the two-digit sector reads naturally; an unknown code adds nothing.
      if (!summaryBits.length && ds.naicsField) {
        const sector = NAICS_SECTORS[s(row, ds.naicsField).slice(0, 2)];
        if (sector) summaryBits.push(sector);
      }
      const title = ds.occupancy && ds.subtype === 'permit'
        ? occupancyTitle(ds.city, occupancyTypeText(printableValues(ds, ds.occupancy.typeFields, (f) => s(row, f)).values))
        : permitClass ? permitTitleFor(ds.city, permitClass.label) : buildTitle(ds, titleBits, summaryBits, address, categories, titlePrint.withheld);

      // 311 summaries leave the street address out; permits, businesses, violations and events are business/property records. Only the
      // configured summary fields are read, never owner or applicant columns.
      const summaryParts = [...new Set(summaryBits)];
      if (address && ds.subtype !== '311') summaryParts.push(address);
      const summary = ds.subtype === 'business'
        ? businessSummary(summaryParts, address)
        : publicSummary(summaryParts, { minChars: ds.subtype === 'permit' ? 15 : undefined });

      const exactPos = extractLatLon(row, ds);
      const pos = privatePosition(exactPos, ds.subtype);
      // Final review P2-1: the building of a NYC whole-building heat complaint, as a keyed hash of its exact point (building-ref.ts).
      const bref = isWholeBuildingHeat({ source: ds.id, title }) ? buildingRefOf(exactPos?.lat, exactPos?.lon) : null;
      const zip = s(row, ds.zipField).slice(0, 5) || null;
      // Permits: the project value the city published, as a number (PLAN-2.0 1.3). Public already: the summary prints the same amount.
      const jobValue = ds.subtype === 'permit' ? extractJobValue((f) => s(row, f), ds.valueFields ?? moneyFields(ds.summaryFields)) : null;
      const expiresAt = ds.endDateField ? toIso(row[ds.endDateField], ds.tz) : null;
      // Permits: the stage the status column shows, as a fixed code (lib/signals/stage.ts). The scan decides whether to store it.
      const permitStage = ds.occupancy && ds.subtype === 'permit'
        ? ('certificate_of_occupancy' as const)
        : ds.subtype === 'permit' && ds.statusField ? permitStageOf(s(row, ds.statusField)) : null;
      // Round 20 (NEXT; review P1-1 of r20-ship): a 311 request about a property, or a NYC request about a whole building ("HEAT/HOT
      // WATER / ENTIRE BUILDING"), gives at most a PRIVATE block-level site (holler_signal_contacts, service role only, shown to a member with
      // access on the card's "Who to contact" block). One rule for both (lib/signals/site-311.ts). The public row never carries it.
      const place311 = { city: ds.city, state: ds.state, zip };
      const site311 = ds.subtype === '311' && ds.site311 ? site311Contact((f) => s(row, f), ds.site311, place311) : null;
      const building311 = ds.subtype === '311' && ds.buildingAddress ? nycWholeBuildingContact((f) => s(row, f), ds.buildingAddress, place311) : null;
      // Review fix P2-3: a residential or home certificate keeps no exact private site either.
      const kept = occ?.dropSite ? contacts.filter((c) => c.role !== 'site') : contacts;
      const allContacts = [...kept, ...(site311 ? [site311] : []), ...(building311 ? [building311] : [])];
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
          cat_v: CAT_V,
          ...(pos?.approx ? { approxLocation: true } : {}),
          ...(jobValue !== null ? { jobValue } : {}),
          ...(bref ? { bref } : {}),
        },
        ...(allContacts.length ? { contacts: allContacts } : {}),
        ...(licenseRefs.length ? { licenseRefs } : {}),
        ...(permitStage ? { permitStage } : {}),
        ...(ds.addressRule === 'nyc' && ds.subtype === 'violation' ? visitKeyFor(ds.id, rawAddress, occurredAt) : {}),
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
  // A system column (':updated_at') is a UTC timestamp; a dataset column is a floating local one. queryDateField: see socrata-datasets.ts.
  const qField = ds.queryDateField ?? ds.dateField;
  const sinceStr = qField.startsWith(':') ? from.toISOString().slice(0, 19) : toFloatingLocal(from, ds.tz);
  const clauses = [`${qField} > '${sinceStr}'`];
  if (ds.windowForwardDays != null && !ds.queryDateField) {
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
  // Paged datasets order by the id too: many rows share one date-only timestamp, and an unstable order would repeat or skip rows across pages.
  p.set('$order', pages(ds) > 1 ? `${qField} DESC, ${ds.idField}` : `${qField} DESC`);
  p.set('$limit', String(LIMIT));
  return p;
}

/** How far back the stage query looks (days): wider than a scan interval, so one missed scan loses nothing. */
export const STAGE_QUERY_DAYS = 3;
const STAGE_QUERY_TIMEOUT_MS = 8000;

/**
 * The stage query (PLAN-2.0 2.1): permits whose status or row changed lately, whatever their issue date. One page of LIMIT rows, newest
 * change first. Null for a dataset without a stageQuery, a status column or the permit subtype. A row it returns is only a PROBE: it can
 * move a permit Holler already tracks to a new stage (lib/signals/projects.ts) and it can do nothing else, so a portal that touches
 * old rows for any reason (a reload, a batch edit) changes nothing. Behind HOLLER_STAGE_UPDATES_ENABLED, and only while 0025 is applied.
 */
export function buildSocrataStageQuery(ds: SocrataDataset, now: Date = new Date()): URLSearchParams | null {
  const sq = ds.stageQuery;
  if (!sq || ds.subtype !== 'permit' || !ds.statusField) return null;
  const from = new Date(now.getTime() - STAGE_QUERY_DAYS * 86_400_000);
  const since = sq.dateField.startsWith(':') ? from.toISOString().slice(0, 19) : toFloatingLocal(from, ds.tz);
  const clauses = [`${sq.dateField} > '${since}'`];
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  clauses.push(`(${STAGE_STATUS_FRAGMENTS.map((f) => `upper(${ds.statusField}) like '%${f}%'`).join(' OR ')})`);
  const p = new URLSearchParams();
  p.set('$where', clauses.join(' AND '));
  p.set('$order', `${sq.dateField} DESC`);
  p.set('$limit', String(LIMIT));
  return p;
}

/** Rows of a stage query response that read as final inspection, finished or certificate of occupancy, marked as probes. */
export function parseSocrataStageRows(raw: unknown, ds: SocrataDataset): SignalInput[] {
  if (!ds.stageQuery || !Array.isArray(raw)) return [];
  return parseSocrataReport(raw, ds)
    .items.filter((it) => it.permitStage && isTriggerStage(it.permitStage))
    .map((it) => ({ ...it, stageProbe: true }));
}

/** Main rows plus the probe rows of permits the main read did not return. A permit in both keeps its main row. */
export function mergeStageRows(main: SignalInput[], probes: SignalInput[]): SignalInput[] {
  const have = new Set(main.map((m) => m.externalId));
  return [...main, ...probes.filter((p) => !have.has(p.externalId))];
}

export interface StageQueryRun {
  outcome: StageQueryOutcome;
  /** Probe rows (see parseSocrataStageRows). */
  items: SignalInput[];
  /** The status text of the first rows, as the portal wrote it (owner dry check only). */
  sampleStatuses: string[];
  /** The portal's message when it refused the query (an unknown column), shortened. */
  message?: string;
}

/**
 * Runs the stage query once and says how it went. Never throws. 'rejected' is a portal that answered an error (an unknown date column,
 * the usual first problem); 'failed' is a timeout or a non-list answer; 'full_page' is a full page of rows (the newest changes are read,
 * older ones in the same days may not be). Shared by the scan and by the owner's dry check (lib/signals/stage-probe.ts), which writes nothing.
 */
export async function runStageQuery(ds: SocrataDataset, doFetch: typeof fetch, headers: Record<string, string>, now: Date): Promise<StageQueryRun> {
  const dateField = ds.stageQuery?.dateField ?? '';
  const none = (state: StageQueryOutcome['state'], extra: Partial<StageQueryRun> & { httpStatus?: number } = {}): StageQueryRun => ({
    outcome: { state, rows: 0, dateField, ...(extra.httpStatus !== undefined ? { httpStatus: extra.httpStatus } : {}) },
    items: [],
    sampleStatuses: [],
    ...(extra.message ? { message: extra.message } : {}),
  });
  try {
    const query = buildSocrataStageQuery(ds, now);
    if (!query) return none('failed');
    const res = await doFetch(`https://${ds.domain}/resource/${ds.datasetId}.json?${query.toString()}`, { headers, signal: AbortSignal.timeout(STAGE_QUERY_TIMEOUT_MS) });
    if (!res.ok) {
      let message = '';
      try {
        const body = (await res.json()) as { message?: unknown; code?: unknown };
        message = String(body?.message ?? body?.code ?? '').replace(/\s+/g, ' ').slice(0, 120);
      } catch {
        /* the body is not JSON: the status code is enough */
      }
      return none('rejected', { httpStatus: res.status, message });
    }
    const part: unknown = await res.json();
    if (!Array.isArray(part)) return none('failed', { httpStatus: res.status });
    const sampleStatuses = part.slice(0, 5).map((r) => trunc(s(r as Row, ds.statusField), 40));
    return {
      outcome: { state: part.length >= LIMIT ? 'full_page' : 'ok', rows: part.length, dateField, httpStatus: res.status },
      items: parseSocrataStageRows(part, ds),
      sampleStatuses,
    };
  } catch (e) {
    return none('failed', { message: e instanceof Error ? e.message.slice(0, 80) : 'unknown' });
  }
}

function pages(ds: Pick<SocrataDataset, 'maxPages'>): number {
  return Math.max(1, Math.min(ds.maxPages ?? 1, 6));
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
  const label = ds.label ?? `${ds.city} open data: ${LABEL_SUFFIX[ds.subtype]}`;
  return {
    id: ds.id,
    label,
    kind: ds.kind,
    cadenceMinutes: ds.cadenceMinutes,
    ...(ds.probation ? { probation: true } : {}),
    sourceUrl: datasetPageUrl(ds),
    ...(ds.stageQuery && ds.subtype === 'permit' && ds.statusField ? { stageQuery: true } : {}),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const query = buildSocrataQuery(ds, ctx.now ?? new Date());
        // Review P3-M: a schema-unverified dataset asks only for the columns it reads ($select), so nothing else is downloaded.
        // Review fix P1-2: a selectOnly dataset keeps its allow-list after promotion too (sendsSelect).
        if (sendsSelect(ds)) query.set('$select', socrataSelectColumns(ds).join(','));
        // Review fix P2-1: an id that must be keyed and no key: no request at all.
        if (ds.hashId && !idKeySecret()) {
          ctx.log(`error: ${ds.id}: no id key (HOLLER_BUILDING_REF_SECRET or SUPABASE_SERVICE_ROLE_KEY); no request sent`);
          return [];
        }
        const timeoutMs = ds.schemaUnverified ? UNVERIFIED_REQUEST_TIMEOUT_MS : 15000;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
        const token = ctx.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
        if (token) headers['X-App-Token'] = token;
        const body: unknown[] = [];
        for (let page = 0; page < pages(ds); page++) {
          if (page > 0) query.set('$offset', String(page * LIMIT));
          const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${query.toString()}`;
          const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
          if (!res.ok) {
            if (ds.schemaUnverified && res.status === 400) {
              // Socrata answers 400 for a column it does not have ($select, $order): that is the schema, said as such (column names only).
              let msg = '';
              try {
                const b = (await res.json()) as { message?: unknown };
                msg = String(b?.message ?? '').replace(/[^\w :.,'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
              } catch {
                /* the status is enough */
              }
              ctx.log(`error: schema mismatch: the portal refused the column list (${ds.id}: HTTP 400${msg ? `; ${msg}` : ''})`);
            } else ctx.log(`${ds.id}: HTTP ${res.status}`);
            if (page === 0) return [];
            break; // keep the pages already read
          }
          let part: unknown;
          if (ds.schemaUnverified) {
            const read = await readJsonBody(res);
            if (!read.ok) {
              ctx.log(`error: ${ds.id}: ${read.problem} (HTTP ${res.status})`);
              if (page === 0) return [];
              break;
            }
            part = read.body;
          } else part = await res.json();
          if (!Array.isArray(part)) {
            ctx.log(`error: ${ds.id} returned a non-array response, shape may have changed`);
            if (page === 0) return [];
            break;
          }
          body.push(...part);
          if (part.length < LIMIT) break;
          // Review P2-F: the last page allowed was full: older rows in the window were not read.
          if (ds.schemaUnverified && page === pages(ds) - 1) ctx.log(`${PROBATION_NOTE_PREFIX} row cap reached: ${body.length} rows read (limit ${LIMIT * pages(ds)}); older rows in the window were not read`);
        }
        const report = parseSocrataReport(body, ds, { now: ctx.now ?? new Date() });
        if (report.rows > 0 && report.items.length === 0) {
          const problem = report.shapeOk === 0 && ds.schemaUnverified ? socrataSchemaProblem(body, ds) : null;
          if (problem) {
            ctx.log(schemaMismatchLog(ds.id, problem, body));
          } else if (report.shapeOk === 0) {
            ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
          } else if (report.keptOut && report.keptOut === report.shapeOk) {
            // Review fix P1-1: every row was dropped by the keep rule (organisation type, NAICS, new-business flag): said as such.
            ctx.log(`${ds.id}: ${report.rows} rows read, all dropped by the keep rule`);
          } else if (report.tooOld && report.tooOld === report.shapeOk) {
            // Review P2-D: every row is older than the age limit (a republished dataset, or a feed that stopped): broken, not quiet.
            ctx.log(`error: ${ds.id}: no rows in the last ${ds.maxRecordAgeDays} days: newest is ${(report.newestTooOld ?? '').slice(0, 10)} (${report.rows} rows read)`);
          } else {
            // Rows look right but none map to a trade (or none failed): a quiet window, not a broken source.
            ctx.log(`${ds.id}: ${report.rows} rows, 0 matched a trade`);
          }
        }
        if (ctx.stageTracking && ds.stageQuery) {
          const extra = await fetchStageRows(ds, ctx, headers);
          if (extra.length) return mergeStageRows(report.items, extra);
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

/** The columns a dataset reads (id, date, title, text, summary, address, zip, coordinates, status, contacts, value), for $select. */
export function socrataSelectColumns(ds: SocrataDataset): string[] {
  return [
    ...new Set(
      [
        ...(ds.idFields?.length ? ds.idFields : [ds.idField]), ds.dateField, ...ds.titleFields, ...ds.textFields, ...ds.summaryFields, ...(ds.buildingAddress?.fields ?? []),
        ...(ds.addressFields ?? []), ds.zipField, ds.latField, ds.lonField, ds.locationField, ds.latLonTextField, ds.statusField,
        ...contactSpecFields(ds.contacts), ...(ds.valueFields ?? []),
        // Round 20 (NEXT): the premises, 311 site and occupancy type columns, and the NAICS column.
        ...contactSpecFields(ds.premises), ...(ds.site311 ? [...ds.site311.addressFields, ...ds.site311.typeFields] : []),
        ...(ds.occupancy?.typeFields ?? []), ds.naicsField, ...(ds.keepFields ?? []),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
}

/**
 * The stage query's probe rows, or none. Never throws and never costs the main rows: one request, one page, its own short timeout. The
 * outcome goes to ctx.stageOutcome (run.ts writes a failure on that source's scan_runs row); the log line has no error-looking word, so
 * the source itself is not called broken.
 */
async function fetchStageRows(ds: SocrataDataset, ctx: AdapterContext, headers: Record<string, string>): Promise<SignalInput[]> {
  const run = await runStageQuery(ds, ctx.fetch, headers, ctx.now ?? new Date());
  ctx.stageOutcome?.(run.outcome);
  if (run.outcome.state === 'rejected') ctx.log(`${ds.id}: stage query not used (code ${run.outcome.httpStatus}; the date column ${run.outcome.dateField} needs a live check)`);
  else if (run.outcome.state === 'failed') ctx.log(`${ds.id}: stage query not used (${run.message ?? 'no usable answer'})`);
  else if (run.outcome.state === 'full_page') ctx.log(`${ds.id}: stage query returned a full page; the newest changes were read`);
  return run.items;
}

/** Round 19 coverage: why no row of a schema-unverified dataset parsed (missing id or date column, unreadable date), or null. */
export function socrataSchemaProblem(rows: readonly unknown[], ds: SocrataDataset): string | null {
  return schemaProblem(rows, {
    idFields: ds.idFields?.length ? ds.idFields : [ds.idField],
    dateField: ds.dateField,
    readsAsDate: (v) => recordDateIso(v, ds) !== null,
  });
}

/** Only verified datasets are enabled by default. */
export const adapters: Adapter[] = SOCRATA_DATASETS.filter((d) => d.verified).map(buildSocrataAdapter);
