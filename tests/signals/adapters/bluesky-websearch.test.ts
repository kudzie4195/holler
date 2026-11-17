/**
 * Fixture provenance (re-checked 2026-11-17)
 * - tests/fixtures/bluesky-search.json: SOURCED for shape: app.bsky.feed.searchPosts output { posts[] (app.bsky.feed.defs#postView: uri, cid, author{did,handle},
 *   record{text,createdAt}, indexedAt), cursor, hitsTotal } from https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/searchPosts.json
 *   and the walkthrough https://dev.to/agenthustler/scraping-bluesky-in-2026-at-protocol-makes-it-surprisingly-easy-56d6. Post text is hand-written.
 *   AUTH: unauthenticated searchPosts returns HTTP 403 (HTML body) on public.api.bsky.app and api.bsky.app as of Sep-Nov 2026
 *   (https://github.com/cyanheads/bluesky-mcp-server/issues/32, https://github.com/kamoras/civitas/pull/594, https://github.com/Rackbops/docket/issues/125).
 *   The adapter logs in with an app password (com.atproto.server.createSession on bsky.social, lexicon fetched from the atproto repo) and proxies to the AppView.
 *   The createSession response body used in the tests is hand-written from the lexicon (accessJwt, refreshJwt, handle, did, didDoc). ASSUMED: that the PDS
 *   proxy route (atproto-proxy: did:web:api.bsky.app#bsky_appview) accepts searchPosts for an app-password session today; no live call was possible.
 * - tests/fixtures/websearch-brave.json: SOURCED for field names: web.results[] title, url, description, page_age, age, type "search_result" from
 *   https://api-dashboard.search.brave.com/api-reference/web/search/get (fetched), request parameters q, count (max 20), freshness pd|pw|pm|py, country, search_lang and
 *   the X-Subscription-Token header from https://api-dashboard.search.brave.com/app/documentation/web-search/get-started. page_age format (ISO without zone) is ASSUMED.
 *   Result text is hand-written.
 * - tests/fixtures/websearch-serper.json: SOURCED for response: organic[] title, link, snippet, position, date (https://serper.dev/ sample JSON; OpenAPI at
 *   https://apis.io/apis/serper/serper-search-api/). Request SOURCED from two independent places: that OpenAPI listing (POST https://google.serper.dev/search, header
 *   X-API-KEY, body q, gl, hl, num 1..100, page, tbs qdr:h|d|w|m|y, autocorrect) and https://docs.rs/crate/spider_agent/2.51.6/source/src/search/serper.rs.
 *   Result text is hand-written.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, classifyText } from '@/lib/signals/categories';
import { adapters as bskyAdapters, buildBlueskyUrl, parseBluesky, planBlueskyQueries, postUrl, resetBlueskySession } from '@/lib/signals/adapters/bluesky';
import {
  ASK_TERMS,
  QUERY_BUDGET,
  adapters as webAdapters,
  allCombos,
  looksLikeRequest,
  parseBrave,
  parseSerper,
  planQueries,
  resolveCityFromText,
  websearchProvider,
} from '@/lib/signals/adapters/websearch';

const fx = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'));
const NOW = new Date('2026-11-16T12:00:00Z');

describe('looksLikeRequest', () => {
  const asks = [
    'Anyone know a good plumber in Marietta GA?',
    'Can anyone recommend a reliable roofer near Austin?',
    'Looking for a house cleaner in Denver, any recs?',
    'We need a landscaper in Raleigh, who do you use?',
    'Please recommend an electrician',
    'Best roofer in Atlanta?',
    'Recommendations for a tree service in Tampa',
  ];
  const nonAsks = [
    'We offer roof repair in Atlanta. Call us today for a free estimate!',
    'Highly recommend Joe Plumbing in Atlanta, fixed my sink fast',
    'Top 10 Best Roofers in Atlanta, GA - Updated 2026',
    'Best plumbers in Atlanta reviews and ratings',
    'Now hiring plumbers in Dallas',
    'The weather in Atlanta is nice today',
    'ok',
    '',
  ];
  for (const t of asks) it(`accepts: ${t}`, () => expect(looksLikeRequest(t)).toBe(true));
  for (const t of nonAsks) it(`rejects: ${t || '(empty)'}`, () => expect(looksLikeRequest(t)).toBe(false));
});

describe('resolveCityFromText', () => {
  it('resolves "in <City> <ST>", "<City>, <ST>" and aliases', () => {
    expect(resolveCityFromText('need a plumber in Marietta GA')?.slug).toBe('marietta-ga');
    expect(resolveCityFromText('roofer near Austin, TX please')?.slug).toBe('austin-tx');
    expect(resolveCityFromText('house cleaner in NYC?')?.slug).toBe('new-york-city-ny');
  });
  it('uses the stated state to disambiguate and lowercases only big cities', () => {
    expect(resolveCityFromText('plumber in Columbus OH')?.state).toBe('OH');
    expect(resolveCityFromText('plumber in houston')?.slug).toBe('houston-tx');
  });
  it('does not resolve bare common words or missing places', () => {
    expect(resolveCityFromText('I want an orange roof')).toBeNull();
    expect(resolveCityFromText('anyone know a good electrician?')).toBeNull();
    expect(resolveCityFromText('')).toBeNull();
  });
});

describe('parseBluesky', () => {
  const out = parseBluesky(fx('bluesky-search.json'), NOW);
  it('keeps only the two real asks that name a place', () => {
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.kind === 'ask' && s.source === 'bluesky')).toBe(true);
  });
  it('stores snippet, handle and post URL only, with resolved city', () => {
    const p = out.find((s) => s.externalId.endsWith('3kxyz111'))!;
    expect(p.url).toBe('https://bsky.app/profile/jamie.bsky.social/post/3kxyz111');
    expect(p.data).toEqual({ handle: 'jamie.bsky.social', approxLocation: true });
    expect(p.categories).toContain('plumbing');
    expect(p.city).toBe('Marietta');
    expect(p.state).toBe('GA');
    expect((p.summary ?? '').length).toBeLessThanOrEqual(280);
    expect(p.occurredAt).toBe('2026-11-15T22:10:00.000Z');
    expect(out.find((s) => s.externalId.endsWith('3kxyz222'))!.categories).toContain('roofing');
  });
  it('rejects promo, answers and posts with no place', () => {
    const ids = out.map((s) => s.externalId);
    for (const n of ['3kxyz333', '3kxyz444', '3kxyz555']) expect(ids.some((i) => i.endsWith(n))).toBe(false);
  });
  it('truncates long text to 280 chars', () => {
    const long = `Anyone know a good plumber in Marietta GA? ${'x'.repeat(500)}`;
    const r = parseBluesky({ posts: [{ uri: 'at://d/app.bsky.feed.post/k1', author: { handle: 'a.b' }, record: { text: long, createdAt: '2026-11-15T00:00:00Z' } }] }, NOW);
    expect(r).toHaveLength(1);
    expect(r[0].summary!.length).toBeLessThanOrEqual(280);
  });
  it('postUrl builds from handle + rkey', () => expect(postUrl('x.y', 'at://did/app.bsky.feed.post/abc')).toBe('https://bsky.app/profile/x.y/post/abc'));
  it('query plan is built from CATEGORIES, rotates, and every term classifies back to its category', () => {
    const a = planBlueskyQueries(new Date('2026-11-16T12:00:00Z'));
    const b = planBlueskyQueries(new Date('2026-11-16T13:00:00Z'));
    expect(a).toHaveLength(12);
    expect(a.map((x) => x.q)).not.toEqual(b.map((x) => x.q));
    expect(a).toEqual(planBlueskyQueries(new Date('2026-11-16T12:30:00Z')));
    for (const c of CATEGORIES) expect(classifyText(ASK_TERMS[c.id])).toContain(c.id);
  });
  it('URL has since, sort=latest, limit', () => {
    const u = new URL(buildBlueskyUrl('"need a plumber"', NOW));
    expect(u.hostname).toBe('public.api.bsky.app');
    expect(u.searchParams.get('sort')).toBe('latest');
    expect(u.searchParams.get('since')).toBe(NOW.toISOString());
  });
  it('declares no env requirement and logs a 403 clearly, returning []', async () => {
    expect(bskyAdapters[0].requiresEnv).toBeUndefined();
    const logs: string[] = [];
    const out2 = await bskyAdapters[0].fetch({ since: NOW, env: {}, log: (m) => logs.push(m), fetch: (async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch });
    expect(out2).toEqual([]);
    expect(logs.some((l) => l.includes('403') && l.includes('auth'))).toBe(true);
  });
});

describe('websearch parsers', () => {
  it('Brave: keeps the two genuine asks; drops listicle, advertiser and blocked hosts; strips HTML', () => {
    const out = parseBrave(fx('websearch-brave.json'), { now: NOW });
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.kind === 'ask' && s.source === 'websearch-brave')).toBe(true);
    const r = out.find((s) => s.url!.includes('roofer-atlanta'))!;
    expect(r.city).toBe('Atlanta');
    expect(r.categories).toContain('roofing');
    expect(r.summary).not.toContain('<strong>');
    expect(r.data).toEqual({ host: 'www.example-forum.com', approxLocation: true });
    const l = out.find((s) => s.url!.includes('thread/777'))!;
    expect(l.city).toBe('Roswell');
    expect(l.categories).toContain('landscaping');
    expect(out.some((s) => s.url!.includes('yelp.com'))).toBe(false);
    expect(out.some((s) => s.url!.includes('acmeroofing'))).toBe(false);
  });
  it('Serper: keeps the two asks and drops the ad', () => {
    const out = parseSerper(fx('websearch-serper.json'), { now: NOW });
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.city === 'Austin' && s.categories.includes('plumbing'))).toBe(true);
    expect(out.find((s) => s.url!.includes('plumber-help'))!.occurredAt).toBe(new Date('Nov 14, 2026').toISOString());
  });
  it('falls back to the query city only when its name appears in the text', () => {
    const austin = allCombos().find((c) => c.city.slug === 'austin-tx')!.city;
    const raw = { organic: [{ title: 'Anyone know a good plumber?', link: 'https://f.example/a', snippet: 'Austin folks, anyone recommend a plumber for a leaking pipe?' }, { title: 'Anyone know a good plumber?', link: 'https://f.example/b', snippet: 'anyone recommend a plumber for a leaking pipe?' }] };
    const out = parseSerper(raw, { queryCity: austin, now: NOW });
    expect(out.map((s) => s.url)).toEqual(['https://f.example/a']);
  });
});

describe('websearch query plan', () => {
  it('stays within the 40 query budget, is deterministic, and rotates without overlap between consecutive runs', () => {
    const t0 = new Date('2026-11-16T12:00:00Z');
    const t1 = new Date(t0.getTime() + 6 * 3_600_000);
    const p0 = planQueries(t0, 360);
    const p1 = planQueries(t1, 360);
    expect(p0).toHaveLength(QUERY_BUDGET);
    expect(planQueries(t0, 360).map((q) => q.q)).toEqual(p0.map((q) => q.q));
    const s0 = new Set(p0.map((q) => q.q));
    expect(p1.some((q) => s0.has(q.q))).toBe(false);
    expect(p0[0].q).toMatch(/^anyone recommend a .+ in .+ [A-Z]{2}$/);
  });
  it('covers every combo across a full cycle', () => {
    const total = allCombos().length;
    const runs = Math.ceil(total / QUERY_BUDGET);
    const seen = new Set<string>();
    for (let i = 0; i < runs; i++) planQueries(new Date(i * 360 * 60_000), 360).forEach((q) => seen.add(q.q));
    expect(seen.size).toBe(total);
  });
});

describe('websearch adapters and env', () => {
  it('provider selection', () => {
    expect(websearchProvider({})).toBe('skipped(env)');
    expect(websearchProvider({ SERPER_API_KEY: 'a' })).toBe('serper');
    expect(websearchProvider({ SERPER_API_KEY: 'a', BRAVE_SEARCH_API_KEY: 'b' })).toBe('brave');
  });
  it('each adapter requires exactly its own key', () => {
    expect(webAdapters.map((a) => [a.id, a.requiresEnv])).toEqual([
      ['websearch-brave', ['BRAVE_SEARCH_API_KEY']],
      ['websearch-serper', ['SERPER_API_KEY']],
    ]);
  });
  it('Brave adapter issues <= 40 requests per run with the token header and freshness', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push({ url: u, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify(fx('websearch-brave.json')), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await webAdapters[0].fetch({ since: NOW, env: { BRAVE_SEARCH_API_KEY: 'bk' }, log: () => {}, fetch: f });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(40);
    expect(calls[0].headers['X-Subscription-Token']).toBe('bk');
    expect(calls[0].url).toContain('freshness=pw');
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(out.map((s) => s.externalId)).size).toBe(out.length);
  });
  it('Serper adapter steps aside when a Brave key exists and never throws', async () => {
    const f = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    expect(await webAdapters[1].fetch({ since: NOW, env: { SERPER_API_KEY: 's', BRAVE_SEARCH_API_KEY: 'b' }, log: () => {}, fetch: f })).toEqual([]);
    expect(await webAdapters[1].fetch({ since: NOW, env: { SERPER_API_KEY: 's' }, log: () => {}, fetch: f })).toEqual([]);
    expect(await webAdapters[0].fetch({ since: NOW, env: {}, log: () => {}, fetch: f })).toEqual([]);
  });
});

// --- Failure modes and auth --------------------------------------------------------------------------

const ERROR_LIKE = /\b(error|failed|failure|timeout|timed out|http\s?[45]\d\d|status\s?[45]\d\d)\b/i; // same pattern as lib/signals/run.ts

type Call = { url: string; init?: RequestInit };
async function runAdapter(a: (typeof bskyAdapters)[number], f: (c: Call) => Response | Promise<Response>, env: Record<string, string | undefined> = {}) {
  const logs: string[] = [];
  const calls: Call[] = [];
  const fetchImpl = (async (u: unknown, init?: RequestInit) => {
    const c = { url: String(u), init };
    calls.push(c);
    return f(c);
  }) as unknown as typeof fetch;
  const out = await a.fetch({ since: NOW, fetch: fetchImpl, env, log: (m) => logs.push(m) });
  return { out, logs, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const forbiddenHtml = () => new Response('<html><body>403 Forbidden. Request forbidden by administrative rules.</body></html>', { status: 403 });

function jwt(expSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256K' })}.${b64({ exp: expSeconds })}.sig`;
}
const sessionBody = (pds = 'https://morel.us-east.host.bsky.network', exp = Math.floor(Date.now() / 1000) + 7200) => ({
  accessJwt: jwt(exp),
  refreshJwt: 'refresh-1',
  handle: 'holler.example.com',
  did: 'did:plc:abc123',
  didDoc: { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }] },
  active: true,
});

describe('bluesky auth', () => {
  beforeEach(() => resetBlueskySession());

  it('without credentials: tries the keyless public host, and a 403 HTML page logs an error that names the env keys', async () => {
    const r = await runAdapter(bskyAdapters[0], forbiddenHtml);
    expect(r.out).toEqual([]);
    expect(r.calls).toHaveLength(4); // first batch only, then stops
    expect(r.calls[0].url.startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?')).toBe(true);
    expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes('403') && l.includes('BLUESKY_HANDLE') && l.includes('BLUESKY_APP_PASSWORD'))).toBe(true);
  });

  it('keyless success still works if Bluesky reopens search', async () => {
    const r = await runAdapter(bskyAdapters[0], () => json(fx('bluesky-search.json')));
    expect(r.out.length).toBeGreaterThan(0);
    expect(r.logs).toEqual([]);
  });

  it('with credentials: createSession on bsky.social, then searchPosts on the PDS with Bearer + atproto-proxy', async () => {
    const r = await runAdapter(
      bskyAdapters[0],
      (c) => (c.url.includes('com.atproto.server.createSession') ? json(sessionBody()) : json(fx('bluesky-search.json'))),
      { BLUESKY_HANDLE: 'holler.example.com', BLUESKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' },
    );
    const login = r.calls[0];
    expect(login.url).toBe('https://bsky.social/xrpc/com.atproto.server.createSession');
    expect(login.init?.method).toBe('POST');
    expect(JSON.parse(String(login.init?.body))).toEqual({ identifier: 'holler.example.com', password: 'abcd-efgh-ijkl-mnop' });
    const search = r.calls[1];
    expect(search.url.startsWith('https://morel.us-east.host.bsky.network/xrpc/app.bsky.feed.searchPosts?')).toBe(true);
    const h = search.init?.headers as Record<string, string>;
    expect(h.Authorization).toMatch(/^Bearer /);
    expect(h['atproto-proxy']).toBe('did:web:api.bsky.app#bsky_appview');
    expect(r.out.length).toBeGreaterThan(0);
    expect(r.logs).toEqual([]);
  });

  it('reuses the cached session on the next run instead of logging in again', async () => {
    const env = { BLUESKY_HANDLE: 'holler.example.com', BLUESKY_APP_PASSWORD: 'pw' };
    const f = (c: Call) => (c.url.includes('createSession') ? json(sessionBody()) : json(fx('bluesky-search.json')));
    const first = await runAdapter(bskyAdapters[0], f, env);
    const second = await runAdapter(bskyAdapters[0], f, env);
    expect(first.calls.filter((c) => c.url.includes('createSession'))).toHaveLength(1);
    expect(second.calls.filter((c) => c.url.includes('createSession'))).toHaveLength(0);
  });

  it('refreshes an expiring session with refreshSession before creating a new one', async () => {
    const env = { BLUESKY_HANDLE: 'holler.example.com', BLUESKY_APP_PASSWORD: 'pw' };
    const soon = Math.floor(Date.now() / 1000) + 60; // inside the 5 minute renewal window
    await runAdapter(bskyAdapters[0], (c) => (c.url.includes('createSession') ? json(sessionBody(undefined, soon)) : json({ posts: [] })), env);
    const second = await runAdapter(
      bskyAdapters[0],
      (c) => (c.url.includes('refreshSession') ? json(sessionBody()) : json({ posts: [] })),
      env,
    );
    expect(second.calls[0].url).toBe('https://morel.us-east.host.bsky.network/xrpc/com.atproto.server.refreshSession');
    expect((second.calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer refresh-1');
    expect(second.calls.some((c) => c.url.includes('createSession'))).toBe(false);
  });

  it('a wrong app password logs an error and makes no search calls', async () => {
    const r = await runAdapter(bskyAdapters[0], () => json({ error: 'AuthenticationRequired' }, 401), { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'bad' });
    expect(r.out).toEqual([]);
    expect(r.calls).toHaveLength(1);
    expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes('401') && /app password/i.test(l))).toBe(true);
  });

  it('createSession rate limiting (429) and a session body without tokens both log errors', async () => {
    const env = { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' };
    const limited = await runAdapter(bskyAdapters[0], () => json({}, 429), env);
    expect(limited.logs.some((l) => ERROR_LIKE.test(l) && l.includes('429'))).toBe(true);
    resetBlueskySession();
    const odd = await runAdapter(bskyAdapters[0], () => json({ token: 'x' }), env);
    expect(odd.logs.some((l) => ERROR_LIKE.test(l) && /accessJwt/.test(l))).toBe(true);
  });

  it('a 403 even with a session logs an error and stops', async () => {
    const r = await runAdapter(bskyAdapters[0], (c) => (c.url.includes('createSession') ? json(sessionBody()) : forbiddenHtml()), { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' });
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes('403'))).toBe(true);
  });
});

describe('bluesky failure modes', () => {
  beforeEach(() => resetBlueskySession());
  for (const status of [429, 500, 502]) {
    it(`HTTP ${status} logs an error-like line`, async () => {
      const r = await runAdapter(bskyAdapters[0], () => new Response('x', { status }));
      expect(r.out).toEqual([]);
      expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes(String(status)))).toBe(true);
    });
  }
  it('an HTML page with 200 logs an error', async () => {
    const r = await runAdapter(bskyAdapters[0], () => new Response('<html>cdn challenge</html>', { status: 200 }));
    expect(r.logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('a changed wrapper key (no posts array in any response) logs an error', async () => {
    const r = await runAdapter(bskyAdapters[0], () => json({ results: [{ uri: 'x' }] }));
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => /no posts array/.test(l) && ERROR_LIKE.test(l))).toBe(true);
  });
  it('posts with no uri/author/text logs the silent-empty error', async () => {
    const r = await runAdapter(bskyAdapters[0], () => json({ posts: [{ id: 1 }, { id: 2 }] }));
    expect(r.logs.some((l) => /parsed 0 of \d+ rows, shape may have changed/.test(l))).toBe(true);
  });
  it('an empty posts array is a quiet hour', async () => {
    const r = await runAdapter(bskyAdapters[0], () => json({ posts: [] }));
    expect(r.logs).toEqual([]);
  });
});

describe('websearch failure modes and request shape', () => {
  const braveEnv = { BRAVE_SEARCH_API_KEY: 'bk' };
  const serperEnv = { SERPER_API_KEY: 'sk' };

  it('Brave: GET with X-Subscription-Token, freshness=pw, count 10 and a documented country/search_lang', async () => {
    const r = await runAdapter(webAdapters[0], () => json(fx('websearch-brave.json')), braveEnv);
    const u = new URL(r.calls[0].url);
    expect(u.origin + u.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(u.searchParams.get('freshness')).toBe('pw');
    expect(Number(u.searchParams.get('count'))).toBeLessThanOrEqual(20);
    expect(u.searchParams.get('country')).toBe('US');
    expect((r.calls[0].init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('bk');
  });
  it('Serper: POST google.serper.dev/search with X-API-KEY and tbs qdr:w in a JSON body', async () => {
    const r = await runAdapter(webAdapters[1], () => json(fx('websearch-serper.json')), serperEnv);
    expect(r.calls[0].url).toBe('https://google.serper.dev/search');
    expect(r.calls[0].init?.method).toBe('POST');
    const h = r.calls[0].init?.headers as Record<string, string>;
    expect(h['X-API-KEY']).toBe('sk');
    expect(h['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(r.calls[0].init?.body));
    expect(body).toMatchObject({ gl: 'us', num: 10, tbs: 'qdr:w' });
    expect(typeof body.q).toBe('string');
  });

  const cases: [string, (typeof webAdapters)[number], Record<string, string>, unknown][] = [
    ['brave', webAdapters[0], braveEnv, fx('websearch-brave.json')],
    ['serper', webAdapters[1], serperEnv, fx('websearch-serper.json')],
  ];
  for (const [name, adapter, env, good] of cases) {
    describe(name, () => {
      it('parses the good fixture with no error log', async () => {
        const r = await runAdapter(adapter, () => json(good), env);
        expect(r.out.length).toBeGreaterThan(0);
        expect(r.logs.filter((l) => ERROR_LIKE.test(l))).toEqual([]);
      });
      for (const status of [401, 403, 422, 429, 500]) {
        it(`HTTP ${status} logs an error-like line and stops early`, async () => {
          const r = await runAdapter(adapter, () => new Response('{"error":"x"}', { status }), env);
          expect(r.out).toEqual([]);
          expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes(String(status)))).toBe(true);
          if (status === 401 || status === 403 || status === 429) expect(r.calls.length).toBeLessThanOrEqual(4);
        });
      }
      it('an HTML page with 200 logs an error', async () => {
        const r = await runAdapter(adapter, () => new Response('<html>captcha</html>', { status: 200 }), env);
        expect(r.out).toEqual([]);
        expect(r.logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
      });
      it('a changed wrapper key in every response logs an error', async () => {
        const r = await runAdapter(adapter, () => json({ results: [{ title: 't', url: 'https://x.test' }] }), env);
        expect(r.out).toEqual([]);
        expect(r.logs.some((l) => /results array, wrapper key may have changed/.test(l) && ERROR_LIKE.test(l))).toBe(true);
      });
      it('hits with no title or url logs the silent-empty error', async () => {
        const body = name === 'brave' ? { web: { results: [{ foo: 1 }, { bar: 2 }] } } : { organic: [{ foo: 1 }, { bar: 2 }] };
        const r = await runAdapter(adapter, () => json(body), env);
        expect(r.logs.some((l) => /parsed 0 of \d+ rows, shape may have changed/.test(l))).toBe(true);
      });
      it('hits that are simply not asks are a quiet day, not an error', async () => {
        const body =
          name === 'brave'
            ? { web: { results: [{ title: 'Atlanta Roofing Company', url: 'https://acme.example/atlanta', description: 'We offer roof repair. Call us today.' }] } }
            : { organic: [{ title: 'Atlanta Roofing Company', link: 'https://acme.example/atlanta', snippet: 'We offer roof repair. Call us today.' }] };
        const r = await runAdapter(adapter, () => json(body), env);
        expect(r.out).toEqual([]);
        expect(r.logs).toEqual([]);
      });
      it('a whole run of responses with no results key is treated as a changed wrapper', async () => {
        // one empty answer is normal (the API omits the key when there are no hits); 3 or more answers that all lack it is not
        const r = await runAdapter(adapter, () => json({ type: 'search', query: {} }), env);
        expect(r.logs.some((l) => /wrapper key may have changed/.test(l))).toBe(true);
      });
    });
  }
});
