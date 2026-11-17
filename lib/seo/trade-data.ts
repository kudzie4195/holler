import { cacheLife } from 'next/cache';
import { publicClient } from './client';
import { safeUrl } from './summarize';
import { WINDOW_DAYS } from './threshold';

const DAY = 86_400_000;
export const TRADE_LIST_LIMIT = 10;
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
 * the trade id, newest first, last 60 days, 10 rows. One indexed query (gin on categories) per trade,
 * so at most one key per CategoryId. Cached 6 hours; failures are cached for 60 s.
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
    const since = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();
    const { data, error } = await sb
      .from('holler_signals')
      .select('id,source,kind,title,url,city,state,occurred_at')
      .contains('categories', [trade])
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(TRADE_LIST_LIMIT)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message);
    cacheLife({ stale: 300, revalidate: 21600, expire: 86400 });
    return { ok: true, trade, asOf: nowIso, items: toTradeItems((data ?? []) as unknown as Row[]) };
  } catch {
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    return { ok: false, trade, asOf: nowIso, items: [] };
  }
}
