// POST /api/interest: validation, same-origin, rate limit, missing table, signed-in upsert, signed-out insert, cookie content.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeInterest } from './helpers';

vi.mock('server-only', () => ({}));

type Fake = ReturnType<typeof fakeInterest>;
let fake: Fake;
let user: { id: string } | null = null;
let hasProfile = true;

async function load() {
  vi.resetModules();
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/interest/deps', () => ({ interestDeps: () => fake.deps }));
  vi.doMock('@/lib/auth/session', () => ({ getUser: async () => user, getProfile: async (id: string) => (hasProfile ? { user_id: id } : null) }));
  vi.doMock('@/lib/env', async (orig) => ({ ...(await orig<typeof import('@/lib/env')>()), siteUrl: 'https://holler.test' }));
  return (await import('../../app/api/interest/route')) as { POST: (r: Request) => Promise<Response> };
}

function req(body: unknown, init: { origin?: string | null; cookie?: string; ip?: string; type?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': init.type ?? 'application/json',
    host: 'holler.test',
    'x-forwarded-for': init.ip ?? '203.0.113.7',
  };
  if (init.origin !== null) headers.origin = init.origin ?? 'https://holler.test';
  if (init.cookie) headers.cookie = init.cookie;
  return new Request('https://holler.test/api/interest', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

afterEach(() => {
  user = null;
  hasProfile = true;
  vi.doUnmock('@/lib/interest/deps');
  vi.doUnmock('@/lib/auth/session');
  vi.doUnmock('@/lib/env');
});

describe('POST /api/interest validation', () => {
  it('rejects an unknown feature id with 400 and writes nothing', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    for (const feature of ['free-money', '', null, 5, undefined, ['gov-bids'], 'GOV-BIDS']) {
      const res = await POST(req({ feature, page: 'pricing' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'invalid' });
    }
    expect(fake.writes).toHaveLength(0);
    expect(fake.hits).toHaveLength(0);
  });

  it('rejects a body that is not an object, and a non-JSON content type', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    expect((await POST(req('not json'))).status).toBe(400);
    expect((await POST(req('[]'))).status).toBe(400);
    expect((await POST(req('null'))).status).toBe(400);
    expect((await POST(req({ feature: 'spanish' }, { type: 'application/x-www-form-urlencoded' }))).status).toBe(415);
    expect(fake.writes).toHaveLength(0);
  });

  it('refuses a cross-origin post with 403 and writes nothing', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden' });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(fake.writes).toHaveLength(0);
  });

  it('answers 429 when the existing limiter says limited, and writes nothing', async () => {
    fake = fakeInterest();
    fake.setHit('limited');
    const { POST } = await load();
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: 'limited' });
    expect(fake.writes).toHaveLength(0);
  });

  it('uses the shared limiter (holler_rate_hit keys): a keyed hash, never the raw IP', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    await POST(req({ feature: 'spanish', page: 'pricing' }, { ip: '198.51.100.77' }));
    expect(fake.hits).toHaveLength(1);
    expect(fake.hits[0][0].key).toMatch(/^interest:ip:[0-9a-f]{32}$/);
    expect(JSON.stringify(fake.hits)).not.toContain('198.51.100.77');
  });

  it('fails closed with a soft 503 when the limiter itself errors', async () => {
    fake = fakeInterest();
    fake.setHit('error');
    const { POST } = await load();
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(fake.writes).toHaveLength(0);
  });

  it('missing table (migration 0008 not applied): ok false with a soft error, no throw, no cookie', async () => {
    fake = fakeInterest({ missingTable: true });
    const { POST } = await load();
    const res = await POST(req({ feature: 'gov-bids', page: 'pricing' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('missing table for a signed-in member is the same soft error', async () => {
    fake = fakeInterest({ missingTable: true });
    user = { id: 'u-1' };
    const { POST } = await load();
    const res = await POST(req({ feature: 'gov-bids', page: 'app' }));
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
  });

  it('a dependency that throws (Supabase not configured) is a soft error, not a 500', async () => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/interest/deps', () => ({ interestDeps: () => { throw new Error('Supabase admin is not configured'); } }));
    vi.doMock('@/lib/auth/session', () => ({ getUser: async () => null, getProfile: async () => null }));
    const { POST } = (await import('../../app/api/interest/route')) as { POST: (r: Request) => Promise<Response> };
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('signed-in member', () => {
  it('upserts with the user id, and a repeat pick is a no-op that still answers ok', async () => {
    fake = fakeInterest();
    user = { id: 'u-1' };
    const { POST } = await load();
    const a = await POST(req({ feature: 'gov-bids', page: 'app' }));
    const b = await POST(req({ feature: 'gov-bids', page: 'app' }));
    expect(await a.json()).toEqual({ ok: true });
    expect(await b.json()).toEqual({ ok: true });
    expect(fake.rows).toHaveLength(1);
    expect(fake.writes.map((w) => w.op)).toEqual(['upsert', 'upsert']);
    expect(fake.writes[0].row).toEqual({ feature: 'gov-bids', user_id: 'u-1', page: 'app' });
    expect(fake.writes[0].opts).toEqual({ onConflict: 'feature,user_id', ignoreDuplicates: true });
  });

  it('different members each get a row; the limiter key is per user', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    user = { id: 'u-1' };
    await POST(req({ feature: 'spanish', page: 'app' }));
    user = { id: 'u-2' };
    await POST(req({ feature: 'spanish', page: 'app' }));
    expect(fake.rows).toHaveLength(2);
    expect(fake.hits[0][0].key).toMatch(/^interest:user:/);
  });
});

describe('signed-out visitor', () => {
  it('inserts a row with exactly feature, page and user_id null: no identifier of any kind', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const res = await POST(req({ feature: 'city-weekly', page: 'pricing' }, { ip: '198.51.100.9' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].op).toBe('insert');
    expect(Object.keys(fake.writes[0].row).sort()).toEqual(['feature', 'page', 'user_id']);
    expect(fake.writes[0].row).toEqual({ feature: 'city-weekly', page: 'pricing', user_id: null });
    expect(JSON.stringify(fake.writes)).not.toContain('198.51.100.9');
  });

  it('the answer holds only ok: no counts, no ids', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const body = await (await POST(req({ feature: 'spanish', page: 'pricing' }))).json();
    expect(Object.keys(body)).toEqual(['ok']);
  });

  it('P2-9: page is kept only when it is an allowed page id; anything else becomes null', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    await POST(req({ feature: 'gov-bids', page: 'pricing' }));
    await POST(req({ feature: 'spanish', page: 'Call me at 404 555 1212' }));
    await POST(req({ feature: 'asking-online', page: 'a'.repeat(80) }));
    await POST(req({ feature: 'city-weekly' }));
    expect(fake.writes.map((w) => w.row.page)).toEqual(['pricing', null, null, null]);
  });

  it('sets holler_picked with only feature ids: 180 days, Lax, first party, readable by script', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }));
    const c = res.headers.get('set-cookie')!;
    expect(c.startsWith('holler_picked=spanish;')).toBe(true);
    expect(c).toContain(`Max-Age=${180 * 86400}`);
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Secure');
    expect(c).not.toMatch(/HttpOnly/i);
    expect(c).not.toMatch(/Domain=/i);
    const value = decodeURIComponent(c.split(';')[0].split('=')[1]);
    expect(value.split(',').every((id) => ['gov-bids', 'spanish', 'asking-online', 'city-weekly'].includes(id))).toBe(true);
  });

  it('a second pick adds to the cookie list, in feature order, with no duplicates', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const res = await POST(req({ feature: 'gov-bids', page: 'pricing' }, { cookie: 'holler_picked=city-weekly%2Cspanish; other=1' }));
    const c = res.headers.get('set-cookie')!;
    expect(decodeURIComponent(c.split(';')[0].split('=')[1])).toBe('gov-bids,spanish,city-weekly');
  });

  it('a second click for the same feature from the same browser is refused, nothing is written or counted', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }, { cookie: 'holler_picked=spanish' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'already' });
    expect(fake.writes).toHaveLength(0);
    expect(fake.hits).toHaveLength(0);
  });

  it('junk in the cookie is ignored', async () => {
    fake = fakeInterest();
    const { POST } = await load();
    const res = await POST(req({ feature: 'spanish', page: 'pricing' }, { cookie: 'holler_picked=%E0%A4%A; x=y' }));
    expect(await res.json()).toEqual({ ok: true });
    const res2 = await POST(req({ feature: 'gov-bids', page: 'pricing' }, { cookie: 'holler_picked=evil,<script>,gov-bids2' }));
    expect(decodeURIComponent(res2.headers.get('set-cookie')!.split(';')[0].split('=')[1])).toBe('gov-bids');
  });

  it('P2-10: a signed-in user with no Holler profile is treated as signed out: user_id null, cookie set, plain insert', async () => {
    fake = fakeInterest();
    user = { id: 'u-noprofile' };
    hasProfile = false;
    const { POST } = await load();
    const res = await POST(req({ feature: 'gov-bids', page: 'pricing' }));
    expect(res.status).toBe(200);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].op).toBe('insert');
    expect(fake.writes[0].row).toEqual({ feature: 'gov-bids', page: 'pricing', user_id: null });
    expect(JSON.stringify(fake.writes)).not.toContain('u-noprofile');
    expect(res.headers.get('set-cookie')).toContain('gov-bids');
    expect(fake.hits[0][0].key).not.toMatch(/^interest:user:/);
  });

  it('P2-10: a signed-in user with a profile still gets user_id saved', async () => {
    fake = fakeInterest();
    user = { id: 'u-1' };
    const { POST } = await load();
    await POST(req({ feature: 'gov-bids', page: 'app' }));
    expect(fake.writes[0].row).toEqual({ feature: 'gov-bids', user_id: 'u-1', page: 'app' });
  });
});
