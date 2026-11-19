import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { signUnsubscribeToken, verifyUnsubscribeToken, verifyScopedToken, signVerifyToken } from '@/lib/email/token';
import { LIFECYCLE_UNSUB_TTL_SECONDS, lifecycleUnsubUrl, signLifecycleUnsub, verifyLifecycleUnsub } from '@/lib/lifecycle/unsub';
import { selectLifecycle } from '@/lib/lifecycle/select';

vi.mock('server-only', () => ({}));
const SECRET = 'unit-test-secret-not-real';
const h = vi.hoisted(() => ({ db: null as unknown, secret: 'unit-test-secret-not-real' as string | undefined }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.db }));
vi.mock('@/lib/env', () => ({
  env: new Proxy({}, { get: (_t, k) => (k === 'CRON_SECRET' ? h.secret : undefined) }),
  siteUrl: 'https://localholler.com',
}));

import * as route from '@/app/api/cron/lifecycle/unsubscribe/route';
import * as alertRoute from '@/app/api/cron/notify/unsubscribe/route';

const U = '11111111-1111-1111-1111-111111111111';
const V = '22222222-2222-2222-2222-222222222222';
const NOW = Date.now();
let db: FakeDb;

const tokenFor = (id: string) => signLifecycleUnsub(id, SECRET);
const post = (token: string, mode: 'query' | 'form' = 'query') =>
  mode === 'query'
    ? route.POST(new Request(`https://x.test/api/cron/lifecycle/unsubscribe?t=${encodeURIComponent(token)}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }))
    : route.POST(new Request('https://x.test/api/cron/lifecycle/unsubscribe', { method: 'POST', body: new URLSearchParams({ t: token }) }));

beforeEach(() => {
  db = new FakeDb({ holler_lifecycle_sends: [], holler_profiles: [{ user_id: U, alert_email: true }, { user_id: V, alert_email: true }] });
  h.db = db;
  h.secret = SECRET;
});

describe('tokens', () => {
  it('round trip, bound to the member', () => {
    expect(verifyLifecycleUnsub(tokenFor(U), SECRET)).toBe(U);
    expect(verifyLifecycleUnsub(tokenFor(V), SECRET)).toBe(V);
  });
  it('a token signed with another secret, a garbled token and an empty token are refused', () => {
    expect(verifyLifecycleUnsub(tokenFor(U), 'other')).toBeNull();
    expect(verifyLifecycleUnsub(`${tokenFor(U)}x`, SECRET)).toBeNull();
    expect(verifyLifecycleUnsub('', SECRET)).toBeNull();
    expect(verifyLifecycleUnsub('a.b', SECRET)).toBeNull();
  });
  it('is not the alert unsubscribe token, in either direction', () => {
    expect(verifyUnsubscribeToken(tokenFor(U), SECRET)).toBeNull();
    expect(verifyLifecycleUnsub(signUnsubscribeToken(U, SECRET), SECRET)).toBeNull();
    expect(verifyLifecycleUnsub(signVerifyToken(U, SECRET), SECRET)).toBeNull();
    expect(verifyScopedToken(tokenFor(U), 'verify', SECRET)).toBeNull();
  });
  it('lasts well past the last email it can be in (13 months) and then expires', () => {
    expect(LIFECYCLE_UNSUB_TTL_SECONDS).toBe(400 * 86_400);
    const t = signLifecycleUnsub(U, SECRET, NOW);
    expect(verifyLifecycleUnsub(t, SECRET, NOW + 399 * 86_400_000)).toBe(U);
    expect(verifyLifecycleUnsub(t, SECRET, NOW + 401 * 86_400_000)).toBeNull();
  });
  it('the url is absolute, has no trailing-slash doubling, and carries an encoded token', () => {
    const u = lifecycleUnsubUrl('https://localholler.com/', U, SECRET, NOW);
    expect(u.startsWith('https://localholler.com/api/cron/lifecycle/unsubscribe?t=')).toBe(true);
    expect(verifyLifecycleUnsub(decodeURIComponent(new URL(u).searchParams.get('t') ?? ''), SECRET, NOW)).toBe(U);
  });
});

describe('GET (what a mail scanner does) changes nothing', () => {
  it('shows a confirm page with a POST form and writes no row', async () => {
    const res = route.GET(new Request(`https://x.test/api/cron/lifecycle/unsubscribe?t=${encodeURIComponent(tokenFor(U))}`));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('method="POST"');
    expect(html).toContain('Stop these emails');
    expect(db.tables.holler_lifecycle_sends).toEqual([]);
    expect(db.calls.filter((c) => c.endsWith('.upsert') || c.endsWith('.insert'))).toEqual([]);
  });
  it('a bad token gets a 400 page', async () => {
    const res = route.GET(new Request('https://x.test/api/cron/lifecycle/unsubscribe?t=nope'));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Link not valid');
  });
});

describe('POST opts the member out', () => {
  it('the RFC 8058 one-click POST to the List-Unsubscribe URL works with no login', async () => {
    const res = await post(tokenFor(U));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Trial emails are off');
    expect(db.tables.holler_lifecycle_sends.map((r) => `${r.user_id}:${r.kind}`)).toEqual([`${U}:optout`]);
  });
  it('the confirm-page button (form body) works too', async () => {
    const res = await post(tokenFor(U), 'form');
    expect(res.status).toBe(200);
    expect(db.tables.holler_lifecycle_sends).toHaveLength(1);
  });
  it('is idempotent', async () => {
    await post(tokenFor(U));
    const res = await post(tokenFor(U));
    expect(res.status).toBe(200);
    expect(db.tables.holler_lifecycle_sends).toHaveLength(1);
  });
  it('only that member is opted out, and alert emails (alert_email) are untouched', async () => {
    await post(tokenFor(U));
    expect(db.tables.holler_lifecycle_sends.map((r) => r.user_id)).toEqual([U]);
    expect(db.tables.holler_profiles.map((p) => p.alert_email)).toEqual([true, true]);
    expect(db.calls.some((c) => c.startsWith('holler_profiles.'))).toBe(false);
  });
  it('a bad, foreign or alert-unsubscribe token changes nothing', async () => {
    for (const t of ['', 'garbage', signUnsubscribeToken(U, SECRET), signLifecycleUnsub(U, 'other-secret')]) {
      const res = await post(t);
      expect(res.status).toBe(400);
    }
    expect(db.tables.holler_lifecycle_sends).toEqual([]);
  });
  it('without CRON_SECRET configured every token is refused', async () => {
    h.secret = undefined;
    expect((await post(tokenFor(U))).status).toBe(400);
    expect(route.GET(new Request(`https://x.test/x?t=${encodeURIComponent(tokenFor(U))}`)).status).toBe(400);
    expect(db.tables.holler_lifecycle_sends).toEqual([]);
  });
  it('a database error (or the table missing) answers a plain 500 page, not a crash', async () => {
    db.failOn['holler_lifecycle_sends.upsert'] = 'relation "holler_lifecycle_sends" does not exist';
    const res = await post(tokenFor(U));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Something went wrong');
  });
});

describe('the alert unsubscribe is a separate switch', () => {
  it('the alert route refuses a lifecycle token and writes nothing', async () => {
    const res = await alertRoute.POST(new Request(`https://x.test/api/cron/notify/unsubscribe?t=${encodeURIComponent(tokenFor(U))}`, { method: 'POST' }));
    expect(res.status).toBe(400);
    expect(db.tables.holler_profiles.map((p) => p.alert_email)).toEqual([true, true]);
  });
});

describe('the opt-out is respected by the next run', () => {
  it('after the click, selection returns nothing for that member at any stage, and still returns others', async () => {
    await post(tokenFor(U));
    const now = new Date('2026-11-19T12:00:00Z');
    const H = 3_600_000;
    const mk = (id: string) => ({ user_id: id, created_at: new Date(now.getTime() - 30 * H).toISOString(), email_verified_at: 'x', subscription_status: 'trialing', trial_ends_at: new Date(now.getTime() + 9 * 24 * H).toISOString() });
    const sends = db.tables.holler_lifecycle_sends.map((r) => ({ user_id: r.user_id as string, kind: r.kind as string }));
    expect(selectLifecycle([mk(U), mk(V)], sends, now)).toEqual([{ userId: V, kind: 'welcome' }]);
  });
});
