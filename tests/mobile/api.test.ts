// Mobile API routes (app/api/m/**) driven through their real handlers with faked Supabase clients that emulate RLS.
// Covers: bearer token verification, CORS, each endpoint's authorization, locked-member rules, the free check and push registration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profileRow, req, tok, UA, UB } from './fakes';
import { install, world, type World } from './harness';

const TA = tok('a');
const TB = tok('b');
let w: World;
let contactCalls: { userId: string; signalIds: number[]; locked?: boolean }[];

function sig(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    source: 'nws',
    kind: 'alert',
    title: `Severe thunderstorm warning ${id}`,
    summary: 'Hail up to 1 inch',
    url: 'https://api.weather.gov/alerts/x',
    city: 'Smyrna',
    state: 'GA',
    county: 'Cobb',
    zip: '30080',
    severity: 2,
    occurred_at: '2026-11-18T10:00:00Z',
    expires_at: null,
    subtype: null,
    ...over,
  };
}

beforeEach(() => {
  contactCalls = [];
  w = world({
    users: { [TA]: { id: UA, email: 'a@x.test', app_metadata: { products: ['holler'] } }, [TB]: { id: UB, email: 'b@x.test', app_metadata: { products: ['holler'] } } },
    profiles: { [UA]: profileRow(UA), [UB]: profileRow(UB, { business_name: 'B Plumbing' }) },
    matches: [
      { id: 1, user_id: UA, created_at: '2026-11-18T10:00:00.000001+00:00', signal: sig(101), distance_mi: 3.24, draft: 'Hi there' },
      { id: 2, user_id: UA, created_at: '2026-11-18T11:00:00+00:00', signal: sig(102, { source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit' }) },
      { id: 3, user_id: UB, created_at: '2026-11-18T12:00:00+00:00', signal: sig(201, { title: 'B only' }) },
    ],
  });
  install(w);
  vi.doMock('@/lib/outreach/loader', () => ({
    loadMemberContacts: async (o: { userId: string; signalIds: number[]; locked?: boolean }) => {
      contactCalls.push({ userId: o.userId, signalIds: o.signalIds, locked: o.locked });
      return new Map(o.signalIds.map((id) => [id, [{ signalId: id, role: 'contractor', name: 'Acme Builders LLC', phone: '555-0100' }]]));
    },
  }));
  vi.doMock('@/lib/requests/details', () => ({ requestTextForMember: async () => ({}) }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const me = async () => (await import('../../app/api/m/me/route')).GET;
const feed = async () => (await import('../../app/api/m/feed/route')).GET;
const alert = async () => (await import('../../app/api/m/alert/[signalId]/route')).GET;
const params = (signalId: string) => ({ params: Promise.resolve({ signalId }) });

describe('bearer token verification', () => {
  it('missing header: 401 unauthorized, Auth server not called', async () => {
    const res = await (await me())(req('/api/m/me'));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(w.authCalls).toEqual([]);
  });
  it('malformed tokens (not a JWT, wrong scheme, too long) are refused before any network call', async () => {
    for (const h of ['Bearer abc', 'Basic ' + TA, 'Bearer ' + TA + ' extra', `Bearer ${'a'.repeat(5000)}.b.c`, TA]) {
      const res = await (await me())(req('/api/m/me', { headers: { authorization: h } }));
      expect(res.status, h.slice(0, 20)).toBe(401);
    }
    expect(w.authCalls).toEqual([]);
  });
  it('expired, revoked or another project token: the Auth server says no, so 401', async () => {
    const expired = tok('expired');
    const other = tok('other-project');
    for (const t of [expired, other]) {
      const res = await (await me())(req('/api/m/me', { token: t }));
      expect(res.status).toBe(401);
    }
    expect(w.authCalls).toEqual([expired, other]);
  });
  it('a decoded token is never trusted: every request asks the Auth server', async () => {
    await (await me())(req('/api/m/me', { token: TA }));
    await (await me())(req('/api/m/me', { token: TA }));
    expect(w.authCalls).toEqual([TA, TA]);
  });
  // Changed in round 7 (fix-f): an Auth outage was a 500 server_error. It is now 503 `unavailable` with Retry-After, and a 429 from the
  // Auth server is the same (it used to become 401 unauthorized, which signs the member out).
  it('an Auth outage (5xx, no answer) is 503 unavailable with Retry-After, not a sign-out', async () => {
    w.authDown = true;
    for (const status of [500, 502, 503, 0, 408]) {
      w.authStatus = status;
      const res = await (await me())(req('/api/m/me', { token: TA }));
      expect(res.status, String(status)).toBe(503);
      expect(res.headers.get('retry-after')).toBe('10');
      expect((await res.json()).error).toBe('unavailable');
    }
  });
  it('a 429 from the Auth server is 503 unavailable, never 401', async () => {
    w.authDown = true;
    w.authStatus = 429;
    const res = await (await me())(req('/api/m/me', { token: TA }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'unavailable' });
  });
  it('only 400, 401, 403 and 404 from the Auth server mean the token is bad (401)', async () => {
    w.authDown = true;
    for (const status of [400, 401, 403, 404]) {
      w.authStatus = status;
      expect((await (await me())(req('/api/m/me', { token: TA }))).status, String(status)).toBe(401);
    }
  });
  it('a thrown Auth call (network) is 503 unavailable', async () => {
    vi.doMock('@/lib/mobile/clients', () => ({ authClient: () => ({ auth: { getUser: async () => Promise.reject(new TypeError('fetch failed')) } }) }));
    const { verifyRequest } = await import('../../lib/mobile/auth');
    expect(await verifyRequest(req('/api/m/me', { token: TA }))).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('rate limits (website limiter, per member and per network address)', () => {
  it('reads: generous, then 429 rate_limited with Retry-After', async () => {
    const get = await me();
    for (let i = 0; i < 300; i++) expect((await get(req('/api/m/me', { token: TA }))).status).toBe(200);
    const res = await get(req('/api/m/me', { token: TA }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect((await res.json()).error).toBe('rate_limited');
    // Another member is not affected.
    expect((await get(req('/api/m/me', { token: TB }))).status).toBe(200);
  });
  // Changed in round 7 fix-g2 (verify-v2 P2, commander decision 8): only FAILED tokens are counted per address (60 per 5 minutes).
  it('verify-v2 P2 reviewer reproduction: 600 junk tokens from one address do not lock out a real member at that address', async () => {
    const get = await me();
    const bad = tok('nobody');
    const ip = { 'x-forwarded-for': '100.64.1.1' };
    for (let i = 0; i < 600; i++) await get(req('/api/m/me', { token: bad, headers: ip }));
    const res = await get(req('/api/m/me', { token: TA, headers: ip }));
    expect(res.status).toBe(200);
  });
  it('failed tokens per address: 60 in 5 minutes are 401, then 429 for bad or missing tokens only', async () => {
    const get = await me();
    const bad = tok('nobody');
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 60; i++) expect((await get(req('/api/m/me', { token: bad, headers: ip }))).status).toBe(401);
    const res = await get(req('/api/m/me', { token: bad, headers: ip }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('rate_limited');
    expect((await get(req('/api/m/me', { token: null, headers: ip }))).status).toBe(429);
    expect((await get(req('/api/m/me', { token: TA, headers: ip }))).status).toBe(200);
    expect((await get(req('/api/m/me', { token: bad, headers: { 'x-forwarded-for': '198.51.100.1' } }))).status).toBe(401);
  });
  it('valid tokens are never counted per address: 250 good requests from one address leave the bad-token budget untouched', async () => {
    const get = await me();
    const ip = { 'x-forwarded-for': '203.0.113.50' };
    for (let i = 0; i < 250; i++) await get(req('/api/m/me', { token: i % 2 ? TA : TB, headers: ip }));
    expect((await get(req('/api/m/me', { token: tok('nobody'), headers: ip }))).status).toBe(401);
  });
  it('an Auth outage is never counted as a failed token', async () => {
    w.authDown = true;
    w.authStatus = 503;
    const get = await me();
    const ip = { 'x-forwarded-for': '203.0.113.77' };
    for (let i = 0; i < 70; i++) expect((await get(req('/api/m/me', { token: TA, headers: ip }))).status).toBe(503);
  });
  it('keys never hold the raw user id or address', async () => {
    await (await me())(req('/api/m/me', { token: TA, headers: { 'x-forwarded-for': '203.0.113.9' } }));
    await (await me())(req('/api/m/me', { token: tok('nobody'), headers: { 'x-forwarded-for': '203.0.113.9' } }));
    const keys = w.admin!.rpcs.map((r) => String(r.args.p_key));
    expect(keys.length).toBe(2); // one per-member key (valid token), one per-address key (failed token)
    expect(keys.some((k) => k.includes(UA) || k.includes('203.0.113.9'))).toBe(false);
  });
  it('a limiter that cannot run lets the request through (fail open, as web login)', async () => {
    w.admin = null;
    install(w);
    w.admin!.rpc = async () => ({ data: null, error: { message: 'down' } });
    expect((await (await me())(req('/api/m/me', { token: TA }))).status).toBe(200);
  });
  it('every member route names its limit', async () => {
    const fs = await import('node:fs');
    const want: Record<string, string> = {
      'me/route.ts': "limit: 'read'",
      'feed/route.ts': "limit: 'read'",
      'alert/[signalId]/route.ts': "limit: 'read'",
      'feedback/route.ts': "limit: 'write'",
      'profile/route.ts': "limit: 'write'",
      'push/register/route.ts': "limit: 'push'",
      'onboarding/route.ts': "limit: 'onboarding'",
      'account/delete/route.ts': "limit: 'delete'",
    };
    for (const [f, lim] of Object.entries(want)) {
      const src = fs.readFileSync(`app/api/m/${f}`, 'utf8');
      const calls = src.match(/requireMember\(req, METHODS[^)]*\)/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, f).toContain(lim);
    }
  });
});

describe('CORS', () => {
  for (const origin of ['capacitor://localhost', 'https://localhost', 'http://localhost']) {
    it(`echoes the app origin ${origin}`, async () => {
      const res = await (await me())(req('/api/m/me', { token: TA, origin }));
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('vary')).toContain('Origin');
    });
  }
  it('never answers CORS for another origin (also on errors)', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:3000', 'capacitor://evil', 'null']) {
      const res = await (await me())(req('/api/m/me', { token: TA, origin }));
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      const bad = await (await me())(req('/api/m/me', { origin }));
      expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
  it('every route has an OPTIONS handler: 204, methods and headers for the app origin only', async () => {
    const routes = ['config', 'me', 'onboarding', 'profile', 'feed', 'alert/[signalId]', 'feedback', 'check', 'push/register', 'account/delete'];
    for (const r of routes) {
      const mod = (await import(`../../app/api/m/${r}/route`)) as { OPTIONS: (q: Request) => Response };
      const ok = mod.OPTIONS(req(`/api/m/${r}`, { method: 'OPTIONS', origin: 'capacitor://localhost' }));
      expect(ok.status, r).toBe(204);
      expect(ok.headers.get('access-control-allow-origin'), r).toBe('capacitor://localhost');
      expect(ok.headers.get('access-control-allow-headers'), r).toContain('authorization');
      expect(ok.headers.get('access-control-allow-methods'), r).toContain('OPTIONS');
      const no = mod.OPTIONS(req(`/api/m/${r}`, { method: 'OPTIONS', origin: 'https://evil.example' }));
      expect(no.headers.get('access-control-allow-origin'), r).toBeNull();
    }
  });
  it('member responses are not cacheable', async () => {
    const res = await (await me())(req('/api/m/me', { token: TA }));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/m/me', () => {
  it('returns the caller profile, trial access and Solo limits', async () => {
    const res = await (await me())(req('/api/m/me', { token: TA }));
    const b = await res.json();
    expect(b).toMatchObject({
      ok: true,
      user: { id: UA, email: 'a@x.test' },
      needsOnboarding: false,
      profile: { businessName: 'Ace Roofing', trades: ['roofing'], zip: '30080', radiusMi: 25, pushAlerts: true, alertEmail: true },
      access: { state: 'trial', tier: 'starter', tierName: 'Solo', billingSource: 'none', mayBuyInStore: true, manageUrl: null },
      limits: { serviceAreas: 1, extraZips: 0, trades: 5, keywordWatches: 0 },
    });
  });
  it('no profile: needsOnboarding, access null', async () => {
    delete w.profiles[UA];
    const b = await (await (await me())(req('/api/m/me', { token: TA }))).json();
    expect(b).toMatchObject({ ok: true, needsOnboarding: true, profile: null, access: null });
  });
  it('locked member still gets /me (state locked)', async () => {
    w.profiles[UA] = profileRow(UA, { trial_ends_at: '2026-01-01T00:00:00Z' });
    const b = await (await (await me())(req('/api/m/me', { token: TA }))).json();
    expect(b.access).toMatchObject({ state: 'locked', tier: 'starter' });
  });
  it('a live Stripe plan: billing source stripe, store purchase not allowed, managed on the web', async () => {
    w.profiles[UA] = profileRow(UA, { subscription_status: 'active', plan: 'pro', plan_source: 'stripe', stripe_subscription_id: 'sub_1' });
    const b = await (await (await me())(req('/api/m/me', { token: TA }))).json();
    expect(b.access).toMatchObject({ state: 'paid', tier: 'pro', billingSource: 'stripe', mayBuyInStore: false, manageUrl: 'https://localholler.test/app/settings' });
    expect(b.limits).toMatchObject({ serviceAreas: 3, extraZips: 2, trades: 15, keywordWatches: 5 });
  });
  it('a live App Store plan: billing source apple, managed in the App Store', async () => {
    const exp = new Date(Date.now() + 20 * 86_400_000).toISOString();
    w.profiles[UA] = profileRow(UA, { subscription_status: 'active', plan: 'starter', plan_source: 'apple', store_product_id: 'com.localholler.app.solo.monthly', store_expires_at: exp });
    const b = await (await (await me())(req('/api/m/me', { token: TA }))).json();
    expect(b.access).toMatchObject({ state: 'paid', billingSource: 'apple', storeProductId: 'com.localholler.app.solo.monthly', storeExpiresAt: exp, mayBuyInStore: true, manageUrl: 'https://apps.apple.com/account/subscriptions' });
  });
  it('a store plan whose expiry passed more than 3 days ago with no EXPIRATION is locked once the trial is over', async () => {
    w.profiles[UA] = profileRow(UA, { subscription_status: 'active', plan: 'pro', plan_source: 'google', store_expires_at: new Date(Date.now() - 4 * 86_400_000).toISOString(), trial_ends_at: '2026-01-01T00:00:00Z' });
    const b = await (await (await me())(req('/api/m/me', { token: TA }))).json();
    expect(b.access).toMatchObject({ state: 'locked', tier: 'starter' });
  });
});

describe('GET /api/m/feed', () => {
  it('newest first, own matches only, public fields, intent, source label, distance, contacts and ai slot', async () => {
    const res = await (await feed())(req('/api/m/feed', { token: TA }));
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(b.locked).toBe(false);
    expect(b.items.map((i: { matchId: number }) => i.matchId)).toEqual([2, 1]);
    expect(b.items.some((i: { title: string }) => i.title === 'B only')).toBe(false);
    const nws = b.items[1];
    expect(nws).toMatchObject({
      signalId: 101,
      sourceLabel: 'National Weather Service alerts',
      sourceUrl: 'https://www.weather.gov/alerts',
      url: 'https://api.weather.gov/alerts/x',
      intent: { key: 'demand', label: 'Demand sign' },
      distanceMi: 3.2,
      distanceLabel: '3.2 mi away',
      draft: 'Hi there',
      ai: { note: null },
      place: 'Smyrna, GA',
    });
    expect(b.items[0].intent).toMatchObject({ key: 'spending', label: 'Spending activity' });
    // Contacts: loaded once, for the caller, with only the caller's own contact-capable signal ids.
    expect(contactCalls).toEqual([{ userId: UA, signalIds: [102], locked: false }]);
    expect(b.items[0].contacts).toEqual([{ role: 'contractor', name: 'Acme Builders LLC', phone: '555-0100' }]);
    expect(b.nextCursor).toBeNull();
    // Every member read was scoped to the caller.
    for (const q of w.members[UA].log.filter((x) => x.table === 'holler_matches')) expect(q.eqOf('user_id')).toBe(UA);
  });
  it('locked: masked titles, no url, draft, contacts or feedback, and the contacts loader is never called', async () => {
    w.profiles[UA] = profileRow(UA, { trial_ends_at: '2026-01-01T00:00:00Z' });
    w.feedback.push({ user_id: UA, signal_id: 101, verdict: 'useful', job_value_usd: null });
    const b = await (await (await feed())(req('/api/m/feed', { token: TA }))).json();
    expect(b.locked).toBe(true);
    for (const it of b.items) {
      expect(it.title).toMatch(/^[x\s]+$/);
      expect(it.url).toBeNull();
      expect(it.draft).toBeNull();
      expect(it.contacts).toEqual([]);
      expect(it.feedback).toBeNull();
      expect(it.zip).toBeNull();
    }
    expect(contactCalls).toEqual([]);
  });
  it('pages 30 at a time with an opaque cursor', async () => {
    w.matches = Array.from({ length: 65 }, (_, i) => ({
      id: 1000 + i,
      user_id: UA,
      created_at: `2026-11-18T10:${String(Math.floor(i / 2)).padStart(2, '0')}:00+00:00`, // pairs share a timestamp
      signal: sig(5000 + i),
    }));
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Response = await (await feed())(req(`/api/m/feed${cursor ? `?cursor=${cursor}` : ''}`, { token: TA }));
      const b = await r.json();
      seen.push(...b.items.map((i: { matchId: number }) => i.matchId));
      cursor = b.nextCursor;
      pages++;
      if (pages === 1) expect(b.items).toHaveLength(30);
    } while (cursor && pages < 5);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(65);
  });
  it('a forged cursor is 400 invalid', async () => {
    for (const c of ['abc', Buffer.from('["x",1]').toString('base64url'), Buffer.from('["2026-11-18T10:00:00Z",-1]').toString('base64url'), "'),or(1=1"]) {
      const res = await (await feed())(req(`/api/m/feed?cursor=${encodeURIComponent(c)}`, { token: TA }));
      expect(res.status, c).toBe(400);
    }
  });
  it('an ended resident request is left out', async () => {
    w.matches.push({ id: 9, user_id: UA, created_at: '2026-11-18T13:00:00+00:00', signal: sig(109, { source: 'holler-request', kind: 'ask', expires_at: '2026-01-01T00:00:00Z' }) });
    const b = await (await (await feed())(req('/api/m/feed', { token: TA }))).json();
    expect(b.items.map((i: { matchId: number }) => i.matchId)).not.toContain(9);
  });
  it('no profile: 409 needs_onboarding', async () => {
    delete w.profiles[UA];
    const res = await (await feed())(req('/api/m/feed', { token: TA }));
    expect(res.status).toBe(409);
  });
});

describe('GET /api/m/alert/[signalId]', () => {
  it('returns the caller own alert in full', async () => {
    const res = await (await alert())(req('/api/m/alert/101', { token: TA }), params('101'));
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(b.item).toMatchObject({ signalId: 101, title: 'Severe thunderstorm warning 101' });
  });
  it("another member's alert is a 404, the same as an unknown id, and nothing of it leaks", async () => {
    const other = await (await alert())(req('/api/m/alert/201', { token: TA }), params('201'));
    const unknown = await (await alert())(req('/api/m/alert/999', { token: TA }), params('999'));
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await other.text()).not.toContain('B only');
    expect(contactCalls).toEqual([]);
  });
  it('bad ids are 404', async () => {
    for (const id of ['0', '-1', 'abc', '1e3', '99999999999999999999']) {
      const res = await (await alert())(req(`/api/m/alert/${id}`, { token: TA }), params(id));
      expect(res.status, id).toBe(404);
    }
  });
  it('locked: masked, no contacts', async () => {
    w.profiles[UA] = profileRow(UA, { trial_ends_at: '2026-01-01T00:00:00Z' });
    const b = await (await (await alert())(req('/api/m/alert/102', { token: TA }), params('102'))).json();
    expect(b.locked).toBe(true);
    expect(b.item.contacts).toEqual([]);
    expect(b.item.title).toMatch(/^[x\s]+$/);
    expect(contactCalls).toEqual([]);
  });
  it('signed out is 401', async () => {
    const res = await (await alert())(req('/api/m/alert/101'), params('101'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/m/feedback', () => {
  const post = async (token: string | null, body: unknown, headers?: Record<string, string>) =>
    (await import('../../app/api/m/feedback/route')).POST(req('/api/m/feedback', { method: 'POST', token, body, headers }));
  it('saves the caller answer with their own client', async () => {
    const res = await post(TA, { signalId: 101, verdict: 'led_to_work', jobValueUsd: 2500 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, feedback: { verdict: 'led_to_work', jobValueUsd: 2500 } });
    expect(w.feedback).toEqual([{ user_id: UA, signal_id: 101, verdict: 'led_to_work', job_value_usd: 2500 }]);
  });
  it("an alert the caller was never sent (another member's) is 404, nothing written", async () => {
    const res = await post(TA, { signalId: 201, verdict: 'useful' });
    expect(res.status).toBe(404);
    expect(w.feedback).toEqual([]);
  });
  it('bad verdict or value is 400; non-JSON is 415', async () => {
    expect((await post(TA, { signalId: 101, verdict: 'great' })).status).toBe(400);
    expect((await post(TA, { signalId: 101, verdict: 'led_to_work', jobValueUsd: -5 })).status).toBe(400);
    expect((await post(TA, { signalId: '101', verdict: 'useful' })).status).toBe(400);
    expect((await post(TA, 'signalId=1', { 'content-type': 'text/plain' })).status).toBe(415);
  });
  it('signed out is 401', async () => {
    expect((await post(null, { signalId: 101, verdict: 'useful' })).status).toBe(401);
  });
});

describe('POST/DELETE /api/m/push/register', () => {
  const T = 'fcm-token-abcdefghijklmnopqrstuvwxyz:APA91b_0123456789';
  const call = async (method: 'POST' | 'DELETE', token: string | null, body: unknown) => {
    const mod = await import('../../app/api/m/push/register/route');
    return mod[method](req('/api/m/push/register', { method, token, body }));
  };
  it('stores the token for the caller (user id from the verified token, never the body)', async () => {
    const res = await call('POST', TA, { token: T, platform: 'ios', appVersion: '1.0.0', user_id: UB });
    expect(res.status).toBe(200);
    const up = w.admin!.log.find((q) => q.table === 'holler_push_tokens' && q.op === 'upsert')!;
    expect(up.payload).toMatchObject({ user_id: UA, token: T, platform: 'ios', app_version: '1.0.0', disabled_at: null });
    expect(up.opts).toEqual({ onConflict: 'token' });
  });
  it('rejects a bad token or platform', async () => {
    expect((await call('POST', TA, { token: 'short', platform: 'ios' })).status).toBe(400);
    expect((await call('POST', TA, { token: T, platform: 'web' })).status).toBe(400);
    expect((await call('POST', TA, { token: `${T} x`, platform: 'android' })).status).toBe(400);
  });
  it('DELETE removes only the caller own token', async () => {
    const res = await call('DELETE', TA, { token: T });
    expect(res.status).toBe(200);
    const del = w.admin!.log.find((q) => q.table === 'holler_push_tokens' && q.op === 'delete')!;
    expect(del.eqOf('token')).toBe(T);
    expect(del.eqOf('user_id')).toBe(UA);
  });
  it('before migration 0020: 503 not_configured', async () => {
    w.adminHandler = (q) => (q.table === 'holler_push_tokens' ? { error: { code: '42P01', message: 'relation does not exist' } } : undefined);
    const res = await call('POST', TA, { token: T, platform: 'android' });
    expect(res.status).toBe(503);
  });
  it('signed out is 401', async () => {
    expect((await call('POST', null, { token: T, platform: 'ios' })).status).toBe(401);
    expect((await call('DELETE', null, { token: T })).status).toBe(401);
  });
  // Changed in round 7 (fix-f): the extra rows were only disabled, so the table grew without limit. They are now deleted.
  it('keeps at most 10 devices: the oldest beyond that are deleted, not just disabled', async () => {
    w.adminHandler = (q) =>
      q.table === 'holler_push_tokens' && q.op === 'select' ? { data: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, last_seen_at: 'x', disabled_at: null })) } : undefined;
    await call('POST', TA, { token: T, platform: 'ios' });
    const del = w.admin!.log.find((q) => q.table === 'holler_push_tokens' && q.op === 'delete')!;
    expect(del.filters.find((f) => f[0] === 'in')?.[2]).toEqual(['t10', 't11']);
    expect(del.eqOf('user_id')).toBe(UA);
  });
  it('registration is limited per member (20 an hour)', async () => {
    for (let i = 0; i < 20; i++) expect((await call('POST', TA, { token: `${T}${i}`, platform: 'ios' })).status).toBe(200);
    expect((await call('POST', TA, { token: `${T}x`, platform: 'ios' })).status).toBe(429);
  });
});

describe('GET /api/m/check (public)', () => {
  let hits: unknown[];
  beforeEach(() => {
    hits = [];
    vi.doMock('@/lib/auth/ratelimit', async (orig) => ({
      ...(await orig<typeof import('../../lib/auth/ratelimit')>()),
      hit: async (l: unknown) => (hits.push(l), w.users.__limited ? 'limited' : 'allowed'),
    }));
    vi.doMock('@/lib/check/load', () => ({
      loadCheck: async () => ({
        ok: true,
        checkedAt: '2026-11-19T00:00:00Z',
        items: [{ id: 7, kind: 'report', source: 'spc', title: 'Hail 1.00 in', url: 'javascript:alert(1)', place: 'Smyrna, GA', lat: 33.9, lon: -84.5, occurredAt: '2026-11-18T00:00:00Z', severity: 2 }],
      }),
    }));
  });
  const get = async (qs: string) => (await import('../../app/api/m/check/route')).GET(req(`/api/m/check${qs}`));
  it('works without a token, uses the web limiter, groups results', async () => {
    const res = await get('?zip=30080&trade=roofing');
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ ok: true, mode: 'results', place: { zip: '30080', state: 'GA' }, trade: { id: 'roofing' } });
    expect(b.groups[0].items[0]).toMatchObject({ id: 7, sourceLabel: 'NOAA Storm Prediction Center storm reports', url: null });
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits[0])).toMatch(/"max":15,"windowSeconds":60/);
  });
  it('over the limit: mode limited, nothing read', async () => {
    (w.users as Record<string, unknown>).__limited = { id: 'x', email: '' };
    const b = await (await get('?zip=30080&trade=roofing')).json();
    expect(b.mode).toBe('limited');
    expect(b.groups).toEqual([]);
  });
  it('bad input is 400 with the web form message', async () => {
    expect((await get('?zip=123&trade=roofing')).status).toBe(400);
    expect((await get('?zip=30080&trade=astronaut')).status).toBe(400);
    expect((await get('')).status).toBe(400);
    expect((await get('?zip=00000&trade=roofing')).status).toBe(400);
  });
});

describe('GET /api/m/config (public)', () => {
  it('prices and trial days come from lib/plan/public-prices.ts', async () => {
    const { PUBLIC_PRICES } = await import('../../lib/plan/public-prices');
    const res = await (await import('../../app/api/m/config/route')).GET(req('/api/m/config', { origin: 'capacitor://localhost' }));
    const b = await res.json();
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(b.trialDays).toBe(PUBLIC_PRICES.trialDays);
    expect(b.trialDays).toBe(14);
    expect(b.plans.solo.monthly).toMatchObject({ productId: 'com.localholler.app.solo.monthly', cents: PUBLIC_PRICES.plans.solo.monthly.cents, display: PUBLIC_PRICES.plans.solo.monthly.display });
    expect(b.plans.solo.yearly.productId).toBe('com.localholler.app.solo.yearly');
    expect(b.plans.pro.monthly.productId).toBe('com.localholler.app.pro.monthly');
    expect(b.plans.pro.yearly).toMatchObject({ productId: 'com.localholler.app.pro.yearly', cents: PUBLIC_PRICES.plans.pro.annual.cents });
    expect(b.plans.solo.name).toBe('Solo');
    expect(b.entitlements).toEqual(['solo', 'pro']);
    expect(b.offeringId).toBe('default');
    expect(b.links).toMatchObject({ terms: 'https://localholler.test/terms', privacy: 'https://localholler.test/privacy' });
    expect(b.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(b.trades.length).toBeGreaterThan(5);
    expect(b.trades[0]).toHaveProperty('label');
  });
});
