import { placeCoverage, type CoverageState } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { citiesInState, cityBySlug, lookupPlaceByName } from '@/lib/geo';
import { slugify, type StormReport } from './report';

/**
 * Round 24 FIX2 (review D3): the coverage answer for a storm page, from the one coverage function (placeCoverage over coverageFor with
 * isServedZip), as the city pages use it. The report rows carry town and county names, no coordinates, so the page is placed by name:
 *   city report: the city's own name and every town the records name; the best answer among those points.
 *   county report: only the towns the records name (the first part of each record's place). Round 24 FIX3 (review-FIX2 F3): the
 *   county's own name is never tried as a town ("Decatur County", GA is not the city of Decatur; "Austin County", TX is not Austin).
 *   FEMA (statewide) report: the best answer among the state's cities, the same answer the state page uses (stateCoverage).
 * A report with no place that can be found is waitlist: a page never offers a price where nothing was answered.
 */
const ORDER: Record<CoverageState, number> = { live: 0, limited: 1, waitlist: 2 };
const best = (a: CoverageState, b: CoverageState): CoverageState => (ORDER[a] <= ORDER[b] ? a : b);

function pointFor(name: string, state: string): { lat: number; lon: number; state: string } | null {
  const clean = name.replace(/\s+(county|parish|borough|city|municipality)$/i, '').trim();
  if (!clean) return null;
  const c = cityBySlug(`${slugify(clean)}-${state.toLowerCase()}`);
  if (c) return { lat: c.lat, lon: c.lon, state: c.state };
  const z = lookupPlaceByName(clean, state);
  return z ? { lat: z.lat, lon: z.lon, state: z.state } : null;
}

/** The answer for a state: the best answer any of its cities gets (waitlist when it has none). */
export function stateCoverage(state: string): CoverageState {
  let out: CoverageState = 'waitlist';
  for (const c of citiesInState(state)) {
    out = best(out, placeCoverage(c, isServedZip({ lat: c.lat, lon: c.lon, state: c.state })).state);
    if (out === 'live') break;
  }
  return out;
}

export function stormReportCoverage(r: Pick<StormReport, 'kind' | 'state' | 'name' | 'records'>): CoverageState {
  if (r.kind === 'state') return stateCoverage(r.state);
  const names = new Set<string>();
  if (r.kind === 'county') {
    const own = slugify(r.name);
    for (const rec of r.records) {
      const town = rec.place.split(',')[0]?.trim() ?? '';
      if (town && slugify(town) !== own) names.add(town);
    }
  } else {
    names.add(r.name);
    for (const rec of r.records) for (const part of rec.place.split(',')) if (part.trim()) names.add(part.trim());
  }
  let out: CoverageState = 'waitlist';
  for (const n of names) {
    const p = pointFor(n, r.state);
    if (!p) continue;
    out = best(out, placeCoverage(p, isServedZip(p)).state);
    if (out === 'live') break;
  }
  return out;
}
