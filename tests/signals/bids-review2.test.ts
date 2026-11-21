/**
 * Review E, round 2: a past-due federal (SAM) bid is dropped like a closed city bid (P2-2), and public place counts leave stored city bids
 * out while HOLLER_BIDS_ENABLED is off without touching the database view (P2-1). Inputs are hand-written (assumed). Clock 2026-11-21T22:00:00Z.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { bidHidden, dropHiddenBids, federalBidClosed, withoutHiddenBids } from '@/lib/signals/bid-sources';
import { bidCountsByPlace, minusBids } from '@/lib/seo/bid-counts';

const NOW = Date.parse('2026-11-21T22:00:00Z');

describe('a past-due federal bid is dropped (P2-2)', () => {
  const sam = (expires_at: string | null) => ({ source: 'sam-gov', expires_at });
  it('closed when the response date has passed; open before it; open with no date', () => {
    expect(federalBidClosed(sam('2026-11-20T00:00:00Z'), NOW)).toBe(true);
    expect(federalBidClosed(sam('2026-11-30T00:00:00Z'), NOW)).toBe(false);
    expect(federalBidClosed(sam(null), NOW)).toBe(false);
    expect(federalBidClosed({ source: 'socrata-chicago-permits', expires_at: '2026-01-01T00:00:00Z' }, NOW)).toBe(false);
  });
  it('bidHidden drops it with the city-bids flag on or off (federal bids are not behind the flag), and keeps an open one', () => {
    for (const on of [true, false]) {
      expect(bidHidden(sam('2026-11-20T00:00:00Z'), on, NOW)).toBe(true);
      expect(bidHidden(sam('2026-11-30T00:00:00Z'), on, NOW)).toBe(false);
    }
  });
  it('member matches and public rows lose it, other rows stay', () => {
    const m = [{ signal: sam('2026-11-20T00:00:00Z') }, { signal: sam('2026-12-05T00:00:00Z') }, { signal: { source: 'spc', expires_at: '2026-11-01T00:00:00Z' } }];
    expect(dropHiddenBids(m, false, NOW)).toHaveLength(2);
    expect(withoutHiddenBids([sam('2026-11-20T00:00:00Z'), sam('2026-12-05T00:00:00Z')], NOW, true)).toHaveLength(1);
  });
});

describe('place counts leave stored city bids out while the flag is off (P2-1)', () => {
  const dbWith = (rows: { place_slug: string }[], opts: { noLike?: boolean; error?: boolean } = {}) => ({
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = {};
        if (!opts.noLike) q.like = () => ({ gte: () => ({ limit: async () => (opts.error ? { data: null, error: { message: 'x' } } : { data: rows, error: null }) }) });
        return q;
      },
    }),
  });
  it('counts stored bid rows per place when the flag is off, and nothing when it is on', async () => {
    const db = dbWith([{ place_slug: 'la-ca' }, { place_slug: 'la-ca' }, { place_slug: 'sf-ca' }]);
    expect(await bidCountsByPlace(db, NOW, false)).toEqual({ 'la-ca': 2, 'sf-ca': 1 });
    expect(await bidCountsByPlace(db, NOW, true)).toEqual({});
  });
  it('is best effort: a failed read or a client without .like leaves the counts as the view gave them', async () => {
    expect(await bidCountsByPlace(dbWith([], { error: true }), NOW, false)).toEqual({});
    expect(await bidCountsByPlace(dbWith([], { noLike: true }), NOW, false)).toEqual({});
  });
  it('minusBids subtracts, never below zero, and ignores places not in the counts', () => {
    expect(minusBids({ 'la-ca': 5, 'sf-ca': 1 }, { 'la-ca': 2, 'sf-ca': 3, 'x-xx': 9 })).toEqual({ 'la-ca': 3, 'sf-ca': 0 });
  });
});
