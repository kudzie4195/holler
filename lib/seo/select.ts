import { CITIES } from '../geo';
import { isIndexable } from './threshold';

/**
 * Pure selection of indexable city slugs for the sitemap. With no usable DB counts nothing is listed
 * (city pages render noindex without data, so listing them would be wrong); state pages are still listed.
 */
export function selectIndexableCities(
  counts: { ok: boolean; counts: Record<string, number> },
  cities = CITIES,
): { slugs: string[]; usedFallback: boolean } {
  if (!counts.ok) return { slugs: [], usedFallback: true };
  return { slugs: cities.filter((c) => isIndexable(counts.counts[c.slug] ?? 0)).map((c) => c.slug), usedFallback: false };
}
