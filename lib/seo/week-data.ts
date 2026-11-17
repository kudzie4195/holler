import { cacheLife } from 'next/cache';
import { publicClient } from './client';
import { SECTIONS, sectionFor, type SectionId } from './sections';
import { safeUrl, type SectionItem, type SignalRowDb } from './summarize';
import { WEEK_MS, isCurrentWeek, parseWeek, weekNeighbors } from './week';

const ROW_COLUMNS = 'id,source,kind,title,summary,url,categories,severity,occurred_at,expires_at,subtype:data->>subtype';
/** Hard limit on the single query. PostgREST would cap one response at 1000 rows anyway. */
export const WEEK_ROW_CAP = 1000;
/** Items listed per section on a weekly page (the city page lists 8). */
export const WEEK_ITEM_LIMIT = 25;
const QUERY_TIMEOUT_MS = 10_000;

export interface WeekData {
  /** false when the date is not inside the 12 week window (the page then 404s). */
  valid: boolean;
  /** false when the database could not be read. */
  ok: boolean;
  slug: string;
  /** Monday, YYYY-MM-DD */
  weekIso: string;
  startMs: number;
  current: boolean;
  /** ISO time the data was computed; pages never call Date themselves (Cache Components). */
  asOf: string;
  /** Records shown across all sections (exact, unless `truncated`). */
  total: number;
  sections: Partial<Record<SectionId, SectionItem[]>>;
  counts: Partial<Record<SectionId, number>>;
  sources: string[];
  /** true when the row cap was hit, so counts are lower bounds. */
  truncated: boolean;
  prev: string | null;
  next: string | null;
}

export function emptyWeekData(slug: string, weekIso: string, startMs: number, asOf: string, flags: { valid: boolean; ok: boolean; current?: boolean; prev?: string | null; next?: string | null }): WeekData {
  return {
    valid: flags.valid,
    ok: flags.ok,
    slug,
    weekIso,
    startMs,
    current: flags.current ?? false,
    asOf,
    total: 0,
    sections: {},
    counts: {},
    sources: [],
    truncated: false,
    prev: flags.prev ?? null,
    next: flags.next ?? null,
  };
}

/**
 * Pure grouping for a weekly page. Same section assignment as the city page (sectionFor and SECTIONS) and the same item shape, but
 * every record of the week counts: a past week has no "active" alerts, so alerts are not filtered by expiry. Newest first, `limit` per section.
 */
export function groupWeekRows(rows: SignalRowDb[], limit: number = WEEK_ITEM_LIMIT): Pick<WeekData, 'sections' | 'counts' | 'sources' | 'total'> {
  const grouped: Partial<Record<SectionId, SectionItem[]>> = {};
  const counts: Partial<Record<SectionId, number>> = {};
  const sources = new Set<string>();
  for (const r of rows) {
    const sec = sectionFor(r.kind, r.source, r.title, r.subtype);
    if (!sec) continue;
    sources.add(r.source);
    counts[sec] = (counts[sec] ?? 0) + 1;
    (grouped[sec] ??= []).push({
      id: r.id,
      source: r.source,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      url: safeUrl(r.url),
      severity: r.severity,
      occurredAt: r.occurred_at,
      expiresAt: r.expires_at,
    });
  }
  const sections: Partial<Record<SectionId, SectionItem[]>> = {};
  let total = 0;
  for (const def of SECTIONS) {
    const items = grouped[def.id];
    if (!items?.length) continue;
    total += items.length;
    const ordered = [...items].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    if (def.id === 'alerts') ordered.sort((a, b) => b.severity - a.severity); // stable: ties keep newest first
    sections[def.id] = ordered.slice(0, limit);
  }
  return { sections, counts, sources: [...sources].sort(), total };
}

/**
 * Everything one weekly page needs: ONE query on holler_signals by place_slug and the week's time range (never past now), newest
 * first, hard limit, anon client. Cached with 'use cache': a day for a finished week, 6 hours for the current week, and a minute
 * when the database cannot be read (the page then shows an empty state, never a 500). A date outside the window returns valid:false.
 */
export async function loadWeekData(slug: string, week: string): Promise<WeekData> {
  'use cache';
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const parsed = parseWeek(week, nowMs);
  if (!parsed.ok) {
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return emptyWeekData(slug, week, NaN, nowIso, { valid: false, ok: false });
  }
  const { startMs, iso } = parsed;
  const current = isCurrentWeek(startMs, nowMs);
  const { prev, next } = weekNeighbors(startMs, nowMs);
  const base = { valid: true, current, prev, next };
  const sb = publicClient();
  if (!sb) {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return emptyWeekData(slug, iso, startMs, nowIso, { ...base, ok: false });
  }
  try {
    const upper = Math.min(startMs + WEEK_MS - 1, nowMs);
    const { data, error, count } = await sb
      .from('holler_signals')
      .select(ROW_COLUMNS, { count: 'exact' })
      .eq('place_slug', slug)
      .gte('occurred_at', new Date(startMs).toISOString())
      .lte('occurred_at', new Date(upper).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(WEEK_ROW_CAP)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as SignalRowDb[];
    cacheLife(current ? { stale: 300, revalidate: 21600, expire: 86400 } : { stale: 3600, revalidate: 86400, expire: 172800 });
    return {
      ...emptyWeekData(slug, iso, startMs, nowIso, { ...base, ok: true }),
      ...groupWeekRows(rows),
      truncated: typeof count === 'number' && count > rows.length,
    };
  } catch (e) {
    console.error('[seo] loadWeekData failed:', slug, week, e instanceof Error ? e.message : 'unknown');
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return emptyWeekData(slug, iso, startMs, nowIso, { ...base, ok: false });
  }
}
