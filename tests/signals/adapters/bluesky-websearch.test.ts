/**
 * Fixture provenance
 * - tests/fixtures/bluesky-search.json: shape (posts[].uri/cid/author.handle/record.text/record.createdAt/indexedAt) SOURCED from
 *   https://dev.to/agenthustler/scraping-bluesky-in-2026-at-protocol-makes-it-surprisingly-easy-56d6 (reads post.author.handle, post.record.text,
 *   post.record.createdAt) and the app.bsky.feed.defs#postView lexicon. Post text is ASSUMED (hand-written).
 * - tests/fixtures/websearch-brave.json: shape (web.results[].title/url/description/page_age) SOURCED from
 *   https://api-dashboard.search.brave.com/app/documentation/web-search/get-started (only title/url/description are documented there; page_age is ASSUMED).
 * - tests/fixtures/websearch-serper.json: shape (organic[].title/link/snippet/date/position) PARTLY SOURCED from the sample JSON on https://serper.dev/
 *   (title, link, snippet, position, date). Request side is ASSUMED. Result text is hand-written.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, classifyText } from '@/lib/signals/categories';
import { adapters as bskyAdapters, buildBlueskyUrl, parseBluesky, planBlueskyQueries, postUrl } from '@/lib/signals/adapters/bluesky';
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
