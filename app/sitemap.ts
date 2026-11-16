import type { MetadataRoute } from 'next';
import { buildSitemapEntries } from '@/lib/seo/sitemap-entries';

// Lists home, /about, /local, state pages, and only the city pages that meet the index threshold
// (5+ signals in 60 days). If the database is unreachable it falls back to the 200 biggest cities.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries();
}
