import { cacheLife } from 'next/cache';
import { publicClient } from '@/lib/seo/client';
import { cityBySlug } from '@/lib/geo';
import { UPCOMING_DAYS } from '@/lib/time';
import { nearbySlugs } from './scope';
import type { CheckItem } from './group';

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const ROW_LIMIT = 60;
/** Rows that have not started yet (events, event permits). Read separately so they cannot crowd out the recent records. */
const UPCOMING_LIMIT = 12;
const QUERY_TIMEOUT_MS: number = 8000;
const COLUMNS = 'id,source,kind,title,url,city,state,severity,occurred_at';

export interface CheckData {
  /** false when the database could not be read (env missing, timeout, error). Render the empty state. */
  ok: boolean;
  items: CheckItem[];
  /** ISO time this entry was built (at most one hour old). */
  checkedAt: string;
}

interface Row {
  id: number;
  source: string;
  kind: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  severity: number;
  occurred_at: string;
}

/**
 * Recent holler_signals for one trade near one city. Cached for an hour and keyed on
 * (citySlug or state, trade), never on the raw ZIP, so the shared database sees a bounded number of queries.
 * One indexed query: nearby city slugs OR state-level (no coordinates) signals at severity >= 2.
 */
export async function loadCheck(citySlug: string | null, state: string, trade: string): Promise<CheckData> {
  'use cache';
  const now = new Date();
  const checkedAt = now.toISOString();
  // A failed read is cached for a minute only, so a blip does not pin an empty page for an hour.
  const fail = (): CheckData => {
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return { ok: false, items: [], checkedAt };
  };

  const sb = publicClient();
  if (!sb || !/^[A-Z]{2}$/.test(state) || !/^[a-z0-9-]{1,40}$/.test(trade)) return fail();
  try {
    const city = citySlug ? cityBySlug(citySlug) : undefined;
    const slugs = city ? nearbySlugs(city).filter((s) => /^[a-z0-9-]+$/.test(s)) : [];
    const stateLevel = `and(lat.is.null,state.eq.${state},severity.gte.2)`;
    const scope = slugs.length ? `place_slug.in.(${slugs.join(',')}),${stateLevel}` : stateLevel;

    const base = () =>
      sb
        .from('holler_signals')
        .select(COLUMNS)
        .or(scope)
        .or(`expires_at.is.null,expires_at.gt.${checkedAt}`)
        .overlaps('categories', [trade]);
    // Two small indexed queries on the same key: what already happened (newest first) and what starts in the next
    // UPCOMING_DAYS (soonest first). One combined newest-first query would let far-future events fill the row limit.
    const [recent, upcoming] = await Promise.all([
      base()
        .gte('occurred_at', new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString())
        .lte('occurred_at', checkedAt)
        .order('occurred_at', { ascending: false })
        .limit(ROW_LIMIT)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
      base()
        .gt('occurred_at', checkedAt)
        .lte('occurred_at', new Date(now.getTime() + UPCOMING_DAYS * DAY).toISOString())
        .order('occurred_at', { ascending: true })
        .limit(UPCOMING_LIMIT)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
    ]);
    if (recent.error) return fail();
    // A failed upcoming read only drops the upcoming rows.
    const data = [...((upcoming.error ? [] : upcoming.data) ?? []), ...(recent.data ?? [])];

    const items: CheckItem[] = (data as unknown as Row[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      title: r.title,
      url: r.url,
      place: [r.city, r.state].filter(Boolean).join(', ') || null,
      occurredAt: r.occurred_at,
      severity: r.severity,
    }));
    cacheLife({ stale: 300, revalidate: 3600, expire: 7200 });
    return { ok: true, items, checkedAt };
  } catch {
    return fail();
  }
}
