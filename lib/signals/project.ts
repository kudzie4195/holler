import { haversineMi } from '@/lib/geo';
import { siteAddressFromSummary } from './permit-value';

/**
 * One building project, seen in more than one record (PLAN-2.0 item 2.3). Pure and client-safe: no server imports, no clock, no network.
 *
 * Two records are the SAME PROJECT only on a strong match, never on an address alone:
 *   - the same normalized street address (units kept: two units are two addresses), AND
 *   - the same trade (the same sorted tag set: an electrical permit and a plumbing permit at one address are two projects), AND
 *   - occurred within PROJECT_WINDOW_DAYS of each other, AND
 *   - the same place: both with a real position within SAME_SITE_MI of each other, or else the same city text.
 * A permit number is a stable id only inside its own source, and the store already keeps (source, external id) unique, so the strong
 * match is for the case where a portal lists one job under two numbers (a re-issued or duplicated row).
 *
 * What a match means depends on where the second record came from (relationOf):
 *   duplicate       the same source, or a source listed as a mirror of it (MIRROR_GROUPS): the same record again. Not stored; counted.
 *   corroboration   a different source about the same project: independent evidence. Stored, linked to the first record, and it makes no
 *                   second card or alert.
 */

/**
 * N: records inside this many days of each other can be one project. Three days keeps a portal's double listing (the same issue day)
 * and a few days of lag between two portals together, and keeps two jobs a week apart apart. It also means that a batch of permits for
 * several units of one street address, for the same trade, inside three days is one project with one card.
 */
export const PROJECT_WINDOW_DAYS = 3;
/** Two exact positions farther apart than this (miles, about 150 m) are not one site, whatever the address text says. */
export const SAME_SITE_MI = 0.1;

/**
 * Sources that are known copies of each other (one portal re-publishing another). Each inner list is one family. Empty: no pair of
 * sources has been shown to mirror the other, and a wrong entry would hide real evidence as "duplicate". Add a family only with proof.
 */
export const MIRROR_GROUPS: readonly (readonly string[])[] = [];

const SUFFIX: Record<string, string> = {
  STREET: 'ST', STR: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', COURT: 'CT', BOULEVARD: 'BLVD', PLACE: 'PL',
  CIRCLE: 'CIR', PARKWAY: 'PKWY', HIGHWAY: 'HWY', TERRACE: 'TER', TRAIL: 'TRL', SQUARE: 'SQ', EXPRESSWAY: 'EXPY',
};
const DIRECTION: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};
const UNIT_WORDS = new Set(['APT', 'APARTMENT', 'UNIT', 'STE', 'SUITE', 'FL', 'FLOOR', 'BLDG', 'RM']);

/** "1200 East 14th Street, Apt 4" -> "1200 E 14TH ST #4". Null for anything that is not a street address. */
export function normalizeAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.toUpperCase().replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || !/^\d/.test(t)) return null;
  const out: string[] = [];
  const words = t.split(' ');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (UNIT_WORDS.has(w) && words[i + 1]) {
      out.push(`#${words[i + 1].replace(/^#/, '')}`);
      i++;
    } else if (i > 0 && DIRECTION[w]) out.push(DIRECTION[w]);
    else if (i > 0 && SUFFIX[w]) out.push(SUFFIX[w]);
    else out.push(w);
  }
  const s = out.join(' ');
  return s.length >= 5 && s.length <= 80 ? s : null;
}

export interface ProjectRecord {
  source: string;
  externalId: string;
  title?: string | null;
  summary?: string | null;
  categories?: readonly string[] | null;
  occurredAt: string;
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  state?: string | null;
  data?: { subtype?: unknown; approxLocation?: unknown } | null;
  kind?: string | null;
}

export interface ProjectKey {
  /** address, trade and state, joined: equal keys are candidates; the window and place tests decide. */
  key: string;
  /** Exact position, or null when the record's position is a stand-in. */
  lat: number | null;
  lon: number | null;
  city: string | null;
}

const isPermit = (r: ProjectRecord) => r.kind === 'permit' || (typeof r.data?.subtype === 'string' && r.data.subtype === 'permit');

/**
 * The key of a building permit, or null when it has no street address in its summary, no trade tag or is not a permit (then the record is
 * never linked to another). The trade is the sorted tag set, so "New home and plumbing" never joins a plain "Plumbing" permit.
 */
export function projectKeyOf(r: ProjectRecord): ProjectKey | null {
  if (!isPermit(r)) return null;
  const cats = [...new Set((r.categories ?? []).filter((c) => typeof c === 'string' && c))].sort();
  if (cats.length === 0) return null;
  const addr = normalizeAddress(siteAddressFromSummary(r.summary ?? null)?.address ?? null);
  if (!addr) return null;
  const state = (r.state ?? '').toUpperCase();
  const exact = r.data?.approxLocation !== true && typeof r.lat === 'number' && typeof r.lon === 'number' && Number.isFinite(r.lat) && Number.isFinite(r.lon);
  return {
    key: `${state}|${addr}|${cats.join(',')}`,
    lat: exact ? (r.lat as number) : null,
    lon: exact ? (r.lon as number) : null,
    city: r.city ? r.city.trim().toLowerCase() : null,
  };
}

/** What a stored link holds about the earlier record. */
export interface ProjectLinkLite {
  key: string;
  source: string;
  externalId: string;
  occurredAt: string;
  lat: number | null;
  lon: number | null;
  city: string | null;
}

/** The two keys are one project: window and place tests on top of an equal key. Order of the arguments does not matter. */
export function sameProject(a: Pick<ProjectKey, 'key' | 'lat' | 'lon' | 'city'> & { occurredAt: string }, b: ProjectLinkLite): boolean {
  if (a.key !== b.key) return false;
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  if (Math.abs(ta - tb) > PROJECT_WINDOW_DAYS * 86_400_000) return false;
  if (a.lat !== null && a.lon !== null && b.lat !== null && b.lon !== null) return haversineMi(a.lat, a.lon, b.lat, b.lon) <= SAME_SITE_MI;
  // A stand-in position (county seat) or none: the same city text is the place test.
  return !!a.city && a.city === b.city;
}

export type Relation = 'duplicate' | 'corroboration';

/** The family of a source (itself unless it is in a mirror group). */
export function sourceFamily(source: string, groups: readonly (readonly string[])[] = MIRROR_GROUPS): string {
  const g = groups.find((x) => x.includes(source));
  return g ? `family:${[...g].sort().join('+')}` : source;
}

/** How a second record relates to the first: the same source or a mirror is a duplicate, any other source corroborates. */
export function relationOf(sourceA: string, sourceB: string, groups: readonly (readonly string[])[] = MIRROR_GROUPS): Relation {
  return sourceFamily(sourceA, groups) === sourceFamily(sourceB, groups) ? 'duplicate' : 'corroboration';
}
