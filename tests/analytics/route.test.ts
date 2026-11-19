// POST /api/e: validation, same-origin, cookie required, bots, privacy headers, rate limit, always 204.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Limit } from '@/lib/auth/limits';
import { EVENT_ROW_KEYS } from '@/lib/analytics/events';
import type { EventRow } from '@/lib/analytics/events';

vi.mock('server-only', () => ({}));

const SID = 'AbCdEfGhIjKlMnOpQrStUv';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let rows: EventRow[];
let hits: Limit[][];
let hitResult: 'allowed' | 'limited' | 'error';
let insertThrows = false;
let depsThrow = false;

async function load() {
  vi.resetModules();
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/analytics/deps', () => ({
    ingestDeps: () => {
      if (depsThrow) throw new Error('Supabase admin is not configured');
      return {
        hit: async (l: Limit[]) => (hits.push(l), hitResult),
        insert: async (r: EventRow) => {
          if (insertThrows) throw new Error('db down');
          rows.push(r);
        },
        siteUrl: 'https://holler.test',
        ip: (req: Request) => req.headers.get('x-forwarded-for') ?? 'unknown',
      };
    },
  }));
  return (await import('../../app/api/e/route')) as { POST: (r: Request) => Promise<Response> };
}

function req(body: unknown, init: { origin?: string | null; cookie?: string | null; ua?: string | null; headers?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: 'holler.test',
    'x-forwarded-for': init.ip ?? '203.0.113.7',
    ...(init.headers ?? {}),
  };
  if (init.origin !== null) headers.origin = init.origin ?? 'https://holler.test';
  if (init.cookie !== null) headers.cookie = init.cookie ?? `holler_sid=${SID}.20411`;
  if (init.ua !== null) headers['user-agent'] = init.ua ?? CHROME;
  return new Request('https://holler.test/api/e', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

const good = { name: 'visit', path: '/local/austin-tx' };

async function send(r: Request) {
  const { POST } = await load();
  const res = await POST(r);
  expect(res.status).toBe(204);
  expect(await res.text()).toBe('');
  return res;
}

afterEach(() => {
  rows = [];
  hits = [];
  hitResult = 'allowed';
  insertThrows = false;
  depsThrow = false;
  vi.doUnmock('@/lib/analytics/deps');
});
rows = [];
hits = [];
hitResult = 'allowed';

describe('POST /api/e stores a valid beacon', () => {
  it('stores exactly the allowed keys, nothing from headers', async () => {
    await send(req(good, { cookie: `holler_sid=${SID}.20411; holler_src=instagram.social.fall-storm; sb-token=secret` }));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([...EVENT_ROW_KEYS]);
    expect(rows[0]).toEqual({
      name: 'visit',
      session_id: SID,
      user_id: null,
      source: 'instagram',
      medium: 'social',
      campaign: 'fall-storm',
      path: '/local/austin-tx',
    });
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/203\.0\.113|Mozilla|Chrome|secret|holler\.test/);
  });
  it('accepts all three browser events', async () => {
    for (const name of ['visit', 'area_check', 'app_open']) await send(req({ name, path: '/' }));
    expect(rows.map((r) => r.name)).toEqual(['visit', 'area_check', 'app_open']);
  });
  it('a bad path stores the event with a null path', async () => {
    await send(req({ name: 'visit', path: '/check?zip=30301' }));
    expect(rows[0].path).toBeNull();
  });
  it('a tampered holler_src is ignored, the event still counts', async () => {
    await send(req(good, { cookie: `holler_sid=${SID}.1; holler_src=<script>` }));
    expect(rows[0].source).toBeNull();
    expect(rows[0].session_id).toBe(SID);
  });
  it('the limiter key holds a hash, never the raw IP', async () => {
    await send(req(good, { ip: '198.51.100.99' }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toHaveLength(1);
    expect(hits[0][0].key).toMatch(/^event:ip:[0-9a-f]{32}$/);
    expect(hits[0][0].key).not.toContain('198.51');
    expect(hits[0][0].max).toBe(60);
    expect(hits[0][0].windowSeconds).toBe(600);
  });
});

describe('POST /api/e drops, and still answers 204', () => {
  const bodies: [string, unknown][] = [
    ['unknown name', { name: 'signup', path: '/' }],
    ['server-only name paid', { name: 'paid', path: '/' }],
    ['name not a string', { name: 5, path: '/' }],
    ['missing path key', { name: 'visit' }],
    ['extra key', { name: 'visit', path: '/', user_id: 'x' }],
    ['array', []],
    ['null', 'null'],
    ['not json', 'visit'],
    ['empty', ''],
    ['too large', { name: 'visit', path: '/' + 'a'.repeat(600) }],
  ];
  for (const [label, body] of bodies) {
    it(label, async () => {
      await send(req(body as never));
      expect(rows).toHaveLength(0);
      expect(hits).toHaveLength(0);
    });
  }
  it('a cross-site origin', async () => {
    await send(req(good, { origin: 'https://evil.example' }));
    expect(rows).toHaveLength(0);
  });
  it('no origin and no same-origin fetch metadata', async () => {
    await send(req(good, { origin: null }));
    expect(rows).toHaveLength(0);
  });
  it('no origin but Sec-Fetch-Site same-origin is accepted', async () => {
    await send(req(good, { origin: null, headers: { 'sec-fetch-site': 'same-origin' } }));
    expect(rows).toHaveLength(1);
  });
  it('Sec-Fetch-Site cross-site is dropped even with a matching origin header', async () => {
    await send(req(good, { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(rows).toHaveLength(0);
  });
  it('no cookie, a bad cookie', async () => {
    await send(req(good, { cookie: null }));
    await send(req(good, { cookie: 'holler_sid=short' }));
    await send(req(good, { cookie: `holler_sid=${SID}.notaday` }));
    expect(rows).toHaveLength(0);
    expect(hits).toHaveLength(0);
  });
  it('bots: crawlers, headless, empty UA, headless client hint', async () => {
    await send(req(good, { ua: 'Googlebot/2.1' }));
    await send(req(good, { ua: CHROME.replace('Chrome', 'HeadlessChrome') }));
    await send(req(good, { ua: null }));
    await send(req(good, { headers: { 'sec-ch-ua': '"HeadlessChrome";v="130"' } }));
    expect(rows).toHaveLength(0);
    expect(hits).toHaveLength(0);
  });
  it('Sec-GPC and DNT headers', async () => {
    await send(req(good, { headers: { 'sec-gpc': '1' } }));
    await send(req(good, { headers: { dnt: '1' } }));
    expect(rows).toHaveLength(0);
    expect(hits).toHaveLength(0);
  });
  it('over the rate limit', async () => {
    hitResult = 'limited';
    await send(req(good));
    expect(hits).toHaveLength(1);
    expect(rows).toHaveLength(0);
  });
  it('a limiter that errors stores nothing', async () => {
    hitResult = 'error';
    await send(req(good));
    expect(rows).toHaveLength(0);
  });
  it('a database that throws, and a service that is not configured', async () => {
    insertThrows = true;
    await send(req(good));
    insertThrows = false;
    depsThrow = true;
    await send(req(good));
    expect(rows).toHaveLength(0);
  });
});

describe('the rate limiter really counts (uses the shared hit()) ', () => {
  it('the 61st beacon from one address in a window is dropped', async () => {
    let n = 0;
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    const stored: EventRow[] = [];
    vi.doMock('@/lib/analytics/deps', () => ({
      ingestDeps: () => ({
        hit: async (l: Limit[]) => (++n <= l[0].max ? 'allowed' : 'limited'),
        insert: async (r: EventRow) => void stored.push(r),
        siteUrl: 'https://holler.test',
        ip: () => '203.0.113.7',
      }),
    }));
    const { POST } = (await import('../../app/api/e/route')) as { POST: (r: Request) => Promise<Response> };
    for (let i = 0; i < 70; i++) expect((await POST(req(good))).status).toBe(204);
    expect(stored).toHaveLength(60);
  });
});

describe('only POST', () => {
  it('exports no GET', async () => {
    const mod = (await load()) as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
  });
});
