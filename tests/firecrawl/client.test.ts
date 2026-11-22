import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirecrawlClient, estimateCredits, FirecrawlError, firecrawlApiKey, resetFirecrawlGate, scrub } from '@/lib/firecrawl/client';

const KEY = 'fc-TESTKEY1234567890abcdef';
const ok = (data: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ success: true, data, ...extra }), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, error: string, headers: Record<string, string> = {}) => new Response(JSON.stringify({ success: false, error }), { status, headers });
const noSleep = vi.fn(async () => undefined);

beforeEach(() => {
  resetFirecrawlGate();
  noSleep.mockClear();
});

function client(fetchImpl: typeof fetch, over: Partial<Parameters<typeof createFirecrawlClient>[0]> = {}) {
  return createFirecrawlClient({ apiKey: KEY, fetchImpl, sleep: noSleep, random: () => 1, baseDelayMs: 100, ...over });
}

describe('credits (documented formula)', () => {
  it('is 1 per scrape and +4 for a json format; change tracking adds nothing', () => {
    expect(estimateCredits(['markdown'])).toBe(1);
    expect(estimateCredits(['markdown', { type: 'changeTracking', tag: 'x' }])).toBe(1);
    expect(estimateCredits(['markdown', { type: 'json', schema: {} }])).toBe(5);
  });
});

describe('request shape', () => {
  it('POSTs to /v2/scrape with a bearer key and the formats, and parses markdown, json and change status', async () => {
    const f = vi.fn(async () => ok({ markdown: '# page', json: { solicitations: [] }, changeTracking: { changeStatus: 'changed', previousScrapeAt: '2026-11-21T00:00:00Z' }, metadata: { statusCode: 200 } }));
    const r = await client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov/b', formats: ['markdown', { type: 'changeTracking', tag: 't' }], maxAgeMs: 0 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.firecrawl.dev/v2/scrape');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body.url).toBe('https://x.gov/b');
    expect(body.formats).toEqual(['markdown', { type: 'changeTracking', tag: 't' }]);
    expect(body.maxAge).toBe(0);
    expect(r.markdown).toBe('# page');
    expect(r.changeStatus).toBe('changed');
    expect(r.creditsEstimated).toBe(1);
    expect(r.creditsReported).toBeNull(); // a single scrape response carries no credits field
  });

  it('returns the credits the API reports when it does', async () => {
    const f = vi.fn(async () => ok({ markdown: 'x', metadata: { statusCode: 200 } }, { creditsUsed: 5 }));
    expect((await client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] })).creditsReported).toBe(5);
  });

  it('reads the balance from GET /v2/team/credit-usage', async () => {
    const f = vi.fn(async () => ok({ remainingCredits: 912, planCredits: 1000, billingPeriodEnd: '2026-12-01T00:00:00Z' }));
    const u = await client(f as unknown as typeof fetch).creditUsage();
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://api.firecrawl.dev/v2/team/credit-usage');
    expect(u).toEqual({ remainingCredits: 912, planCredits: 1000, billingPeriodEnd: '2026-12-01T00:00:00Z' });
  });

  it('refuses an empty key and treats a blank env value as no key', () => {
    expect(() => createFirecrawlClient({ apiKey: '  ' })).toThrow(FirecrawlError);
    expect(firecrawlApiKey({ FIRECRAWL_API_KEY: '   ' })).toBeNull();
    expect(firecrawlApiKey({})).toBeNull();
    expect(firecrawlApiKey({ FIRECRAWL_API_KEY: ' fc-abc ' })).toBe('fc-abc');
  });
});

describe('errors and backoff', () => {
  it.each([429, 500, 502, 503, 504, 408])('retries HTTP %i with backoff and succeeds on the next try', async (status) => {
    const f = vi.fn().mockResolvedValueOnce(err(status, 'busy')).mockResolvedValueOnce(ok({ markdown: 'ok', metadata: { statusCode: 200 } }));
    const r = await client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] });
    expect(r.attempts).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it('doubles the wait each retry (jitter off) and stops after 3 attempts with a retryable error', async () => {
    const f = vi.fn(async () => err(503, 'down'));
    await expect(client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] })).rejects.toMatchObject({ code: 'server_error', status: 503, retryable: true, attempts: 3 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(noSleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([100, 200]);
  });

  it('honours Retry-After on a 429', async () => {
    const f = vi.fn().mockResolvedValueOnce(err(429, 'Rate limit exceeded', { 'retry-after': '4' })).mockResolvedValueOnce(ok({ markdown: 'x', metadata: {} }));
    await client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] });
    expect((noSleep.mock.calls[0] as unknown as [number])[0]).toBe(4000);
  });

  it.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [402, 'insufficient_credits'],
    [403, 'forbidden'],
  ])('does not retry HTTP %i', async (status, code) => {
    const f = vi.fn(async () => err(status, 'nope'));
    await expect(client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] })).rejects.toMatchObject({ code, status, retryable: false });
    expect(f).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('retries a network failure and reports it', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] })).rejects.toMatchObject({ code: 'network', attempts: 3 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('fails when the page itself answered 4xx or 5xx to Firecrawl', async () => {
    const f = vi.fn(async () => ok({ markdown: '', metadata: { statusCode: 403 } }));
    await expect(client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] })).rejects.toMatchObject({ code: 'target_error', status: 403 });
  });

  it('gives up when the wall-clock deadline leaves no time, without calling', async () => {
    const f = vi.fn(async () => ok({}));
    await expect(client(f as unknown as typeof fetch, { now: () => 1000 }).scrape({ url: 'https://x.gov', formats: ['markdown'], deadlineMs: 1200 })).rejects.toMatchObject({ code: 'timeout' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the key and the responses are never logged or put in an error', () => {
  it('keeps the key and the response body out of console output and out of error messages', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const secretBody = `leaked ${KEY} SENSITIVE-PAGE-TEXT-9876`;
    const f = vi.fn(async () => new Response(JSON.stringify({ success: false, error: secretBody, details: { page: 'SENSITIVE-PAGE-TEXT-9876' } }), { status: 500 }));
    let caught: FirecrawlError | null = null;
    try {
      await client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] });
    } catch (e) {
      caught = e as FirecrawlError;
    }
    expect(caught).toBeInstanceOf(FirecrawlError);
    const text = `${caught!.message} ${caught!.stack ?? ''} ${JSON.stringify(caught)}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('TESTKEY1234567890');
    expect(text).not.toContain('details');
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(KEY);
      s.mockRestore();
    }
  });

  it('scrubs key-shaped text', () => {
    expect(scrub(`token fc-abcdef1234567890 and ${KEY}`, KEY)).toBe('token [key] and [key]');
  });

  it('a successful response keeps no body text in the result beyond the page markdown and json asked for', async () => {
    const f = vi.fn(async () => ok({ markdown: 'm', json: { a: 1 }, metadata: { statusCode: 200, secret: 'S3CR3T' }, other: 'S3CR3T' }));
    const r = await client(f as unknown as typeof fetch).scrape({ url: 'https://x.gov', formats: ['markdown'] });
    expect(JSON.stringify(r)).not.toContain('S3CR3T');
  });
});

describe('server only', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  }
  it('no "use client" file under app/, components/ or lib/ imports lib/firecrawl', () => {
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'lib']) {
      for (const f of walk(path.join(root, dir))) {
        const src = readFileSync(f, 'utf8');
        if (/^\s*['"]use client['"]/m.test(src.slice(0, 400)) && /firecrawl/i.test(src.replace(/FIRECRAWL/g, ''))) offenders.push(path.relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the key is read from FIRECRAWL_API_KEY only, never from a NEXT_PUBLIC_ variable', () => {
    const src = readFileSync(path.resolve(__dirname, '../../lib/env.ts'), 'utf8');
    expect(src).toContain('FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY');
    expect(src).not.toMatch(/NEXT_PUBLIC_FIRECRAWL/);
  });
});
