import citiesJson from '../geo/cities.json';
import { CATEGORIES } from '../signals/categories';
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

/**
 * 'skip' for paths this check does not own, 'ok' for a known page, 'not-found' for an unknown slug.
 * Trade ids are read from CATEGORIES at call time. A weekly page /local/<state>/<city>/week/<YYYY-MM-DD> is 'ok' only for a
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
  if (root === 'for') {
    if (a === undefined) return 'ok';
    if (b !== undefined) return 'not-found';
    return CATEGORIES.some((c) => c.id === a) ? 'ok' : 'not-found';
  }
  return 'skip';
}
