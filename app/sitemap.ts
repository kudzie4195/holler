import type { MetadataRoute } from 'next';
import { buildSitemapEntries } from '@/lib/seo/sitemap-entries';

// Lists home, /check, /about, /for, /local, state pages, trade pages with 5+ live items, and only the city
// pages that meet the index threshold (5+ signals in 60 days). City lastModified comes from holler_place_counts.latest_at
// and is omitted when unknown. If the database is unreachable only the static and state pages are listed.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries();
}
