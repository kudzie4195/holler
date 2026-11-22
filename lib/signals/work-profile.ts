import { isPermitRecord, permitLabelsOf, routeKindsOf, summaryParts } from './permit-routing';
import { jobValueOf } from './permit-value';

/**
 * A member's work profile (round 18 ROUTES, migration 0027): what work they take. Three optional settings, one row per member in
 * holler_work_profiles (a small table, so no read of holler_profiles changes; the matcher reads it on its own):
 *   work_property   'residential' | 'commercial' | 'both' (default both)
 *   work_min_value  smallest job they take, whole US dollars, or null (default: no minimum)
 *   work_type       'repairs' (repairs and service) | 'installs' (new installs and builds) | 'both' (default both)
 *
 * How matching uses it (lib/signals/match.ts), every rule conservative: when the record does not say, the member still gets the card.
 *  - Property focus: a record is filtered out only when it STATES residential or commercial (recordPropertyOf) and the member takes only
 *    the other. Only building permits are read (their structured type, class and use, or a feed that is one class by itself).
 *  - Work type: a record is filtered out only when its kind makes it clear (recordWorkTypeOf): a new-build permit is an install, a
 *    repair-only permit, a code violation, a no-heat complaint or a sewage back-up is a repair. Anything else is unclear and never filtered.
 *  - Minimum job value: a permit whose stated job value is below the minimum is not alerted (it stays in the feed, marked "below your
 *    minimum": lib/signals/alert-gate.ts). A permit with no stated value is alerted as before.
 *
 * Pure and client-safe: no server imports, no clock.
 */
export type PropertyFocus = 'residential' | 'commercial' | 'both';
export type WorkType = 'repairs' | 'installs' | 'both';

export const PROPERTY_FOCUS: readonly PropertyFocus[] = ['both', 'residential', 'commercial'];
export const WORK_TYPES: readonly WorkType[] = ['both', 'repairs', 'installs'];
/** Largest minimum a member can save (the migration's check constraint uses the same number). */
export const MAX_MIN_JOB_VALUE = 100_000_000;

export interface WorkProfile {
  property: PropertyFocus;
  minValue: number | null;
  workType: WorkType;
}

/** The three columns as holler_work_profiles holds them (migration 0027), also carried on a MatchProfile. Absent before the migration. */
export interface WorkColumns {
  work_property?: unknown;
  work_min_value?: unknown;
  work_type?: unknown;
}

/** The columns of holler_work_profiles (migration 0027) the matcher and Settings read. */
export const WORK_PROFILE_COLUMNS = 'work_property, work_min_value, work_type';

export function isPropertyFocus(v: unknown): v is PropertyFocus {
  return v === 'residential' || v === 'commercial' || v === 'both';
}

export function isWorkType(v: unknown): v is WorkType {
  return v === 'repairs' || v === 'installs' || v === 'both';
}

/** A stored minimum: a whole number of dollars from 1 to MAX_MIN_JOB_VALUE, else null (no minimum). Accepts the text form too. */
export function parseMinValue(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole >= 1 && whole <= MAX_MIN_JOB_VALUE ? whole : null;
}

/** The work settings of a profile row, with every missing or unknown value read as the default (both / none / both). */
export function workSettingsOf(row: WorkColumns | null | undefined): WorkProfile {
  return {
    property: isPropertyFocus(row?.work_property) ? row.work_property : 'both',
    minValue: parseMinValue(row?.work_min_value),
    workType: isWorkType(row?.work_type) ? row.work_type : 'both',
  };
}

/** The settings that change matching, or null when none does (no row, no columns, or all defaults): matching is then exactly as before 0027. */
export function workProfileOf(row: WorkColumns | null | undefined): WorkProfile | null {
  if (!row) return null;
  const w = workSettingsOf(row);
  return w.property === 'both' && w.minValue === null && w.workType === 'both' ? null : w;
}

/** What the work rules read from a record. */
export interface WorkRecord {
  source?: string | null;
  kind?: string | null;
  subtype?: string | null;
  title?: string | null;
  summary?: string | null;
  data?: { [k: string]: unknown } | null;
}

/**
 * Feeds whose every row is one class: the Cobb County permit portal publishes residential, multi-unit residential and commercial permits as
 * three separate layers (lib/signals/adapters/arcgis-cobb.ts), so the layer itself states the class.
 */
export const PROPERTY_BY_SOURCE: Readonly<Record<string, Exclude<PropertyFocus, 'both'>>> = {
  'arcgis-cobb-residential-permits': 'residential',
  'arcgis-cobb-multiunit-permits': 'residential',
  'arcgis-cobb-commercial-permits': 'commercial',
};

/**
 * A summary part that states a home: "Residential Alteration", "New Building Permit (R)", "1 or 2 Family Dwelling", "Single Family Detached",
 * "Single Family/Duplex", "Townhouse", "Townhome", "SFR", "Alter Residential". Seen in the real rows of these feeds (tests/signals/__data__
 * review-f-sample-156.json, quality-gate-r15-cards.json and tests/fixtures): arcgis-atlanta, arcgis-dekalb, arcgis-johnscreek,
 * arcgis-raleigh, socrata-batonrouge, socrata-cincinnati, socrata-la, socrata-nola, socrata-orlando, socrata-seattle.
 * Apartments and multifamily are NOT read as either class (a house cleaner and an office cleaner may both want them): never filtered.
 */
const RESIDENTIAL_PART_RE =
  /\bresidential\b|\(r\)|\bsingle[\s-]?family\b|\b1 or 2 family\b|\btwo[\s-]?family\b|\bduplex\b|\btownho(?:use|me)s?\b|\bsfr\b|\bsfd\b/i;
/**
 * A summary part that states a business property: "Commercial Alteration", "New Building Permit (C)", "Alter Commercial", "Commercial Upfit",
 * "Com Garage/Shed<800", "Industrial", or a part that is exactly an occupancy class ("Business", "Office", "Mercantile", "Retail",
 * "Warehouse"). Seen in: arcgis-atlanta, arcgis-dekalb ("Business"), arcgis-mecklenburg, socrata-batonrouge, socrata-cincinnati,
 * socrata-seattle.
 */
const COMMERCIAL_PART_RE = /\bcommercial\b|\(c\)|^com\s|\bindustrial\b|^(?:business|office|mercantile|retail|warehouse)$/i;

/**
 * The class a record STATES, or null when it does not say (or says both). Building permits only: no other record kind states it in a
 * field this code reads. A permit's summary holds its structured type, class and use (permit-routing.ts summaryParts).
 */
export function recordPropertyOf(r: WorkRecord): Exclude<PropertyFocus, 'both'> | null {
  if (!isPermitRecord(r)) return null;
  const bySource = typeof r.source === 'string' ? PROPERTY_BY_SOURCE[r.source] : undefined;
  if (bySource) return bySource;
  // The structured parts, plus LA's use class "1 or 2 Family Dwelling" (summaryParts drops every part that starts with a number, as an
  // address would).
  const parts = [...summaryParts(r.summary), ...(r.summary ?? '').split(' | ').filter((p) => /^\s*1 or 2 family\b/i.test(p))];
  const res = parts.some((p) => RESIDENTIAL_PART_RE.test(p));
  const com = parts.some((p) => COMMERCIAL_PART_RE.test(p.trim()));
  if (res === com) return null;
  return res ? 'residential' : 'commercial';
}

/** Permit title kinds that are repair work and nothing else ("Repair permit", "Damage repair permit"). */
const REPAIR_LABELS: ReadonlySet<string> = new Set(['repair', 'damage repair']);
/** 311 titles that are a repair order: no heat or hot water, a sewage back-up (the same words as lead-rules.ts act-no-heat and act-sewage-backup). */
const REPAIR_311_RE = /heat\/hot water|non-residential heat|\bhot water\b|\bno heat\b|sew(?:er|age).*back-?\s?up/i;

/**
 * The kind of work a record makes clear, or null when it is unclear:
 *  - 'installs': a building permit whose type is a new build (permit-routing.ts routeKindsOf gives 'new-build', which already turns an
 *    addition, an alteration or an accessory structure away);
 *  - 'repairs': a permit whose title names only repair kinds, a code violation (an order to fix), a no-heat complaint or a sewage back-up.
 * Every other record (a re-roof, an HVAC permit, a bid, a storm report, a licence) is unclear: it can be either, so it is never filtered.
 */
export function recordWorkTypeOf(r: WorkRecord): Exclude<WorkType, 'both'> | null {
  if (isPermitRecord(r)) {
    if (routeKindsOf(r.title, { summary: r.summary, source: r.source }).includes('new-build')) return 'installs';
    const labels = permitLabelsOf(r.title);
    if (labels && labels.every((l) => REPAIR_LABELS.has(l))) return 'repairs';
    return null;
  }
  const subtype = typeof r.subtype === 'string' ? r.subtype.toLowerCase() : '';
  if (subtype === 'violation') return 'repairs';
  if (subtype === '311') {
    const t = r.title ?? '';
    const body = t.includes(': ') ? t.slice(t.indexOf(': ') + 2) : t;
    if (REPAIR_311_RE.test(body)) return 'repairs';
  }
  return null;
}

/**
 * True when the member's property focus or work type rules this record out. Never true when the record does not say, or when the
 * member takes both.
 */
export function workFilterDrops(r: WorkRecord, w: WorkProfile | null | undefined): boolean {
  if (!w) return false;
  if (w.property !== 'both') {
    const p = recordPropertyOf(r);
    if (p !== null && p !== w.property) return true;
  }
  if (w.workType !== 'both') {
    const k = recordWorkTypeOf(r);
    if (k !== null && k !== w.workType) return true;
  }
  return false;
}

/** The job value a permit states, in whole dollars, or null (data.jobValue, else the "$N job value" part of its summary). */
export function statedJobValue(r: WorkRecord): number | null {
  if (!isPermitRecord(r)) return null;
  return jobValueOf({ jobValue: r.data?.jobValue, summary: r.summary });
}

/** True when a permit states a job value and it is below the member's minimum. A permit with no stated value is never below it. */
export function belowMinimum(r: WorkRecord, w: WorkProfile | null | undefined): boolean {
  if (!w || w.minValue === null) return false;
  const v = statedJobValue(r);
  return v !== null && v < w.minValue;
}
