/**
 * Round 18 ROUTES: the app feed (GET /api/m/feed) carries `hold` on a feed-only card (additive field) and reads without alert_hold when
 * migration 0027 is missing (real code 42703).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { FakeDb } from '../ops/fakedb';
import { buildAlerts, MATCH_SELECT, MATCH_SELECT_BEFORE_0027, readFeedPage } from '@/lib/mobile/feed';

const NOW = new Date('2026-11-20T12:00:00Z');
const row = (id: number, hold: string | null) => ({
  id, status: 'new', distance_mi: 2, draft: null, created_at: NOW.toISOString(), alert_hold: hold,
  signal: { id: 100 + id, source: 'arcgis-dekalb-permits', kind: 'permit', title: 'New home permit in DeKalb County', summary: 'New Construction | Issued', url: null, city: 'Decatur', state: 'GA', county: null, zip: null, severity: 1, categories: ['general-contractor', 'real-estate', 'moving'], occurred_at: NOW.toISOString(), expires_at: null, subtype: 'permit' },
});

describe('mobile feed and alert_hold', () => {
  it('a held card carries hold; any other card has no hold key (the DTO is as before)', async () => {
    const deps = { userId: 'u1', locked: false, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['moving'] };
    const [held, open] = await buildAlerts([row(1, 'background'), row(2, null)] as never, deps);
    expect(held.hold).toBe('background');
    expect(open).not.toHaveProperty('hold');
  });
  it('before migration 0027 the page is read again without alert_hold', async () => {
    const selects: string[] = [];
    const db = {
      from: () => {
        let cols = '';
        const q: Record<string, unknown> = {};
        q.select = (c: string) => ((cols = c), selects.push(c), q);
        for (const m of ['eq', 'or', 'order']) q[m] = () => q;
        q.limit = async () => (cols.includes('alert_hold') ? { data: null, error: { code: '42703', message: 'column holler_matches.alert_hold does not exist' } } : { data: [row(1, null)], error: null });
        return q;
      },
    };
    const r = await readFeedPage(db as never, 'u1', null);
    expect(r.error).toBe(false);
    expect(r.rows).toHaveLength(1);
    expect(selects).toEqual([MATCH_SELECT, MATCH_SELECT_BEFORE_0027]);
    expect(MATCH_SELECT_BEFORE_0027).not.toContain('alert_hold');
  });
});
