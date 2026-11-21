// POST /api/waitlist with the database call mocked: request rules, row shape, soft failure, no PII in logs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWaitlist, UNSERVED_ZIP } from './helpers';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ siteUrl: 'https://localholler.com' }));

const state: { fake: ReturnType<typeof fakeWaitlist>; throwOnDeps: boolean } = { fake: fakeWaitlist(), throwOnDeps: false };
vi.mock('@/lib/waitlist/deps', () => ({
  waitlistDeps: () => {
    if (state.throwOnDeps) throw new Error('Supabase is not configured: SUPABASE_URL for pat@example.com');
    return state.fake.deps;
  },
}));

import { POST } from '@/app/api/waitlist/route';

const good = { email: 'pat@example.com', zip: UNSERVED_ZIP, trade: 'roofing', page: 'check', leave_blank: '' };

function post(body: unknown, headers: Record<string, string> = {}, raw = false): Request {
  return new Request('https://localholler.com/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://localholler.com', 'x-forwarded-for': '198.51.100.7', ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  state.fake = fakeWaitlist();
  state.throwOnDeps = false;
  spies = (['error', 'log', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

const logged = () => JSON.stringify(spies.flatMap((s) => s.mock.calls));

describe('POST /api/waitlist', () => {
  it('saves the row and answers { ok: true } with no-store and no count', async () => {
    const res = await POST(post(good));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    expect(state.fake.rows).toEqual([{ email: 'pat@example.com', zip: UNSERVED_ZIP, trade: 'roofing', page: 'check' }]);
  });
  it('the same signup again answers the same way and stores one row', async () => {
    const a = await (await POST(post(good))).json();
    const b = await (await POST(post(good))).json();
    expect(a).toEqual(b);
    expect(state.fake.rows).toHaveLength(1);
  });
  it('writes the visitor IP nowhere: not in the row, not in the logs', async () => {
    await POST(post(good));
    expect(JSON.stringify(state.fake.rows)).not.toContain('198.51.100.7');
    expect(logged()).not.toContain('198.51.100.7');
  });
  it('an invalid email is a 400 naming the field, nothing saved', async () => {
    const res = await POST(post({ ...good, email: 'nope' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid', field: 'email' });
    expect(state.fake.rows).toHaveLength(0);
  });
  it('needs a JSON body (415) and a same-origin request (403)', async () => {
    expect((await POST(post('email=a@b.co', { 'content-type': 'application/x-www-form-urlencoded' }, true))).status).toBe(415);
    expect((await POST(post(good, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(post('[]', {}, true))).status).toBe(400);
    expect((await POST(post('not json', {}, true))).status).toBe(400);
    expect(state.fake.rows).toHaveLength(0);
  });
  it('over the rate limit: 429 with retry-after', async () => {
    state.fake.setHit('limited');
    const res = await POST(post(good));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(await res.json()).toEqual({ ok: false, error: 'limited' });
  });
  it('honeypot: answers ok, saves nothing', async () => {
    const res = await POST(post({ ...good, leave_blank: 'x' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(state.fake.rows).toHaveLength(0);
  });
  it('table missing (migration not applied): a 503 JSON answer, not a thrown 500, and no PII in the logs', async () => {
    state.fake = fakeWaitlist({ missingTable: true });
    const res = await POST(post(good));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(logged()).toContain('42P01');
    expect(logged()).not.toMatch(/pat@example|59001|roofing|198\.51\.100\.7/);
  });
  it('an invalid email is still answered as invalid when the database is not configured', async () => {
    state.throwOnDeps = true;
    const res = await POST(post({ ...good, email: 'nope' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid', field: 'email' });
  });
  it('database not configured (the client factory throws): a 503 JSON answer, and the error message is not logged', async () => {
    state.throwOnDeps = true;
    const res = await POST(post(good));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(logged()).not.toMatch(/pat@example|SUPABASE_URL/);
  });
});
