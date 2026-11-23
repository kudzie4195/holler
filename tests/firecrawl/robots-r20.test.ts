import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTokenMatches, checkRobots, crawlDelayWaitMs, FIRECRAWL_AGENTS, HOLLER_AGENTS, noteFetch, resetRobotsCache, robotsAllows, robotsCrawlDelay } from '@/lib/firecrawl/robots';
import { HOLLER_UA } from '@/lib/user-agent';
import { runLocalBidSource, type PipelineDeps } from '@/lib/firecrawl/pipeline';
import { localSourceById } from '@/lib/firecrawl/local-sources';
import { resetRunSpend } from '@/lib/firecrawl/budget';
import { fixtureScript, mockClient } from './fakes';
import { NOW_LIVE } from './helpers';

/**
 * Round 20 review P1-1 / P2-1 / P2-2 / P2-3 / P3: lib/firecrawl/robots.ts is shared by the live Atlanta Firecrawl feeds and the page watch.
 * robots.txt now fails closed on 401, 403, 429, an HTML or non-text answer and a redirect to another host; Crawl-delay is read and honoured;
 * group tokens match exactly; one user agent.
 */

const PAGE = 'https://www.example-agency.gov/purchasing/bids';
type Answer = { status: number; body?: string; type?: string | null; location?: string };

function robotsFetch(answers: Record<string, Answer>) {
  const calls: Array<{ url: string; ua: string | undefined; redirect: string | undefined }> = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: (init?.headers as Record<string, string> | undefined)?.['User-Agent'], redirect: init?.redirect });
    const a = answers[url] ?? { status: 404 };
    const headers: Record<string, string> = {};
    if (a.type !== null) headers['content-type'] = a.type ?? 'text/plain; charset=utf-8';
    if (a.location) headers.location = a.location;
    return new Response(a.status === 204 || (a.status >= 300 && a.status < 400) ? null : a.body ?? '', { status: a.status, headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const R = 'https://www.example-agency.gov/robots.txt';

beforeEach(() => {
  resetRobotsCache();
  resetRunSpend();
});

describe('fail closed', () => {
  it.each([401, 403, 429, 500, 503])('robots.txt HTTP %i: unreachable, the page is not read', async (status) => {
    const { f } = robotsFetch({ [R]: { status } });
    expect(await checkRobots(PAGE, f, 0)).toMatchObject({ allowed: false, reason: 'unreachable' });
  });
  it.each([404, 410])('robots.txt HTTP %i: no file, everything allowed', async (status) => {
    const { f } = robotsFetch({ [R]: { status } });
    expect(await checkRobots(PAGE, f, 0)).toEqual({ allowed: true, checked: false, crawlDelaySec: null });
  });
  it('an HTML answer (login page, bot challenge, soft 404) is unreachable, by content type or by body', async () => {
    expect(await checkRobots(PAGE, robotsFetch({ [R]: { status: 200, body: '<html><body>Sign in</body></html>', type: 'text/html' } }).f, 0)).toMatchObject({ allowed: false, reason: 'unreachable' });
    resetRobotsCache();
    expect(await checkRobots(PAGE, robotsFetch({ [R]: { status: 200, body: '<!DOCTYPE html><html>Just a moment...</html>', type: 'text/plain' } }).f, 0)).toMatchObject({ allowed: false, reason: 'unreachable' });
  });
  it('a non-text answer (JSON, an image) is unreachable', async () => {
    expect(await checkRobots(PAGE, robotsFetch({ [R]: { status: 200, body: '{}', type: 'application/json' } }).f, 0)).toMatchObject({ allowed: false });
    resetRobotsCache();
    expect(await checkRobots(PAGE, robotsFetch({ [R]: { status: 200, body: 'GIF89a', type: 'image/gif' } }).f, 0)).toMatchObject({ allowed: false });
  });
  it('a redirect to another host is refused; one hop to the www twin is followed and that file is used', async () => {
    const off = robotsFetch({ [R]: { status: 301, location: 'https://login.vendor.com/robots.txt' } });
    expect(await checkRobots(PAGE, off.f, 0)).toMatchObject({ allowed: false, reason: 'unreachable', why: 'robots.txt redirects to login.vendor.com' });
    expect(off.calls).toHaveLength(1);
    expect(off.calls[0].redirect).toBe('manual');
    resetRobotsCache();
    const twin = robotsFetch({
      'https://example-agency.gov/robots.txt': { status: 301, location: 'https://www.example-agency.gov/robots.txt' },
      [R]: { status: 200, body: 'User-agent: *\nDisallow: /purchasing/\n' },
    });
    expect(await checkRobots('https://example-agency.gov/purchasing/bids', twin.f, 0)).toEqual({ allowed: false, reason: 'disallowed' });
    expect(twin.calls.map((c) => c.url)).toEqual(['https://example-agency.gov/robots.txt', R]);
  });
  it('a network error is unreachable; a plain text file is read', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await checkRobots(PAGE, boom, 0)).toMatchObject({ allowed: false, reason: 'unreachable' });
    resetRobotsCache();
    expect(await checkRobots(PAGE, robotsFetch({ [R]: { status: 200, body: 'User-agent: *\nAllow: /\n', type: null } }).f, 0)).toEqual({ allowed: true, checked: true, crawlDelaySec: null });
  });
  it('robots.txt is requested with the one Holler user agent', async () => {
    const { f, calls } = robotsFetch({ [R]: { status: 404 } });
    await checkRobots(PAGE, f, 0);
    expect(calls[0].ua).toBe(HOLLER_UA);
    expect(HOLLER_UA).toBe('Holler/1.0 (+https://localholler.com/bot)');
  });
});

describe('groups and tokens', () => {
  const TXT = 'User-agent: FirecrawlAgent\nAllow: /\n\nUser-agent: *\nDisallow: /\n';
  it("Firecrawl's group never grants a plain Holler fetch anything", () => {
    expect(robotsAllows(TXT, '/bids', FIRECRAWL_AGENTS)).toBe(true);
    expect(robotsAllows(TXT, '/bids', HOLLER_AGENTS)).toBe(false);
  });
  it('a group token matches exactly or with a version, never as a substring ("hollerith-bot" is not Holler)', () => {
    expect(agentTokenMatches('holler', 'holler')).toBe(true);
    expect(agentTokenMatches('Holler/1.0', 'holler')).toBe(true);
    expect(agentTokenMatches('hollerith-bot', 'holler')).toBe(false);
    expect(robotsAllows('User-agent: hollerith-bot\nDisallow: /\n\nUser-agent: *\nAllow: /\n', '/bids', HOLLER_AGENTS)).toBe(true);
    expect(robotsAllows('User-agent: Holler\nDisallow: /bids\n\nUser-agent: *\nAllow: /\n', '/bids', HOLLER_AGENTS)).toBe(false);
  });
});

describe('Crawl-delay', () => {
  it('is read from the chosen group', () => {
    expect(robotsCrawlDelay('User-agent: *\nCrawl-delay: 10\nDisallow: /x\n', HOLLER_AGENTS)).toBe(10);
    expect(robotsCrawlDelay('User-agent: Holler\nCrawl-delay: 2\n\nUser-agent: *\nCrawl-delay: 30\n', HOLLER_AGENTS)).toBe(2);
    expect(robotsCrawlDelay('User-agent: *\nDisallow: /x\n', HOLLER_AGENTS)).toBeNull();
  });
  it('the wait counts from the last page read of that origin', () => {
    expect(crawlDelayWaitMs(PAGE, 10, 1_000_000)).toBe(0);
    noteFetch(PAGE, 1_000_000);
    expect(crawlDelayWaitMs(PAGE, 10, 1_004_000)).toBe(6000);
    expect(crawlDelayWaitMs(PAGE, 10, 1_010_000)).toBe(0);
    expect(crawlDelayWaitMs('https://other.gov/x', 10, 1_004_000)).toBe(0);
  });
});

describe('the live Firecrawl feeds (bids-gwinnett) under the stricter rules', () => {
  const GW = localSourceById('bids-gwinnett')!;
  const ENV = { HOLLER_BIDS_ENABLED: '1', HOLLER_LOCAL_BIDS_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test-key-0000000000' };
  const GR = 'https://www.gwinnettcounty.com/robots.txt';
  const run = (answers: Record<string, Answer>, over: Partial<PipelineDeps> = {}) => {
    const c = mockClient(fixtureScript('bids-gwinnett', 'changed'));
    const { f } = robotsFetch(answers);
    return runLocalBidSource(GW, { fetch: f, env: ENV, now: NOW_LIVE, log: () => undefined, db: null, makeClient: () => c.client, ...over }).then((r) => ({ r, c }));
  };
  it.each([401, 403, 429])('robots.txt HTTP %i: skipped as robots_unreachable, no Firecrawl call (it was "allowed" before)', async (status) => {
    const { r, c } = await run({ [GR]: { status } });
    expect(r.reason).toBe('robots_unreachable');
    expect(c.calls).toHaveLength(0);
  });
  it('an HTML robots answer: no Firecrawl call', async () => {
    const { r, c } = await run({ [GR]: { status: 200, body: '<html>blocked</html>', type: 'text/html' } });
    expect(r.reason).toBe('robots_unreachable');
    expect(c.calls).toHaveLength(0);
  });
  it('Firecrawl reads with its own groups: a FirecrawlAgent allow still lets it run', async () => {
    const { r } = await run({ [GR]: { status: 200, body: 'User-agent: FirecrawlAgent\nAllow: /\n\nUser-agent: *\nDisallow: /\n' } });
    expect(r.status).toBe('ok');
  });
  it('a Crawl-delay not met since the last read of that host: skipped as crawl_delay, no Firecrawl call', async () => {
    noteFetch(GW.listUrl, Date.now());
    const { r, c } = await run({ [GR]: { status: 200, body: 'User-agent: *\nCrawl-delay: 60\n' } });
    expect(r.reason).toBe('crawl_delay');
    expect(c.calls).toHaveLength(0);
  });
  it('404 still means allowed (no robots.txt)', async () => {
    const { r } = await run({ [GR]: { status: 404 } });
    expect(r.status).toBe('ok');
  });
});
