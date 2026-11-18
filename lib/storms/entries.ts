import { cacheLife } from 'next/cache';
import { absoluteUrl } from '@/lib/seo/canonical';
import { loadStormIndex, qualifyingReports } from './data';
import { reportPath, type StormReport } from './report';
import { MIN_INDEX_REPORTS } from './threshold';

export interface StormSitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency: 'daily' | 'weekly';
  priority: number;
}

/**
 * Pure: the sitemap rows for a list of reports. Only qualifying reports are listed, and /storms itself only when the index has
 * enough pages to be indexable. lastModified is the newest created_at of the records, or left out when unknown (never the build time).
 */
export function buildStormEntries(reports: readonly StormReport[]): StormSitemapEntry[] {
  const list = reports.filter((r) => r.qualifies);
  if (list.length === 0) return [];
  const latest = list.map((r) => (r.modifiedAt ? Date.parse(r.modifiedAt) : NaN)).filter(Number.isFinite);
  const index: StormSitemapEntry = { url: absoluteUrl('/storms'), changeFrequency: 'daily', priority: 0.6 };
  if (latest.length) index.lastModified = new Date(Math.max(...latest));
  const listIndex = list.length >= MIN_INDEX_REPORTS;
  const pages = list.map((r) => {
    const e: StormSitemapEntry = { url: absoluteUrl(reportPath(r)), changeFrequency: 'weekly', priority: 0.5 };
    if (r.modifiedAt) e.lastModified = new Date(r.modifiedAt);
    return e;
  });
  return listIndex ? [index, ...pages] : pages;
}

export async function loadStormSitemapEntries(): Promise<StormSitemapEntry[]> {
  'use cache';
  const data = await loadStormIndex();
  cacheLife(data.ok ? { stale: 300, revalidate: 1800, expire: 86400 } : { stale: 30, revalidate: 60, expire: 300 });
  return buildStormEntries(qualifyingReports(data));
}
