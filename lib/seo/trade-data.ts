import { cacheLife, cacheTag } from 'next/cache';
import { publicClient } from './client';
import { safeUrl } from './summarize';
import { WINDOW_DAYS } from './threshold';
import { UPCOMING_DAYS, orderLatest } from '@/lib/time';
import { PROBATION_COLUMN } from '@/lib/signals/probation';
import { REQUEST_CACHE_LIFE, REQUEST_CACHE_TAG, hasRequestRows, liveRequestsFilter, withoutEndedRequests } from '@/lib/signals/request-visibility';

const DAY = 86_400_000;
export const TRADE_LIST_LIMIT = 10;
/** Upcoming items (events that have not started) that may lead the list. */
export const TRADE_UPCOMING_LIMIT = 3;
/** A trade page stays noindex until its live list has at least this many items. */
export const TRADE_INDEX_MIN_ITEMS = 5;

export interface TradeSignalItem {
  id: number;
  source: string;
  kind: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  occurredAt: string;
}

export interface TradeSignals {
  ok: boolean;
  trade: string;
  asOf: string;
  items: TradeSignalItem[];
}

interface Row {
  id: number;
  source: string;
  kind: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  occurred_at: string;
  expires_at?: string | null;
}

/**
 * Pure: the list a trade page shows. Up to TRADE_UPCOMING_LIMIT upcoming items first (soonest first), then everything else
 * newest first, TRADE_LIST_LIMIT in all. A far-future item cannot hold the top: the database only reads UPCOMING_DAYS ahead.
 */
export function orderTradeItems(items: TradeSignalItem[], now: number = Date.now()): TradeSignalItem[] {
  return orderLatest(items, (i) => i.occurredAt, now, { maxUpcoming: TRADE_UPCOMING_LIMIT }).slice(0, TRADE_LIST_LIMIT);
}

/** Pure: raw rows to page items (safe URLs only). */
export function toTradeItems(rows: Row[]): TradeSignalItem[] {
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    kind: r.kind,
    title: r.title,
    url: safeUrl(r.url),
    city: r.city,
    state: r.state,
    occurredAt: r.occurred_at,
  }));
}

export function isTradeIndexable(itemCount: number): boolean {
  return itemCount >= TRADE_INDEX_MIN_ITEMS;
}

/**
 * Latest national signals tagged with a trade: anon client, holler_signals only, `categories` contains
 * the trade id, newest first, last 60 days, 10 rows, plus up to 3 events that start in the next 14 days (listed first, soonest first). Two small indexed queries (gin on categories) per trade,
 * so at most one key per CategoryId. Cached 6 hours; failures are cached for 60 s. Ended resident requests are left out (query and
 * rows), and a list that holds a live request is cached 15 minutes only.
 */
export async function loadTradeSignals(trade: string): Promise<TradeSignals> {
  'use cache';
  const nowIso = new Date().toISOString();
  const sb = publicClient();
  if (!sb) {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, trade, asOf: nowIso, items: [] };
  }
  try {
    const nowMs = Date.now();
    const base = () => sb.from('holler_signals').select('id,source,kind,title,url,city,state,occurred_at,expires_at').contains('categories', [trade]).or(liveRequestsFilter(nowIso)).is(PROBATION_COLUMN, null);
    const [recent, upcoming] = await Promise.all([
      base()
        .gte('occurred_at', new Date(nowMs - WINDOW_DAYS * DAY).toISOString())
        .lte('occurred_at', nowIso)
        .order('occurred_at', { ascending: false })
        .limit(TRADE_LIST_LIMIT)
        .abortSignal(AbortSignal.timeout(10_000)),
      base()
        .gt('occurred_at', nowIso)
        .lte('occurred_at', new Date(nowMs + UPCOMING_DAYS * DAY).toISOString())
        .order('occurred_at', { ascending: true })
        .limit(TRADE_UPCOMING_LIMIT)
        .abortSignal(AbortSignal.timeout(10_000)),
    ]);
    if (recent.error) throw new Error(recent.error.message);
    const rows = withoutEndedRequests([...((upcoming.error ? [] : upcoming.data) ?? []), ...(recent.data ?? [])] as unknown as Row[], nowMs);
    // A live resident request in the list: tag the entry and keep it 15 minutes at most (see REQUEST_CACHE_LIFE).
    if (hasRequestRows(rows)) cacheTag(REQUEST_CACHE_TAG);
    cacheLife(
      hasRequestRows(rows)
        ? REQUEST_CACHE_LIFE
        : { stale: 300, revalidate: 21600, expire: 86400 },
    );
    return { ok: true, trade, asOf: nowIso, items: orderTradeItems(toTradeItems(rows), nowMs) };
  } catch (e) {
    console.error('[seo] loadTradeSignals failed:', trade, e instanceof Error ? e.message : 'unknown');
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, trade, asOf: nowIso, items: [] };
  }
}
