import { cacheLife } from 'next/cache';
import { CITIES, STATES, cityPath, citiesInState } from '@/lib/geo';
import { CATEGORIES } from '@/lib/signals/categories';
import { absoluteUrl } from './canonical';
import { loadPlaceCounts, type PlaceCounts } from './data';
import { selectIndexableCities } from './select';
import { GUIDES, guidePath } from './guides';
import { isTradeIndexable, loadTradeSignals } from './trade-data';
import { tradePath } from './trade-view';
import { newestPast } from '../time';
import { WEEK_INDEX_MIN, mondayOf, isoDay, weekPath } from './week';

export interface SitemapEntry {
  url: string;
  /** Omitted when the real last-change time is unknown. Never the build time. */
  lastModified?: Date;
  changeFrequency: 'daily' | 'weekly' | 'monthly';
  priority: number;
}

export interface TradeLive {
  id: string;
  count: number;
  latestAt: string | null;
}

function toDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

function maxDate(isos: (string | undefined)[]): Date | undefined {
  let best: number | undefined;
  for (const i of isos) {
    const t = i ? Date.parse(i) : NaN;
    if (Number.isFinite(t) && (best === undefined || t > best)) best = t;
  }
  return best === undefined ? undefined : new Date(best);
}

function entry(path: string, changeFrequency: SitemapEntry['changeFrequency'], priority: number, lastModified?: Date): SitemapEntry {
  const e: SitemapEntry = { url: absoluteUrl(path), changeFrequency, priority };
  if (lastModified) e.lastModified = lastModified;
  return e;
}

/**
 * Pure builder. City `lastModified` is the place's `latest_at` from holler_place_counts; with no
 * latest_at (column not migrated yet, or DB down) the field is left out. With the DB down no city pages
 * are listed at all, only state pages. Trade pages are listed only when their live list is long enough to be indexable.
 *
 * Weekly pages (only when `now` is given): holler_place_counts holds the 60 day count and the newest record per place, nothing per week,
 * and one query per city is not allowed. So a city already listed gets its CURRENT week page when the view proves two necessary
 * conditions for the page's own 10 record threshold: 10 or more records in 60 days and a record dated since this Monday. Earlier weeks
 * are not listed (the view cannot say which of them reach 10); they stay reachable from the city and weekly pages, and each page sets
 * its own noindex when its week is thin.
 */
export function buildEntries(input: { places: PlaceCounts; trades: TradeLive[]; now?: number }): SitemapEntry[] {
  const { places, trades, now } = input;
  const { slugs } = selectIndexableCities(places);
  const bySlug = new Map(CITIES.map((c) => [c.slug, c]));

  const entries: SitemapEntry[] = [
    entry('/', 'weekly', 1),
    entry('/check', 'weekly', 0.8),
    entry('/about', 'monthly', 0.5),
    entry('/for', 'weekly', 0.8),
    entry('/local', 'daily', 0.8),
    entry('/guides', 'monthly', 0.7),
    entry('/faq', 'monthly', 0.6),
    entry('/data', 'daily', 0.6),
    entry('/pricing', 'monthly', 0.7),
    entry('/request', 'monthly', 0.5),
    entry('/delete-account', 'monthly', 0.1),
  ];
  // A guide's lastmod is its own reviewed date, a constant in the guide data. The other new pages have no stored change time, so none is given.
  for (const g of GUIDES) entries.push(entry(guidePath(g.slug), 'monthly', 0.7, toDate(g.lastReviewed)));
  for (const s of STATES) {
    const cities = citiesInState(s.code);
    if (cities.length === 0) continue;
    entries.push(entry(`/local/${s.slug}`, 'daily', 0.7, maxDate(cities.map((c) => places.latest[c.slug]))));
  }
  for (const t of trades) {
    if (!isTradeIndexable(t.count)) continue;
    entries.push(entry(tradePath(t.id), 'daily', 0.6, toDate(t.latestAt)));
  }
  for (const slug of slugs) {
    const c = bySlug.get(slug);
    if (!c) continue;
    entries.push(entry(cityPath(c), 'daily', 0.6, toDate(places.latest[slug])));
  }
  if (now !== undefined) {
    const monday = mondayOf(now);
    for (const slug of slugs) {
      const c = bySlug.get(slug);
      const latest = places.latest[slug];
      if (!c || !latest || (places.counts[slug] ?? 0) < WEEK_INDEX_MIN || Date.parse(latest) < monday) continue;
      entries.push(entry(weekPath(cityPath(c), isoDay(monday)), 'daily', 0.5, toDate(latest)));
    }
  }
  return entries;
}

export async function buildSitemapEntries(): Promise<SitemapEntry[]> {
  'use cache';
  const places = await loadPlaceCounts();
  const live = await Promise.all(CATEGORIES.map((c) => loadTradeSignals(c.id)));
  // An explicit outer lifetime wins over the shorter ones inside the loaders, so it is chosen after the reads:
  // a failed read is remembered for a minute, a good one for 6 hours.
  const healthy = places.ok && live.every((l) => l.ok);
  cacheLife(healthy ? { stale: 300, revalidate: 21600, expire: 86400 } : { stale: 60, revalidate: 60, expire: 300 });
  const trades: TradeLive[] = live.map((l) => ({
    id: l.trade,
    count: l.items.length,
    // lastmod must not be in the future: skip events that have not started.
    latestAt: newestPast(l.items.map((i) => i.occurredAt)),
  }));
  return buildEntries({ places, trades, now: Date.now() });
}
