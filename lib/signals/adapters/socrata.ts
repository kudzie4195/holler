import { classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { extractContacts } from '@/lib/contacts/extract';
import { STREET_SUFFIX_WORDS, foldName } from '@/lib/contacts/org';
import { publicSummary, scrubText, summaryPart, civicLabel, cutAfterStreetSuffix, looksLikeProse, categoryValueHasName } from './permit-privacy';
import { classifyPermit, isStructuredField, permitTitleFor } from '@/lib/signals/mapping/permit';
import { CAT_V } from '@/lib/signals/mapping/version';
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
  // Permits: one classification for trades and title (lib/signals/mapping/permit.ts). Plain text is read as description values.
  if (ds.subtype === 'permit') return { categories: classifyPermit({ structured: [], free: text.split(' | ') }).categories, severity: 1 };
  const set = new Set<CategoryId>();
  let severity: Severity = ds.subtype === 'inspection' ? 2 : 1;
  for (const rule of RULES_BY_SUBTYPE[ds.subtype]) {
    if (rule.re.test(text) && !rule.unless?.test(text)) {
      rule.add.forEach((c) => set.add(c));
      if (rule.severity && rule.severity > severity) severity = rule.severity;
    }
  }
  // A new roofing business is a competitor, not a roofing lead: business and event rules decide alone.
  if (ds.subtype !== 'business' && ds.subtype !== 'event-permit') classifyText(text).forEach((c) => set.add(c));
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
 * point at a home. Code-violation rows and EVERY inspection row are rounded to 3 decimals (about 100 m, a block): holler_signals is
 * public, and such a record is often a private home (a home daycare). Everything else keeps its exact point.
 */
export function privatePosition<T extends { lat: number; lon: number }>(pos: T | null, subtype: string): T | null {
  if (!pos) return pos;
  const f = subtype === 'business' ? 100 : subtype === 'violation' || subtype === 'inspection' ? 1000 : 0;
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
    const v = get(f);
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
}

function externalIdFor(row: Row, ds: SocrataDataset): string {
  if (ds.idFields?.length) {
    const parts = ds.idFields.map((f) => s(row, f));
    return parts.every(Boolean) ? parts.join(':') : '';
  }
  return s(row, ds.idField);
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

      // review4 P2-4: an inspection id is kept only when it is a plain id, and the date half comes from the parsed date, never raw text.
      if (ds.subtype === 'inspection' && !INSPECTION_ID_RE.test(rawId)) continue;
      const externalId = ds.subtype === 'inspection' ? `${rawId}:${occurredAt.slice(0, 10)}` : rawId;
      if (seen.has(externalId)) continue;

      const permitClass = ds.subtype === 'permit' ? classifyPermitRow(ds, (f) => s(row, f)) : null;
      const { categories, severity } = permitClass ? { categories: permitClass.categories, severity: 1 as Severity } : categorize(ds, text);
      if (categories.length === 0) continue;

      seen.add(externalId);
      // Who to contact: private, from the columns the dataset's contact spec names only. Never part of title, summary or data.
      const contacts = ds.contacts ? extractContacts((f) => s(row, f), ds.contacts, { city: ds.city, state: ds.state }, ds.subtype) : [];

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
        });
        continue;
      }

      const titlePrint = printableValues(ds, ds.titleFields, (f) => s(row, f));
      const titleBits = titlePrint.values;
      // Business rows never carry a street address: sole proprietors, home-based nurses and short-term-rental hosts list home addresses.
      const rawAddress = (ds.addressFields ?? []).map((f) => s(row, f)).filter(Boolean).join(' ');
      const address = ds.subtype === 'business' ? '' : publicAddress(ds.subtype, rawAddress);
      const summaryFields = ds.summaryFields.filter((f) => printableValues(ds, [f], (x) => s(row, x)).values.length > 0);
      const summaryBits = summaryFields.map((f) => summaryPart(f, s(row, f))).filter(Boolean);
      // A feed with only a NAICS code (San Francisco): the two-digit sector reads naturally; an unknown code adds nothing.
      if (!summaryBits.length && ds.naicsField) {
        const sector = NAICS_SECTORS[s(row, ds.naicsField).slice(0, 2)];
        if (sector) summaryBits.push(sector);
      }
      const title = permitClass ? permitTitleFor(ds.city, permitClass.label) : buildTitle(ds, titleBits, summaryBits, address, categories, titlePrint.withheld);

      // 311 summaries leave the street address out; permits, businesses, violations and events are business/property records. Only the
      // configured summary fields are read, never owner or applicant columns.
      const summaryParts = [...new Set(summaryBits)];
      if (address && ds.subtype !== '311') summaryParts.push(address);
      const summary = ds.subtype === 'business'
        ? trunc(summaryParts.join(' | '), 280) || null
        : publicSummary(summaryParts, { minChars: ds.subtype === 'permit' ? 15 : undefined });

      const pos = privatePosition(extractLatLon(row, ds), ds.subtype);
      const zip = s(row, ds.zipField).slice(0, 5) || null;
      const expiresAt = ds.endDateField ? toIso(row[ds.endDateField], ds.tz) : null;
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
        },
        ...(contacts.length ? { contacts } : {}),
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
  // Paged datasets order by the id too: many rows share one date-only timestamp, and an unstable order would repeat or skip rows across pages.
  p.set('$order', pages(ds) > 1 ? `${ds.dateField} DESC, ${ds.idField}` : `${ds.dateField} DESC`);
  p.set('$limit', String(LIMIT));
  return p;
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
  const label = `${ds.city} open data: ${LABEL_SUFFIX[ds.subtype]}`;
  return {
    id: ds.id,
    label,
    kind: ds.kind,
    cadenceMinutes: ds.cadenceMinutes,
    sourceUrl: datasetPageUrl(ds),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const query = buildSocrataQuery(ds, ctx.now ?? new Date());
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
        const token = ctx.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
        if (token) headers['X-App-Token'] = token;
        const body: unknown[] = [];
        for (let page = 0; page < pages(ds); page++) {
          if (page > 0) query.set('$offset', String(page * LIMIT));
          const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${query.toString()}`;
          const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
          if (!res.ok) {
            ctx.log(`${ds.id}: HTTP ${res.status}`);
            if (page === 0) return [];
            break; // keep the pages already read
          }
          const part: unknown = await res.json();
          if (!Array.isArray(part)) {
            ctx.log(`error: ${ds.id} returned a non-array response, shape may have changed`);
            if (page === 0) return [];
            break;
          }
          body.push(...part);
          if (part.length < LIMIT) break;
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
