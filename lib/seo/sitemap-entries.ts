import { cacheLife } from 'next/cache';
import { CITIES, STATES, cityPath, citiesInState } from '@/lib/geo';
import { absoluteUrl } from './canonical';
import { loadPlaceCounts } from './data';
import { selectIndexableCities } from './select';

export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

export async function buildSitemapEntries(): Promise<SitemapEntry[]> {
  'use cache';
  cacheLife({ stale: 300, revalidate: 21600, expire: 86400 });
  const now = new Date();
  const pc = await loadPlaceCounts();
  const { slugs } = selectIndexableCities(pc);
  const bySlug = new Map(CITIES.map((c) => [c.slug, c]));

  const entries: SitemapEntry[] = [
    { url: absoluteUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/about'), lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: absoluteUrl('/local'), lastModified: now, changeFrequency: 'daily', priority: 0.8 },
  ];
  for (const s of STATES) {
    if (citiesInState(s.code).length === 0) continue;
    entries.push({ url: absoluteUrl(`/local/${s.slug}`), lastModified: now, changeFrequency: 'daily', priority: 0.7 });
  }
  for (const slug of slugs) {
    const c = bySlug.get(slug);
    if (!c) continue;
    entries.push({ url: absoluteUrl(cityPath(c)), lastModified: now, changeFrequency: 'daily', priority: 0.6 });
  }
  return entries;
}
