import { CITIES } from '../geo';
import { isIndexable } from './threshold';

/** With no usable DB counts, fall back to the biggest cities so the sitemap never fails or goes empty. */
export const FALLBACK_CITY_COUNT = 200;

/** Pure selection of indexable city slugs for the sitemap. */
export function selectIndexableCities(
  counts: { ok: boolean; counts: Record<string, number> },
  cities = CITIES,
): { slugs: string[]; usedFallback: boolean } {
  if (!counts.ok) return { slugs: cities.slice(0, FALLBACK_CITY_COUNT).map((c) => c.slug), usedFallback: true };
  return { slugs: cities.filter((c) => isIndexable(counts.counts[c.slug] ?? 0)).map((c) => c.slug), usedFallback: false };
}
