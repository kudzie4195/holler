import { cacheLife } from 'next/cache';
import type { Db } from '@/lib/dataforseo/client';
import { LOCATION_CODE, buildKeywordPlan, type PlannedCity } from '@/lib/dataforseo/volume';

/**
 * Sitemap priority from stored search volume (holler_keyword_volume), 0.3 to 0.9.
 *
 * A city's score is the sum of the monthly volumes of its "<trade> <city>" keywords. Cities with a score above zero are ranked
 * against each other: priority = 0.35 + 0.55 * (rank / count), so the biggest is 0.9 and the smallest scored city is just above
 * 0.35. A city whose keywords were all fetched and came back empty gets the floor, 0.3. A city with no stored rows, or any path
 * that is not a city page, keeps its current fixed value (FALLBACK_PRIORITY = 0.6, the city value in lib/seo/sitemap-entries.ts).
 * The month used is the newest one with at least 95 percent of the planned keywords stored ("complete"); if none is, the newest
 * month is used as partial and only cities with a positive score are ranked, everyone else keeps the fallback.
 *
 * Search engines treat sitemap priority as a hint at best (Google ignores it), so this is cheap tidiness, not a ranking lever.
 */

export const FALLBACK_PRIORITY = 0.6;
export const MIN_PRIORITY = 0.3;
export const MAX_PRIORITY = 0.9;
const COMPLETE_SHARE = 0.95;

export interface PriorityIndex {
  month: string;
  complete: boolean;
  /** city slug to priority */
  byCity: Record<string, number>;
}

let current: PriorityIndex | null = null;

const clamp = (n: number) => Math.min(MAX_PRIORITY, Math.max(MIN_PRIORITY, Math.round(n * 100) / 100));

/** City slug from /local/<state>/<city>, or null for any other path (state pages, weekly pages, trade pages, and so on). */
export function citySlugFromPath(path: string): string | null {
  const m = /^\/local\/[^/]+\/([^/]+)\/?$/.exec(path.split('?')[0].split('#')[0]);
  return m ? m[1] : null;
}

/**
 * Priority for a path. Uses the index loaded by withVolumePriority / setPriorityIndex; with none, or no volume for this path,
 * returns `fallback`. Always inside 0.3 to 0.9 for a volume based value; a fallback is returned as given.
 */
export function pagePriority(path: string, fallback: number = FALLBACK_PRIORITY, index: PriorityIndex | null = current): number {
  const slug = citySlugFromPath(path);
  if (!slug || !index) return fallback;
  const p = index.byCity[slug];
  return typeof p === 'number' && Number.isFinite(p) ? clamp(p) : fallback;
}

export function setPriorityIndex(idx: PriorityIndex | null): void {
  current = idx;
}

/** Pure: build the index from per-keyword volumes. */
export function buildPriorityIndex(input: { month: string; complete: boolean; volumes: ReadonlyMap<string, number>; plan: PlannedCity[] }): PriorityIndex {
  const { month, complete, volumes, plan } = input;
  const totals: { slug: string; total: number }[] = plan.map((c) => ({ slug: c.slug, total: c.keywords.reduce((n, k) => n + (volumes.get(k.keyword) ?? 0), 0) }));
  const positive = totals.filter((t) => t.total > 0).sort((a, b) => a.total - b.total);
  const byCity: Record<string, number> = {};
  if (complete) for (const t of totals) byCity[t.slug] = MIN_PRIORITY;
  // Rank with ties sharing the highest rank of their group, so equal volume means equal priority.
  let i = 0;
  while (i < positive.length) {
    let j = i;
    while (j + 1 < positive.length && positive[j + 1].total === positive[i].total) j++;
    const p = clamp(0.35 + 0.55 * ((j + 1) / positive.length));
    for (let k = i; k <= j; k++) byCity[positive[k].slug] = p;
    i = j + 1;
  }
  return { month, complete, byCity };
}

/** Read the stored volumes and build the index. Uncached and injectable; null when there is nothing usable. Never throws. */
export async function computePriorityIndex(sb: Db, plan: PlannedCity[] = buildKeywordPlan()): Promise<PriorityIndex | null> {
  try {
    const planned = plan.reduce((n, c) => n + c.keywords.length, 0);
    if (!planned) return null;
    const newest = await sb.from('holler_keyword_volume').select('month').eq('location_code', LOCATION_CODE).order('month', { ascending: false }).limit(1);
    if (newest.error || !newest.data?.length) return null;
    const newestMonth = String((newest.data[0] as { month: string }).month);

    const countFor = async (month: string): Promise<number> => {
      const r = await sb.from('holler_keyword_volume').select('keyword', { count: 'exact', head: true }).eq('month', month).eq('location_code', LOCATION_CODE);
      return r.error ? 0 : (r.count ?? 0);
    };
    let month = newestMonth;
    let complete = (await countFor(newestMonth)) >= planned * COMPLETE_SHARE;
    if (!complete) {
      const prev = await sb.from('holler_keyword_volume').select('month').eq('location_code', LOCATION_CODE).lt('month', newestMonth).order('month', { ascending: false }).limit(1);
      const pm = prev.data?.[0] ? String((prev.data[0] as { month: string }).month) : null;
      if (pm && (await countFor(pm)) >= planned * COMPLETE_SHARE) {
        month = pm;
        complete = true;
      }
    }

    const volumes = new Map<string, number>();
    for (let page = 0; page < 60; page++) {
      const { data, error } = await sb
        .from('holler_keyword_volume')
        .select('keyword,volume')
        .eq('month', month)
        .eq('location_code', LOCATION_CODE)
        .gt('volume', 0)
        .order('keyword', { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) return null;
      const rows = (data ?? []) as { keyword: string; volume: number }[];
      for (const r of rows) volumes.set(r.keyword, Number(r.volume) || 0);
      if (rows.length < 1000) break;
    }
    return buildPriorityIndex({ month, complete, volumes, plan });
  } catch {
    return null;
  }
}

/** Cached for 12 hours (the data changes monthly); a failed read is remembered for 5 minutes. */
export async function loadPriorityIndex(): Promise<PriorityIndex | null> {
  'use cache';
  let idx: PriorityIndex | null = null;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    idx = await computePriorityIndex(createAdminClient());
  } catch {
    idx = null;
  }
  cacheLife(idx ? { stale: 300, revalidate: 43200, expire: 172800 } : { stale: 60, revalidate: 300, expire: 600 });
  return idx;
}

/** Sitemap helper: same entries, city page priorities replaced by volume based ones where volume exists. Never throws. */
export async function withVolumePriority<T extends { url: string; priority: number }>(entries: T[]): Promise<T[]> {
  let idx: PriorityIndex | null = null;
  try {
    idx = await loadPriorityIndex();
  } catch {
    idx = null;
  }
  setPriorityIndex(idx);
  if (!idx) return entries;
  return entries.map((e) => {
    let path = '';
    try {
      path = new URL(e.url).pathname;
    } catch {
      return e;
    }
    return { ...e, priority: pagePriority(path, e.priority, idx) };
  });
}
