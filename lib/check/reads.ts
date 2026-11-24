import { sourceLabel } from '@/components/signal-meta';
import { cityPath, type City } from '@/lib/geo';
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
 * The Spanish source labels keep a county's English name ("Datos abiertos de Cobb County: ..."). In this list, read as Spanish prose, the
 * county is written the Spanish way ("Datos abiertos del condado de Cobb: ..."). English is unchanged.
 */
function countyInLang(label: string, lang: Lang): string {
  if (lang === 'en') return label;
  return label.replace(/ de ([^:]+?) County:/, (_m, county: string) => ` ${t(lang, 'chk.reads_county', { county })}:`);
}
