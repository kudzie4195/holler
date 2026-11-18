import { cacheLife } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cityBySlug, cityPath } from '@/lib/geo';
import { relativeTime } from '@/lib/time';
import { HOLLER_REQUEST_SOURCE } from '@/lib/signals/request-visibility';
import { publicClient } from './client';
import { loadNationalStats, type NationalStats } from './national-data';

/**
 * The "This week on Holler" band on the home page. Real data only.
 *
 * Numbers come from loadNationalStats (the /data loader, cached for an hour, shared with /data: no new query for them).
 * The recent records are ONE bounded query, cached for about 15 minutes:
 *   holler_signals, newest first, occurred in the last 7 days and not in the future, with a city, not expired
 *   (expires_at null or later than now), never a resident request (source 'holler-request') and never kind 'ask', at most 60 rows.
 * From those rows we keep one per source (the most severe, then the newest) and show the top RECENT_SHOWN, most severe first.
 * Any failure, or nothing to show, returns null and the band is not rendered at all.
 */

const DAY = 86_400_000;
const QUERY_TIMEOUT_MS = 8_000;
export const RECENT_SCAN = 60;
export const RECENT_SHOWN = 3;
const TITLE_MAX = 48;

export interface RecentRecord {
  id: string;
  kind: string;
  subtype: string | null;
  title: string;
  /** "Tulsa, OK" */
  place: string;
  /** City page path when the city has one, else null. */
  path: string | null;
  occurredAt: string;
  /** "2 hr ago", computed when the data was read. */
  ago: string;
}

export interface HomeLive {
  /** Records read and dated in the last 7 days. Always above zero when the band shows. */
  total7: number;
  /** Cities with a record in the last 30 days, or null when the view cannot say. */
  cities30: number | null;
  /** Distinct sources in the newest records sample (a lower bound). Zero hides the figure. */
  sources: number;
  recent: RecentRecord[];
}

interface Row {
  id: string | number;
  source: string | null;
  kind: string;
  title: string | null;
  city: string | null;
  state: string | null;
  place_slug: string | null;
  severity: number | null;
  occurred_at: string;
  expires_at: string | null;
  subtype?: string | null;
}

/** "SAN ANTONIO" -> "San Antonio". Mixed-case names are kept as they are. */
function tidyCity(city: string): string {
  const c = city.trim();
  if (c !== c.toUpperCase()) return c;
  return c.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export function shortTitle(title: string, max = TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:-]+$/, '')}…`;
}

/** Pure: pick varied, safe rows. One per source, severity first, then newest. Re-checks every rule the query applies. */
export function pickRecent(rows: Row[], nowMs: number, n = RECENT_SHOWN): RecentRecord[] {
  const ok = rows.filter((r) => {
    if (!r.source || r.source === HOLLER_REQUEST_SOURCE || r.kind === 'ask') return false;
    if (!r.city || !r.city.trim() || !r.title || !r.title.trim()) return false;
    const t = Date.parse(r.occurred_at);
    if (!Number.isFinite(t) || t > nowMs || t < nowMs - 7 * DAY) return false;
    if (r.expires_at) {
      const e = Date.parse(r.expires_at);
      if (!Number.isFinite(e) || e <= nowMs) return false;
    }
    return true;
  });
  const rank = (a: Row, b: Row) => (b.severity ?? 1) - (a.severity ?? 1) || Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
  const bySource = new Map<string, Row>();
  for (const r of [...ok].sort(rank)) if (!bySource.has(r.source!)) bySource.set(r.source!, r);
  return [...bySource.values()]
    .sort(rank)
    .slice(0, n)
    .map((r) => {
      const city = r.place_slug ? cityBySlug(r.place_slug) : undefined;
      const name = tidyCity(r.city!);
      return {
        id: String(r.id),
        kind: r.kind,
        subtype: r.subtype ?? null,
        title: shortTitle(r.title!),
        place: r.state ? `${name}, ${r.state.toUpperCase()}` : name,
        path: city ? cityPath(city) : null,
        occurredAt: r.occurred_at,
        ago: relativeTime(r.occurred_at, nowMs),
      };
    });
}

/** The one query. Never throws: a failure returns null. Exported for tests. */
export async function buildRecentRecords(sb: SupabaseClient | null, now: Date): Promise<RecentRecord[] | null> {
  if (!sb) return null;
  try {
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - 7 * DAY).toISOString();
    const r = await sb
      .from('holler_signals')
      .select('id,source,kind,title,city,state,place_slug,severity,occurred_at,expires_at,subtype:data->>subtype')
      .neq('source', HOLLER_REQUEST_SOURCE)
      .neq('kind', 'ask')
      .not('city', 'is', null)
      .gte('occurred_at', since)
      .lte('occurred_at', nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('occurred_at', { ascending: false })
      .limit(RECENT_SCAN)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (r.error) throw new Error(r.error.message);
    return pickRecent((r.data ?? []) as unknown as Row[], now.getTime());
  } catch (e) {
    console.error('[seo] buildRecentRecords failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/** Cached about 15 minutes; a failure is remembered for a minute only. */
export async function loadRecentRecords(): Promise<RecentRecord[] | null> {
  'use cache';
  const recent = await buildRecentRecords(publicClient(), new Date());
  cacheLife(recent ? { stale: 300, revalidate: 900, expire: 3600 } : { stale: 60, revalidate: 60, expire: 300 });
  return recent;
}

/** Pure: the band's data, or null when there is nothing true to show. */
export function homeLiveFrom(stats: NationalStats, recent: RecentRecord[] | null): HomeLive | null {
  if (!stats.ok || !(stats.total7 > 0)) return null;
  return {
    total7: stats.total7,
    cities30: stats.citiesActive30 && stats.citiesActive30 > 0 ? stats.citiesActive30 : null,
    sources: stats.sourcesSeen > 0 ? stats.sourcesSeen : 0,
    recent: recent ?? [],
  };
}

// ---- Local preview fixture -------------------------------------------------------------------------------------------------
// FIXTURE DATA, NOT REAL. Used only to look at the band on a machine without database access. It is returned only when
// HOLLER_PREVIEW_FIXTURES is exactly "1" AND the VERCEL variable is not set (Vercel sets VERCEL=1 on every build and runtime),
// so it can never reach a deployed page. tests/seo/home-live.test.ts proves the guard.

export function previewFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOLLER_PREVIEW_FIXTURES === '1' && !env.VERCEL;
}

export const HOME_LIVE_PREVIEW_FIXTURE: HomeLive = {
  total7: 4812,
  cities30: 187,
  sources: 21,
  recent: [
    {
      id: 'fixture-1',
      kind: 'alert',
      subtype: null,
      title: 'Severe Thunderstorm Warning until 6:45 PM (fixture)',
      place: 'Tulsa, OK',
      path: null,
      occurredAt: '2026-11-17T10:00:00.000Z',
      ago: '22 min ago',
    },
    {
      id: 'fixture-2',
      kind: 'report',
      subtype: null,
      title: '1.25 inch hail, 4 miles north of town (fixture)',
      place: 'Amarillo, TX',
      path: null,
      occurredAt: '2026-11-17T07:00:00.000Z',
      ago: '3 hr ago',
    },
    {
      id: 'fixture-3',
      kind: 'permit',
      subtype: 'permit',
      title: 'Permit: tear off and replace roof (fixture)',
      place: 'Chicago, IL',
      path: null,
      occurredAt: '2026-11-16T15:00:00.000Z',
      ago: '1 day ago',
    },
  ],
};

/** What the home page renders. Fixture only behind the local guard; otherwise real data or null. */
export async function loadHomeLive(env: Record<string, string | undefined> = process.env): Promise<HomeLive | null> {
  if (previewFixturesEnabled(env)) return HOME_LIVE_PREVIEW_FIXTURE;
  const [stats, recent] = await Promise.all([loadNationalStats(), loadRecentRecords()]);
  return homeLiveFrom(stats, recent);
}
