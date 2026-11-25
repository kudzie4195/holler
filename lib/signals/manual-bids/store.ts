import { normalizeSignals, placeSlugFor } from '@/lib/signals/run';
import { insertNewSignals, type Db } from '@/lib/signals/store';
import { rematchSignals } from '@/lib/signals/rematch';
import { BID_SOURCE_PREFIX } from '@/lib/signals/bid-sources';
import type { Adapter, SignalInput } from '@/lib/signals/types';
import { MANUAL_BID_SOURCE } from './flag';
import { normalizeUrl, titleKeyOf, type ManualBidKeys } from './record';

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
/** Solicitation numbers asked about in one query (each is one ilike term of an or filter). */
const SOL_PER_QUERY = 20;
/** Links asked about in one query (each is one ilike term of an or filter). */
const URL_PER_QUERY = 20;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** A solicitation number without case, spaces or punctuation: "RP-026-26", "rp 026 26" and "RP02626" are one number. */
export const solKeyOf = (s: string): string => norm(s).slice(0, 60);
/** PostgREST like pattern ("*" is the wildcard inside an or filter) matching any spelling of the key: "rp02626" -> "*r*p*0*2*6*2*6*". */
export function solPattern(key: string): string {
  return `*${key.split('').join('*')}*`;
}

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * The stored-side pattern for a link (review 2 P2-D): any stored URL whose text holds the host (with or without "www.") and the path
 * (any case, with or without a trailing slash, any query after it). The rows it returns are then normalized exactly like the typed link
 * (normalizeUrl: tracking parameters, query-name case, "www.", trailing slash) and compared. "*" is the like wildcard inside an or filter;
 * the value is double-quoted so commas and brackets in a path cannot break the filter.
 */
export function urlPattern(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const pat = `*${host}${path}*`.replace(/["\\]/g, '');
    return `"${pat}"`;
  } catch {
    return null;
  }
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
 * guessing. A duplicate is the same external id, the same link with the same title, or the same agency with the same solicitation number.
 */
export async function findExisting(db: Pick<Db, 'from'>, cands: ExistingCandidate[]): Promise<Set<string>> {
  const dupes = new Set<string>();
  if (cands.length === 0) return dupes;

  // 1. Same external id already stored as a manual bid.
  for (const part of chunks(cands.map((c) => c.externalId))) {
    const { data, error } = await db.from('holler_signals').select('external_id, retired:data->>retiredAt').eq('source', MANUAL_BID_SOURCE).in('external_id', part);
    if (error) throw new Error('existing-record read failed');
    for (const r of (data ?? []) as Array<{ external_id?: string | null; retired?: string | null }>) if (r.external_id && !r.retired) dupes.add(r.external_id);
  }

  // 2. Same link AND same title, from any source (review 2 P2-D). A link alone is not one bid: an agency's list page on any portal can
  // carry many. Stored links are matched in any spelling (see urlPattern) and normalized before the compare.
  const byKey = new Map<string, string[]>();
  for (const c of cands) {
    const k = `${c.keys.urlKey}\u0000${c.keys.titleKey}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c.externalId]);
  }
  const patterns = [...new Set(cands.map((c) => urlPattern(c.url)).filter((p): p is string => !!p))];
  for (const part of chunks(patterns, URL_PER_QUERY)) {
    const { data, error } = await db
      .from('holler_signals')
      .select('url, title, retired:data->>retiredAt')
      .or(part.map((p) => `url.ilike.${p}`).join(','));
    if (error) throw new Error('existing-record read failed');
    for (const r of (data ?? []) as Array<{ url: string | null; title: string | null; retired?: string | null }>) {
      // A bid the owner retired never blocks its corrected version (review 3 P1-1).
      if (!r.url || !r.title || r.retired) continue;
      for (const id of byKey.get(`${normalizeUrl(r.url)}\u0000${titleKeyOf(r.title)}`) ?? []) dupes.add(id);
    }
  }

  // 3. Same agency and solicitation number, from any bid source. Numbers are compared without case, spaces or punctuation (review
  // P2-3a: "RP 026-26" and "rp026-26" are the stored "RP-026-26"): the query asks for every number whose letters and digits come in the
  // same order (ilike with a wildcard between characters), then the normalized compare decides exactly.
  const withSol = cands.filter((c) => c.solicitationId && solKeyOf(c.solicitationId).length >= 2);
  const keys = [...new Set(withSol.map((c) => solKeyOf(c.solicitationId as string)))];
  for (const part of chunks(keys, SOL_PER_QUERY)) {
    const { data, error } = await db
      .from('holler_signals')
      .select('source, sol:data->>solicitationId, buyer:data->>buyer, retired:data->>retiredAt')
      .like('source', `${BID_SOURCE_PREFIX}%`)
      .or(part.map((k) => `data->>solicitationId.ilike.${solPattern(k)}`).join(','));
    if (error) throw new Error('existing-record read failed');
    for (const r of (data ?? []) as Array<{ sol: string | null; buyer: string | null; retired?: string | null }>) {
      if (!r.sol || r.retired) continue;
      const key = solKeyOf(r.sol);
      for (const c of withSol) if (solKeyOf(c.solicitationId as string) === key && sameAgency(c.agency, r.buyer ?? '')) dupes.add(c.externalId);
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

export interface ManualBidListing {
  id: number;
  title: string;
  url: string | null;
  buyer: string | null;
  dueDate: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

/** The open hand-added bids, newest first (at most 50). Read only. */
export async function listManualBids(db: Pick<Db, 'from'>, now: Date): Promise<ManualBidListing[]> {
  const { data, error } = await db
    .from('holler_signals')
    .select('id, title, url, created_at, expires_at, buyer:data->>buyer, dueDate:data->>dueDate')
    .eq('source', MANUAL_BID_SOURCE)
    .gt('expires_at', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error('manual bids read failed');
  return ((data ?? []) as Array<{ id: number; title: string; url: string | null; created_at: string | null; expires_at: string | null; buyer: string | null; dueDate: string | null }>).map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    buyer: r.buyer,
    dueDate: r.dueDate,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

export type RetireOutcome = { status: 'retired'; title: string } | { status: 'not_found' } | { status: 'already_closed' };

/**
 * Retires a hand-added bid added by mistake: its expires_at becomes now and data.retiredAt is stamped. Every member-facing reader drops a
 * bid whose expires_at has passed (lib/signals/bid-sources.ts bidHidden: web feed, app feed, e-mail digest, push), so it leaves them at
 * once; its existing matches stay as history. Its external id gets ":retired:<ms>" and every duplicate check skips retired rows, so the
 * corrected bid can be added. Only rows of the manual source can be touched (the filter is on the update itself).
 */
export async function retireManualBid(db: Pick<Db, 'from'>, id: number, now: Date): Promise<RetireOutcome> {
  const { data, error } = await db.from('holler_signals').select('id, title, external_id, expires_at, data').eq('source', MANUAL_BID_SOURCE).eq('id', id).limit(1);
  if (error) throw new Error('manual bid read failed');
  const row = ((data ?? []) as Array<{ id: number; title: string; external_id: string; expires_at: string | null; data: Record<string, unknown> | null }>)[0];
  if (!row) return { status: 'not_found' };
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return { status: 'already_closed' };
  const at = now.toISOString();
  const { error: upErr } = await db
    .from('holler_signals')
    // The id is renamed too, so the corrected bid (same agency and number, same link and title) can be added again: the unique
    // (source, external_id) key and the duplicate check both let it through (review 3 P1-1).
    .update({ expires_at: at, external_id: `${row.external_id}:retired:${now.getTime()}`, data: { ...(row.data ?? {}), retiredAt: at } })
    .eq('source', MANUAL_BID_SOURCE)
    .eq('id', id);
  if (upErr) throw new Error('manual bid retire failed');
  return { status: 'retired', title: row.title };
}
