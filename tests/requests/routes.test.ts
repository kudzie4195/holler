// Route-level checks: POST /api/requests (JSON and plain form), GET/POST /request/confirm and /request/close.
// Criteria 1 (no resident email in any API response), 3 (unknown or expired tokens give a 200 plain page), 4 (same answer for new and
// repeated emails, honeypot, limits) and 6 (close through the route).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomToken } from '@/lib/requests/tokens';
import { RESIDENT, T0, VALID, harness, tokenIn, type Harness } from './helpers';

let h: Harness;

afterEach(() => {
  vi.doUnmock('@/lib/requests/deps');
  vi.restoreAllMocks();
});

async function load<T>(path: string): Promise<T> {
  vi.resetModules();
  vi.doMock('@/lib/requests/deps', () => ({ requestDeps: () => h.deps }));
  return (await import(path)) as T;
}

type Handler = (req: Request) => Promise<Response> | Response;

function jsonReq(body: unknown, ip = '203.0.113.9') {
  return new Request('https://holler.test/api/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}
function formReq(fields: Record<string, string>, ip = '203.0.113.9') {
  return new Request('https://holler.test/api/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams(fields).toString(),
  });
}
async function snapshot(res: Response) {
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

describe('POST /api/requests', () => {
  it('JSON: the answer is byte-identical for a new email, a repeated email and an email over its daily limit', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    const first = await snapshot(await POST(jsonReq(VALID)));
    const repeat = await snapshot(await POST(jsonReq(VALID)));
    h.setHit((l) => (l[0].key.startsWith('request:email:') ? 'limited' : 'allowed'));
    const overLimit = await snapshot(await POST(jsonReq(VALID)));
    h.setHit(() => 'allowed');
    const other = await snapshot(await POST(jsonReq({ ...VALID, email: 'new.person@example.net' })));
    expect(first).toEqual({ status: 200, location: null, body: '{"ok":true}' });
    expect(repeat).toEqual(first);
    expect(overLimit).toEqual(first);
    expect(other).toEqual(first);
    expect(h.db.rows('holler_requests')).toHaveLength(3); // the over-limit one was dropped silently
  });

  it('plain form post (no JavaScript): 303 to /request/sent, identical for new and repeated emails', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    const fields = { trade: 'roofing', zip: '30301', description: VALID.description, email: RESIDENT, consent: 'on', leave_blank: '' };
    const a = await snapshot(await POST(formReq(fields)));
    const b = await snapshot(await POST(formReq(fields)));
    expect(a).toEqual({ status: 303, location: '/request/sent', body: '' });
    expect(b).toEqual(a);
    expect(h.sent.filter((m) => m.to === RESIDENT)).toHaveLength(2);
  });

  it('honeypot hit gets the same answer as a real request and nothing is stored or sent', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    const real = await snapshot(await POST(jsonReq({ ...VALID, email: 'a@example.net' })));
    h.sent.length = 0;
    const before = h.db.rows('holler_requests').length;
    const bot = await snapshot(await POST(jsonReq({ ...VALID, leave_blank: 'buy now' })));
    expect(bot).toEqual(real);
    expect(h.db.rows('holler_requests')).toHaveLength(before);
    expect(h.sent).toHaveLength(0);
    const botForm = await snapshot(await POST(formReq({ trade: 'roofing', zip: '30301', description: VALID.description, email: 'b@example.net', consent: 'on', leave_blank: 'x' })));
    expect(botForm.status).toBe(303);
    expect(h.db.rows('holler_requests')).toHaveLength(before);
  });

  it('per-IP limit: 429 with a plain message', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    h.setHit((l) => (l[0].key.startsWith('request:ip:') ? 'limited' : 'allowed'));
    const res = await POST(jsonReq(VALID));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, message: 'Too many tries. Wait a bit, then try again.' });
  });

  it('per-IP limit counts each IP separately (keys differ by IP, never hold the raw IP)', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    await POST(jsonReq(VALID, '198.51.100.1'));
    await POST(jsonReq(VALID, '198.51.100.2'));
    const ipKeys = h.hits.map((l) => l[0].key).filter((k) => k.startsWith('request:ip:'));
    expect(new Set(ipKeys).size).toBe(2);
    expect(ipKeys.join()).not.toContain('198.51.100');
  });

  it('validation errors: 400 with field messages, no echo of the email address', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    const res = await POST(jsonReq({ ...VALID, description: 'short', consent: false }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text).errors).toMatchObject({ description: expect.any(String), consent: expect.any(String) });
    expect(text).not.toContain(RESIDENT);
    const form = await POST(formReq({ trade: 'roofing', zip: 'abc', description: VALID.description, email: RESIDENT }));
    expect(form.status).toBe(400);
    expect(form.headers.get('content-type')).toContain('text/html');
    expect(await form.text()).not.toContain(RESIDENT);
  });

  it('no API response ever contains the resident email', async () => {
    h = harness();
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    const bodies = [
      await (await POST(jsonReq(VALID))).text(),
      await (await POST(jsonReq({ ...VALID, zip: '00000' }))).text(),
      await (await POST(formReq({ trade: 'roofing', zip: '30301', description: VALID.description, email: RESIDENT, consent: 'on' }))).text(),
    ];
    for (const b of bodies) expect(b).not.toContain(RESIDENT);
  });

  it('a broken database answers 503, not a stack trace', async () => {
    h = harness();
    h.db.failOn['holler_requests.insert'] = 'down';
    const { POST } = await load<{ POST: Handler }>('../../app/api/requests/route');
    const res = await POST(jsonReq(VALID));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('down');
  });
});

describe('/request/confirm and /request/close pages', () => {
  async function routes() {
    const confirm = await load<{ GET: Handler; POST: Handler }>('../../app/request/confirm/route');
    const close = await load<{ GET: Handler; POST: Handler }>('../../app/request/close/route');
    return { confirm, close };
  }
  const postToken = (path: string, token: string) =>
    new Request(`https://holler.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });

  it('GET only shows a button (email scanners open links): nothing changes until the POST', async () => {
    h = harness();
    const { confirm } = await routes();
    const { createRequest } = await import('@/lib/requests/service');
    await createRequest(h.deps, VALID, '203.0.113.9');
    const token = tokenIn(h.sent[0].text, '/request/confirm');
    const get = await confirm.GET(new Request(`https://holler.test/request/confirm?token=${token}`));
    expect(get.status).toBe(200);
    const html = await get.text();
    expect(html).toContain('<form method="POST" action="/request/confirm"');
    expect(html).toContain('noindex');
    expect(h.db.rows('holler_requests')[0].status).toBe('pending');
    expect(h.db.rows('holler_signals')).toHaveLength(0);

    const done = await confirm.POST(postToken('/request/confirm', token));
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Your request is live');
    expect(h.db.rows('holler_requests')[0].status).toBe('open');
    const again = await confirm.POST(postToken('/request/confirm', token));
    expect(await again.text()).toContain('already live');
    expect(h.db.rows('holler_signals')).toHaveLength(1);
  });

  it.each([
    ['unknown', () => randomToken()],
    ['malformed', () => '<script>alert(1)</script>'],
    ['empty', () => ''],
  ])('%s token: 200 plain page with no detail, on GET and POST, for confirm and close', async (_n, make) => {
    h = harness();
    const { confirm, close } = await routes();
    const token = make();
    for (const res of [
      await confirm.POST(postToken('/request/confirm', token)),
      await close.POST(postToken('/request/close', token)),
    ]) {
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('This link is not active');
      expect(html).not.toContain('<script>alert');
    }
    const g = await confirm.GET(new Request(`https://holler.test/request/confirm?token=${encodeURIComponent(token)}`));
    expect(g.status).toBe(200);
  });

  it('expired confirm link: 200 plain page, same as unknown', async () => {
    h = harness();
    const { confirm } = await routes();
    const { createRequest } = await import('@/lib/requests/service');
    await createRequest(h.deps, VALID, '203.0.113.9');
    const token = tokenIn(h.sent[0].text, '/request/confirm');
    h.setNow(new Date(T0.getTime() + 8 * 86_400_000));
    const res = await confirm.POST(postToken('/request/confirm', token));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('This link is not active');
  });

  it('close through the route deletes the email and expires the record', async () => {
    h = harness();
    const { confirm, close } = await routes();
    const { createRequest } = await import('@/lib/requests/service');
    await createRequest(h.deps, VALID, '203.0.113.9');
    const token = tokenIn(h.sent[0].text, '/request/confirm');
    const page = await (await confirm.POST(postToken('/request/confirm', token))).text();
    const closeToken = page.match(/\/request\/close\?token=([A-Za-z0-9_-]{43})/)![1];
    const step = await close.GET(new Request(`https://holler.test/request/close?token=${closeToken}`));
    expect(await step.text()).toContain('action="/request/close"');
    expect(h.db.rows('holler_requests')[0].status).toBe('open');
    const res = await close.POST(postToken('/request/close', closeToken));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Request closed');
    expect(h.db.rows('holler_requests')[0]).toMatchObject({ status: 'closed', email: null });
    expect(h.db.rows('holler_signals')[0].expires_at).toBe(T0.toISOString());
  });
});
