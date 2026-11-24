import { loadPlaceCounts } from '@/lib/seo/data';
import type { Lang } from '@/lib/i18n';
import { checkCityLink, nearestCityWithRecords } from './reads';

/**
 * R25 check fix (review R25CHECK P2-5): the free city records link for a limited answer, to the nearest city within 25 miles that has
 * records (lib/check/reads.ts nearestCityWithRecords on lib/seo/data.ts loadPlaceCounts, cached 6 hours). No link when no such city is
 * near, or when the counts cannot be read: an unverified link could open an empty page.
 */
export async function checkCityLinkWithRecords(place: { lat: number; lon: number }, lang: Lang): Promise<{ href: string; label: string } | null> {
  try {
    const pc = await loadPlaceCounts();
    if (!pc.ok) return null;
    return checkCityLink(nearestCityWithRecords(place.lat, place.lon, pc.counts), lang);
  } catch {
    return null;
  }
}
