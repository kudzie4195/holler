/**
 * Round 15 final fix (P1-1 of review-final.md): one county-level weather alert must reach a member ONCE.
 * parseNws writes one row per county (data.alertId, data.loc = 'approx'). The scan's insert step used to drop `data` from its select, so
 * the matcher could not dedupe or give the county reach, and the cards showed a distance to a county centroid. These tests go through
 * the real insert step (insertNewSignals over an in-memory PostgREST double that honours the select list), then the matcher, then
 * every read surface: the real /app page, the real digest cron, the push entry builder, the mobile builder.
 * Ported from the reviewer's probe (review/final-evidence/harness/nws-scan-path.test.ts). Alert and member positions are hand-written (assumed).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNws } from '@/lib/signals/adapters/nws';
import { insertNewSignals } from '@/lib/signals/store';
import { matchSignals, type MatchProfile } from '@/lib/signals/match';
import { pushEntriesFromMatches } from '@/lib/push/notify';
import { hasApproxLocation } from '@/lib/signals/approx-location';
import { MATCH_SELECT } from '@/lib/mobile/feed';
import { alertKeyOf, dedupeByAlert } from '@/lib/signals/alert-dedupe';
import { fakeTables } from './fake-table';
import { rematchSignals } from '@/lib/signals/rematch';
import { backfillMatches } from '@/lib/signals/backfill';
import { fakeSignalsDb } from '../fixtures/fake-signals-db';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-18T12:00:00Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

const feature = (event: string, id: string, same: string[]) => ({
  id: `https://api.weather.gov/alerts/${id}`, geometry: null,
  properties: {
    '@id': `https://api.weather.gov/alerts/${id}`, id, event, areaDesc: 'Fulton; DeKalb; Cobb; Clayton; Gwinnett', geocode: { SAME: same, UGC: [] },
    sent: '2026-11-18T10:00:00Z', effective: '2026-11-18T10:00:00Z', onset: null, expires: '2026-11-19T10:00:00Z', ends: null, status: 'Actual', messageType: 'Alert',
    headline: `${event} issued`, description: 'Test.',
  },
});
// Fulton, DeKalb, Cobb, Clayton, Gwinnett: the metro Atlanta counties
const METRO = ['013121', '013089', '013067', '013063', '013135'];

const ATL: MatchProfile = { user_id: 'atl', categories: ['snow-removal'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 };
const SMY: MatchProfile = { user_id: 'smy', categories: ['snow-removal'], lat: 33.884, lon: -84.514, state: 'GA', radius_mi: 25 };

async function scanPath() {
  const parsed = parseNws({ features: [feature('Winter Storm Warning', 'urn:oid:ws1', METRO)] });
  const db = fakeTables({ holler_signals: [] }, { conflict: { holler_signals: ['source', 'external_id'] } });
  const stored: any[] = await insertNewSignals(db as any, parsed.map((s) => ({ ...s, placeSlug: null })) as any, {});
  return { parsed, stored };
}

/** The database shape the read surfaces get (aliases of data->>key), one match row per county row, as if stored by earlier scans. */
const dbSignal = (s: any) => ({
  id: s.id, source: s.source, external_id: s.external_id, kind: s.kind, title: s.title, summary: s.summary, url: null, city: null, state: s.state, county: null, zip: null,
  occurred_at: s.occurred_at, expires_at: iso(20 * 3_600_000), severity: s.severity, categories: s.categories, subtype: s.data?.subtype ?? null,
  approxLocation: s.data?.approxLocation ?? null, loc: s.data?.loc ?? null, alertId: s.data?.alertId ?? null,
});

describe('the scan path: insert, then match', () => {
  it('the metro alert is stored as one row per county and the insert step reads data back', async () => {
    const { parsed, stored } = await scanPath();
    expect(parsed.length).toBeGreaterThanOrEqual(4);
    expect(stored).toHaveLength(parsed.length);
    for (const s of stored) {
      expect(s.data?.alertId).toBe('urn:oid:ws1');
      expect(s.data?.loc).toBe('approx');
    }
  });

  it('each member gets the alert once, with no distance', async () => {
    const { stored } = await scanPath();
    const hits = matchSignals(stored, [ATL, SMY], 25, NOW);
    for (const u of ['atl', 'smy']) {
      const mine = hits.filter((h) => h.user_id === u);
      expect(mine, u).toHaveLength(1);
      expect(mine[0].distance_mi, `${u}: no distance to a county centroid`).toBeNull();
    }
  });

  it('a member at the edge of the metro still gets it once with data, and got it several times without', async () => {
    const { stored } = await scanPath();
    const edge: MatchProfile = { user_id: 'edge', categories: ['snow-removal'], lat: 33.749, lon: -84.388 + 0.4, state: 'GA', radius_mi: 25 };
    const via = matchSignals(stored, [edge], 25, NOW);
    const without = matchSignals(stored.map((s) => ({ ...s, data: undefined })), [edge], 25, NOW);
    expect(via).toHaveLength(1);
    // the old behaviour (data dropped by the insert select): the same member got the alert once per county row in reach
    expect(without.length).toBeGreaterThan(1);
  });
});

describe('every read surface shows the alert once, however many county rows hold matches', () => {
  it('push: the count is 1, and every county match is stamped with that push', async () => {
    const { stored } = await scanPath();
    const pm = stored.map((r, i) => ({ id: i + 1, user_id: 'atl', created_at: NOW.toISOString(), signal: dbSignal(r) }));
    const out = pushEntriesFromMatches(pm as any, NOW.getTime(), new Map([['atl', ['snow-removal']]]));
    expect(out.get('atl')?.count).toBe(1);
    expect(out.get('atl')?.matchIds).toHaveLength(stored.length);
  });

  it('push: a different alert is a second alert', async () => {
    const { stored } = await scanPath();
    const other = parseNws({ features: [feature('High Wind Warning', 'urn:oid:hw1', ['013121'])] });
    const db = fakeTables({ holler_signals: [] }, { conflict: { holler_signals: ['source', 'external_id'] } });
    const stored2: any[] = await insertNewSignals(db as any, other.map((s) => ({ ...s, placeSlug: null })) as any, {});
    stored2.forEach((s, i) => (s.id = 5000 + i));
    const pm = [...stored, ...stored2].map((r, i) => ({ id: i + 1, user_id: 'atl', created_at: NOW.toISOString(), signal: dbSignal(r) }));
    expect(pushEntriesFromMatches(pm as any, NOW.getTime(), new Map([['atl', ['snow-removal']]])).get('atl')?.count).toBe(2);
  });

  it('web /app page: one card, with the county note and no distance', async () => {
    const { stored } = await scanPath();
    const selects: string[] = [];
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/auth/session', () => ({
      requireProfile: async () => ({
        user: { id: 'atl' },
        profile: { user_id: 'atl', business_name: 'Peach Plows', categories: ['snow-removal'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.749, lon: -84.388, radius_mi: 25, alert_email: true,
          subscription_status: 'active', trial_ends_at: iso(-86_400_000), plan: 'pro', stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000) },
      }),
    }));
    const rows = stored.map((s, i) => ({ id: i + 1, status: 'new', distance_mi: 5.3 + i, draft: null, created_at: iso(-3_600_000), signal: dbSignal(s) }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => {
        const q: any = {};
        q.from = () => q;
        q.select = (c: string) => (selects.push(c), q);
        for (const m of ['eq', 'order']) q[m] = () => q;
        q.limit = async () => ({ data: rows, error: null });
        return q;
      },
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
    vi.doMock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));
    vi.doMock('@/lib/outreach/loader', () => ({ loadMemberContacts: async () => new Map() }));
    vi.doMock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
    vi.doMock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));
    vi.doMock('@/components/coming-next-member', () => ({ ComingNextForMember: () => null }));
    vi.doMock('@/components/billing-button', () => ({ BillingButton: () => null }));
    const AppHome = (await import('@/app/app/page')).default;
    const html = renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    const sel = selects.find((s) => s.includes('holler_signals'))!;
    expect(sel).toContain('loc:data->>loc');
    expect(sel).toContain('alertId:data->>alertId');
    expect((html.match(/data-testid="brief"/g) ?? []).length).toBe(1);
    const t = text(html);
    expect(t).toContain('This alert covers a county or zone, not a point');
    expect(t).not.toMatch(/\d+(\.\d)? mi away/);
  });

  it('digest cron (real route): one item, one push-style count, every county match marked notified', async () => {
    const { stored } = await scanPath();
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    process.env.CRON_SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx';
    const matchRows = stored.map((r, i) => ({ id: i + 1, user_id: 'atl', created_at: iso(-60_000 * i), signal: dbSignal(r) }));
    const profiles = [{ user_id: 'atl', business_name: 'Peach Plows', categories: ['snow-removal'], plan: 'starter', alert_email: true, subscription_status: 'active', trial_ends_at: iso(-86_400_000),
      last_notified_at: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000) }];
    const selects: string[] = [];
    const updates: { table: string; patch: any; ids?: any }[] = [];
    const admin: any = {
      from: (table: string) => {
        const q: any = {};
        q.select = (c: string) => (selects.push(c), q);
        q.eq = () => q;
        q.order = () => q;
        q.in = (_c: string, ids: any) => ((q._in = ids), q);
        q.range = async (from: number, to: number) => ({ data: table === 'holler_matches' ? matchRows.slice(from, to + 1) : [], error: null });
        q.update = (patch: any) => {
          const u = { table, patch, ids: undefined as any };
          updates.push(u);
          return { in: (_c: string, ids: any) => ((u.ids = ids), Promise.resolve({ error: null })), eq: () => Promise.resolve({ error: null }) };
        };
        q.then = (res: any) => res(table === 'holler_profiles' ? { data: profiles.filter((p) => (q._in ?? []).includes(p.user_id)), error: null } : { data: [], error: null });
        return q;
      },
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.test` } }, error: null }) } },
    };
    const sent: any[] = [];
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
    vi.doMock('@/lib/email', async () => ({ ...(await vi.importActual<any>('@/lib/email')), sendEmail: async (m: any) => (sent.push(m), { ok: true, id: 'x' }) }));
    vi.doMock('@/lib/ai', async () => ({ ...(await vi.importActual<any>('@/lib/ai')), notesFor: async () => new Map(), scoresFor: async () => new Map() }));
    vi.doMock('@/lib/push/notify', async () => ({ ...(await vi.importActual<any>('@/lib/push/notify')), pushNewMatches: async () => ({ status: 'not_configured' }) }));
    vi.doMock('@/lib/moat/log', () => ({ markAlertsEmailed: async () => undefined }));
    vi.doMock('@/lib/analytics/server', () => ({ track: async () => undefined }));
    vi.doMock('@/lib/requests/details', () => ({ requestTextByPublicId: async () => new Map(), requestTextForMember: async () => ({}) }));
    vi.doMock('@/lib/outreach/loader', () => ({ loadMemberContacts: async () => new Map() }));
    const { GET } = await import('@/app/api/cron/notify/route');
    await GET(new Request('https://x.test/api/cron/notify', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(sent).toHaveLength(1);
    // Round 24 (review P2-9): one role="listitem" block per card (no <ul>/<li>: Outlook on Windows).
    expect((sent[0].html.match(/<div role="listitem"/g) ?? []).length).toBe(1);
    // Round 23: the subject names the one card. A county alert has no address or place of its own, so its own title carries it.
    expect(sent[0].subject).toMatch(/^Winter Storm Warning: /);
    expect(sent[0].subject).not.toMatch(/\(\+/);
    expect(selects.find((s) => s.includes('holler_signals'))).toContain('alertId:data->>alertId');
    const notified = updates.filter((u) => u.table === 'holler_matches' && u.patch.notified === true).flatMap((u) => u.ids ?? []);
    expect(new Set(notified).size).toBe(stored.length);
  });

  it('mobile: the select reads loc and alertId, and one page shows the alert once', async () => {
    expect(MATCH_SELECT).toContain('loc:data->>loc');
    expect(MATCH_SELECT).toContain('alertId:data->>alertId');
    const { stored } = await scanPath();
    const kept = dedupeByAlert(stored.map((s) => ({ signal: dbSignal(s) })), (m) => m.signal);
    expect(kept).toHaveLength(1);
  });
});


describe('rematch and backfill read data too, and give the alert once', () => {
  const asRows = (stored: any[]) => stored.map((s) => ({ ...s, expires_at: iso(20 * 3_600_000), occurred_at: iso(-2 * 3_600_000) }));

  it('rematch: four county rows, no match yet -> one match', async () => {
    const { stored } = await scanPath();
    const rows = asRows(stored);
    const db = fakeTables({ holler_signals: rows, holler_matches: [] }, { conflict: { holler_matches: ['user_id', 'signal_id'] } });
    const r = await rematchSignals(db as any, rows.map((x) => x.id), { now: NOW, profiles: [ATL], quiet: true });
    expect(r.created).toBe(1);
    expect(db.tables.holler_matches).toHaveLength(1);
  });

  it('rematch: the member already has the alert through one county row -> no second match through another', async () => {
    const { stored } = await scanPath();
    const rows = asRows(stored);
    const db = fakeTables({ holler_signals: rows, holler_matches: [{ id: 1, user_id: 'atl', signal_id: rows[0].id, status: 'new' }] }, { conflict: { holler_matches: ['user_id', 'signal_id'] } });
    const r = await rematchSignals(db as any, rows.map((x) => x.id), { now: NOW, profiles: [ATL], quiet: true });
    expect(r.created).toBe(0);
    expect(db.tables.holler_matches).toHaveLength(1);
  });

  it('backfill: a new member gets the alert once', async () => {
    const { stored } = await scanPath();
    const rows = asRows(stored).map((r) => ({ ...r, state: 'GA' }));
    const upserts: any[][] = [];
    const base = fakeSignalsDb(rows, { now: NOW });
    const db: any = {
      rpc: (...a: any[]) => (base.rpc as any)(...a),
      from(table: string) {
        if (table !== 'holler_matches') return base.from(table);
        const q: any = { select: () => q, eq: () => q, in: () => q, then: (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej), upsert: (r: any[]) => (upserts.push(r), Promise.resolve({ error: null })) };
        return q;
      },
    };
    await backfillMatches(db, ATL, NOW);
    const sent = upserts.flat();
    expect(sent).toHaveLength(1);
    expect(sent.every((x: any) => x.distance_mi == null)).toBe(true);
  });
});

describe('helpers', () => {
  it('hasApproxLocation accepts the flat loc alias, and alertKeyOf reads nested or flat', () => {
    expect(hasApproxLocation({ source: 'nws', loc: 'approx' })).toBe(true);
    expect(hasApproxLocation({ source: 'nws', loc: null })).toBe(false);
    expect(alertKeyOf({ source: 'nws', data: { alertId: 'a' } })).toBe('nws|a');
    expect(alertKeyOf({ source: 'nws', alertId: 'a' })).toBe('nws|a');
    expect(alertKeyOf({ source: 'nws', alertId: null })).toBeNull();
  });
  it('rows that are not multi-county alerts are never dropped', () => {
    const rows = [{ s: { source: 'x' } }, { s: { source: 'x' } }, { s: { source: 'nws', alertId: 'a' } }, { s: { source: 'nws', alertId: 'a' } }];
    expect(dedupeByAlert(rows, (r) => r.s)).toHaveLength(3);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});
