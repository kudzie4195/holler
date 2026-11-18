import citiesJson from '../geo/cities.json';
import { CATEGORIES } from '../signals/categories';
import { GUIDE_SLUGS } from './guides';
import { parseWeek } from './week';

/**
 * Pure 404 decision for public SEO paths, used by proxy.ts so an unknown slug returns HTTP 404 on the
 * first request (under cache components the page itself streams a 200 shell before notFound() runs).
 * It imports the generated cities JSON directly, not lib/geo, so the proxy bundle stays small
 * (lib/geo pulls in the whole ZIP database).
 */
interface CityRow {
  slug: string;
  state: string;
  stateName: string;
}

const stateSlugOf = (stateName: string) => stateName.toLowerCase().replace(/\s+/g, '-');

const CITY_STATE: Map<string, string> = new Map();
const STATE_SLUGS: Set<string> = new Set();
for (const c of citiesJson as CityRow[]) {
  const st = stateSlugOf(c.stateName);
  CITY_STATE.set(c.slug, st);
  STATE_SLUGS.add(st);
}

export type RouteDecision = 'ok' | 'not-found' | 'skip';

function segments(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  return parts.map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
}

/** A storm report slug: name parts then a real calendar date, as built by lib/storms/report.ts (county, city-of-<city> and <state>-fema forms). */
const STORM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*-(\d{4})-(\d{2})-(\d{2})$/;

function validStormSlug(slug: string): boolean {
  if (slug.length > 120) return false;
  const m = STORM_SLUG.exec(slug);
  if (!m) return false;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * 'skip' for paths this check does not own, 'ok' for a known page, 'not-found' for an unknown slug.
 * Trade ids are read from CATEGORIES at call time; guide slugs from lib/seo/guides (GUIDE_SLUGS). A weekly page /local/<state>/<city>/week/<YYYY-MM-DD> is 'ok' only for a
 * Monday inside the current week and the 11 before it, judged at `nowMs` (see lib/seo/week.ts).
 */
export function decidePublicRoute(pathname: string, nowMs: number = Date.now()): RouteDecision {
  const [root, a, b, ...rest] = segments(pathname);
  if (root === 'local') {
    if (a === undefined) return 'ok';
    if (!STATE_SLUGS.has(a)) return 'not-found';
    if (b === undefined) return 'ok';
    if (CITY_STATE.get(b) !== a) return 'not-found';
    if (rest.length === 0) return 'ok';
    if (rest.length === 2 && rest[0] === 'week') return parseWeek(rest[1], nowMs).ok ? 'ok' : 'not-found';
    return 'not-found';
  }
  if (root === 'storms') {
    // /storms and /storms/<state>/<slug> only. A known state with a well-formed slug is 'ok' here; whether records exist is the page's call.
    if (a === undefined) return 'ok';
    if (b === undefined || rest.length > 0) return 'not-found';
    return STATE_SLUGS.has(a) && validStormSlug(b) ? 'ok' : 'not-found';
  }
  if (root === 'for') {
    if (a === undefined) return 'ok';
    if (b !== undefined) return 'not-found';
    return CATEGORIES.some((c) => c.id === a) ? 'ok' : 'not-found';
  }
  if (root === 'guides') {
    if (a === undefined) return 'ok';
    if (b !== undefined) return 'not-found';
    return GUIDE_SLUGS.includes(a) ? 'ok' : 'not-found';
  }
  return 'skip';
}
