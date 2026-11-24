import { sourceLabel } from '@/components/signal-meta';
import { CITIES, cityPath, haversineMi, type City } from '@/lib/geo';
import { t, type Lang } from '@/lib/i18n';
import { localSourcesNear } from './coverage';
import { CHECK_RADIUS_MI } from './scope';

/**
 * Round 25: "What Holler reads near you" on /check: the enabled local feeds whose centre is within 25 miles of the ZIP
 * (lib/check/coverage.ts localSourcesNear, the same list that decides whether the ZIP is served), by their public source label, once each.
 */
export function checkReads(place: { lat: number; lon: number }, zip: string, lang: Lang): { labels: string[]; note: string } {
  const labels = [...new Set(localSourcesNear(place.lat, place.lon).map((s) => countyInLang(sourceLabel(s.id, lang), lang)))];
  return { labels, note: t(lang, 'chk.reads_note', { mi: CHECK_RADIUS_MI, zip }) };
}

/** Round 25: the free city records page for the ZIP's city (/local/<state>/<city>), offered next to the trial on a limited cell. */
export function checkCityLink(city: Pick<City, 'slug' | 'state' | 'name'> | null, lang: Lang): { href: string; label: string } | null {
  if (!city) return null;
  return { href: cityPath(city), label: t(lang, 'chk.city_link', { city: city.name }) };
}

/**
 * R25 check fix (review R25CHECK P2-5): the nearest city within `maxMi` whose city page has records, by the place counts the city pages
 * themselves read (lib/seo/data.ts loadPlaceCounts, holler_place_counts: records per place_slug in the page's window). A city with no count
 * or a count of 0 opens an empty page ("has nothing on this page yet"), so it is never linked. Null when no such city is near.
 */
export function nearestCityWithRecords(lat: number, lon: number, counts: Readonly<Record<string, number>>, maxMi: number = CHECK_RADIUS_MI): City | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const latWindow = maxMi / 69 + 0.01;
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    if (Math.abs(c.lat - lat) > latWindow) continue;
    if (!((counts[c.slug] ?? 0) > 0)) continue;
    const d = haversineMi(lat, lon, c.lat, c.lon);
    if (d <= maxMi && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * The Spanish source labels keep a county's English name ("Datos abiertos de Cobb County: ..."). In this list, read as Spanish prose, the
 * county is written the Spanish way ("Datos abiertos del condado de Cobb: ..."). English is unchanged.
 */
function countyInLang(label: string, lang: Lang): string {
  if (lang === 'en') return label;
  return label.replace(/ de ([^:]+?) County:/, (_m, county: string) => ` ${t(lang, 'chk.reads_county', { county })}:`);
}
