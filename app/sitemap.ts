import type { MetadataRoute } from 'next';
import { buildSitemapEntries } from '@/lib/seo/sitemap-entries';
import { withVolumePriority } from '@/lib/seo/priority';
import { loadStormSitemapEntries } from '@/lib/storms/entries';

// Lists home, /check, /about, /for, /local, /guides and each guide, /faq, /data, /pricing, /request, /delete-account, state pages, trade pages with 5+ live items, and only the city
// pages that meet the index threshold (5+ signals in 60 days). City lastModified comes from holler_place_counts.latest_at
// and is omitted when unknown. If the database is unreachable only the static and state pages are listed.
// Storm pages: a county or FEMA storm report with 3+ SPC reports in a day or a FEMA storm declaration, last 60 days; /storms only with 3+ such pages.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [base, storms] = await Promise.all([buildSitemapEntries(), loadStormSitemapEntries().catch(() => [])]);
  return [...(await withVolumePriority(base)), ...storms];
}
