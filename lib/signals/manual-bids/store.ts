import { normalizeSignals, placeSlugFor } from '@/lib/signals/run';
import { insertNewSignals, type Db } from '@/lib/signals/store';
import { rematchSignals } from '@/lib/signals/rematch';
import { BID_SOURCE_PREFIX } from '@/lib/signals/bid-sources';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { MANUAL_BID_SOURCE } from './flag';
import { normalizeUrl, type ManualBidKeys } from './record';

/**
 * Database side of the hand-added bids (round 33). Two functions:
 *  - findExisting: READ ONLY. Which candidates are already in holler_signals, by link (any source) or by agency and solicitation number
 *    (any bid source). The preview uses only this.
 *  - publishManualBids: the write. The same insert every scan uses (store.ts insertNewSignals: upsert on (source, external_id), do
 *    nothing on conflict), then the same matcher every re-match uses (rematch.ts rematchSignals: matchSignals against every current
 *    profile, plan limits, the per-member cap, the alert log). A new record is less than 3 days old, so its matches are stored
 *    notified = false and the notify and push crons send them like any other new bid.
 */

export interface ExistingCandidate {
  externalId: string;
  url: string;
  keys: ManualBidKeys;
  solicitationId: string | null;
  agency: string;
}

const CHUNK = 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Spellings a stored row's link may have for the same page: as given, with and without a trailing slash and "www.". */
function urlVariants(url: string): string[] {
  const out = new Set<string>([url]);
  try {
    const u = new URL(url);
    const bases = [u.hostname, u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`];
    const path = u.pathname.replace(/\/+$/, '');
    for (const h of bases) for (const p of [path, `${path}/`]) out.add(`https://${h}${p || '/'}${u.search}`);
  } catch {
    /* keep the raw one */
  }
  return [...out];
}

/** Agency names match when one contains the other after normalizing ("Gwinnett County Purchasing" and "Gwinnett County"). */
function sameAgency(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

/**
 * External ids of the candidates already stored. Reads only (selects); throws on a read error so the caller can say so instead of
 * guessing. A list-page link (keys.urlKey null) is never compared by link: many bids share it.
 */
export async function findExisting(db: Pick<Db, 'from'>, cands: ExistingCandidate[]): Promise<Set<string>> {
  const dupes = new Set<string>();
  if (cands.length === 0) return dupes;

  // 1. Same external id already stored as a manual bid.
  for (const part of chunks(cands.map((c) => c.externalId))) {
    const { data, error } = await db.from('holler_signals').select('external_id').eq('source', MANUAL_BID_SOURCE).in('external_id', part);
    if (error) throw new Error('existing-record read failed');
    for (const r of (data ?? []) as Array<{ external_id?: string | null }>) if (r.external_id) dupes.add(r.external_id);
  }

  // 2. Same link, from any source.
  const byUrlKey = new Map<string, string[]>();
  for (const c of cands) if (c.keys.urlKey) byUrlKey.set(c.keys.urlKey, [...(byUrlKey.get(c.keys.urlKey) ?? []), c.externalId]);
  const variants = [...new Set(cands.filter((c) => c.keys.urlKey).flatMap((c) => urlVariants(c.url)))];
  for (const part of chunks(variants)) {
    const { data, error } = await db.from('holler_signals').select('url').in('url', part);
    if (error) throw new Error('existing-record read failed');
    for (const r of (data ?? []) as Array<{ url: string | null }>) {
      if (!r.url) continue;
      for (const id of byUrlKey.get(normalizeUrl(r.url)) ?? []) dupes.add(id);
    }
  }

  // 3. Same agency and solicitation number, from any bid source.
  const withSol = cands.filter((c) => c.solicitationId);
  const sols = [...new Set(withSol.map((c) => c.solicitationId as string))];
  for (const part of chunks(sols)) {
    const { data, error } = await db
      .from('holler_signals')
      .select('source, sol:data->>solicitationId, buyer:data->>buyer')
      .like('source', `${BID_SOURCE_PREFIX}%`)
      .in('data->>solicitationId', part);
    if (error) throw new Error('existing-record read failed');
    for (const r of (data ?? []) as Array<{ sol: string | null; buyer: string | null }>) {
      if (!r.sol) continue;
      for (const c of withSol) if (norm(c.solicitationId as string) === norm(r.sol) && sameAgency(c.agency, r.buyer ?? '')) dupes.add(c.externalId);
    }
  }
  return dupes;
}

/** The shape normalizeSignals needs. Not registered anywhere: no scan ever runs it. */
const MANUAL_SHAPE: Adapter = {
  id: MANUAL_BID_SOURCE,
  label: 'Government bid pages checked by Holler',
  kind: 'contract',
  cadenceMinutes: 0,
  sourceUrl: '/data',
  fetch: async () => [],
};

export interface PublishResult {
  inserted: number;
  matched: number;
  /** Set when matching failed after the insert (the rows are stored; a later re-match can still reach members). */
  error?: string;
}

export async function publishManualBids(db: Db, items: SignalInput[], now: Date): Promise<PublishResult> {
  const signals = normalizeSignals(MANUAL_SHAPE, items, now);
  if (signals.length === 0) return { inserted: 0, matched: 0 };
  const rows = signals.map((s) => ({ ...s, placeSlug: placeSlugFor(s) }));
  const inserted = await insertNewSignals(db, rows, { log: () => {} });
  const ids = inserted.map((r) => r.id).filter((x): x is number => typeof x === 'number');
  if (ids.length === 0) return { inserted: 0, matched: 0 };
  const res = await rematchSignals(db, ids, { now, log: () => {} });
  return { inserted: ids.length, matched: res.created, ...(res.error ? { error: 'matching failed' } : {}) };
}
