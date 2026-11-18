// Review round 3, route level. P1-3: /api/draft never sends a resident request to the AI model. P1-1: the feed (/app) and the alert
// email get a request's filtered text only through the service role, for the member's own match; the public row's summary is never
// used. P1-2: the close link expires the tagged cache entries. P2-5: REQUESTS_ENABLED. P2-7: business names in emails are cleaned.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanBusinessName, plainReply, renderRequestReply } from '@/lib/email/request-emails';
import { requestsEnabled } from '@/lib/requests/enabled';
import { confirmRequest, createRequest } from '@/lib/requests/service';
import { linkToken } from '@/lib/requests/tokens';
import { FakeDb } from './fake-db';
import { SECRET, VALID, harness, tokenIn, type Harness } from './helpers';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const PUB = 'req_0123456789abcdef0123';

beforeEach(() => {
  for (const m of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const m of ['@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/ai/draft', '@/lib/auth/ratelimit', '@/lib/requests/deps', 'next/cache', '@/lib/auth/session', '@/components/feed', '@/lib/email', 'server-only']) {
    vi.doUnmock(m);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P1-3: POST /api/draft refuses resident requests', () => {
  async function draftRoute(signal: Record<string, unknown>) {
    vi.resetModules();
    const generateDraft = vi.fn(async () => ({ draft: 'AI text' }));
    const adminUpdate = vi.fn();
    vi.doMock('@/lib/ai/draft', () => ({ generateDraft }));
    vi.doMock('@/lib/auth/ratelimit', () => ({ hit: async () => 'allowed', LIMITS: { draftUser: () => ({ key: 'd', max: 20, windowSeconds: 3600 }) } }));
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({ from: () => ({ update: (p: unknown) => (adminUpdate(p), { eq: () => ({ eq: async () => ({ error: null }) }) }) }) }),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from(table: string) {
          const q: any = {};
          for (const m of ['select', 'eq']) q[m] = () => q;
          q.maybeSingle = async () =>
            table === 'holler_matches'
              ? { data: { id: 7, user_id: 'u1', signal }, error: null }
              : { data: { business_name: 'Acme', categories: ['roofing'], city: 'Atlanta' }, error: null };
          return q;
        },
      }),
    }));
    const { POST } = await import('@/app/api/draft/route');
    const res = await POST(new Request('https://holler.test/api/draft', { method: 'POST', body: JSON.stringify({ matchId: 7 }) }));
    return { res, generateDraft, adminUpdate };
  }

  it('a resident request match: 400, nothing sent to the AI model, nothing saved', async () => {
    const { res, generateDraft, adminUpdate } = await draftRoute({
      source: 'holler-request', kind: 'ask', title: 'Service request in Atlanta: Roofing', summary: null, city: 'Atlanta',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'resident_request' });
    expect(generateDraft).not.toHaveBeenCalled();
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it('other "people asking" records still get a draft', async () => {
    const { res, generateDraft } = await draftRoute({ source: 'bluesky', kind: 'ask', title: 'Anyone know a roofer?', summary: 'x', city: 'Atlanta' });
    expect(res.status).toBe(200);
    expect(generateDraft).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P1-1: the feed reads request text with the service role, for the member’s own match only', () => {
  async function renderFeed(opts: { locked: boolean; signalSummary: string | null; adminDb: any }) {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const seen: any[] = [];
    const adminCalls = vi.fn();
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/auth/session', () => ({
      requireProfile: async () => ({
        user: { id: 'u-near' },
        profile: {
          user_id: 'u-near', business_name: 'Acme', categories: ['roofing'], zip: '30301', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
          radius_mi: 25, alert_email: true, subscription_status: opts.locked ? 'canceled' : 'active', trial_ends_at: iso(-86_400_000), plan: 'starter',
          stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: iso(-86_400_000), created_at: iso(-30 * 86_400_000),
        },
      }),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => {
        const q: any = {};
        for (const m of ['from', 'select', 'eq', 'order']) q[m] = () => q;
        q.limit = async () => ({
          data: [
            {
              id: 11, status: 'new', distance_mi: 2, draft: null, created_at: iso(-60_000),
              signal: { id: 5, source: 'holler-request', kind: 'ask', title: 'Service request in Atlanta: Roofing', summary: opts.signalSummary, url: null, city: 'Atlanta', state: 'GA', occurred_at: iso(-3_600_000), expires_at: iso(86_400_000) },
            },
            {
              id: 12, status: 'new', distance_mi: 2, draft: null, created_at: iso(-60_000),
              signal: { id: 6, source: 'nws', kind: 'alert', title: 'Wind advisory', summary: 'Gusts to 45 mph', url: null, city: 'Atlanta', state: 'GA', occurred_at: iso(-3_600_000), expires_at: iso(86_400_000) },
            },
          ],
          error: null,
        });
        return q;
      },
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => (adminCalls(), opts.adminDb) }));
    vi.doMock('@/components/feed', () => ({
      Feed: ({ items }: { items: any[] }) => (seen.push(...items), null),
      LockedFeed: ({ items }: { items: any[] }) => (seen.push(...items), null),
    }));
    const AppHome = (await import('@/app/app/page')).default;
    renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    return { seen, adminCalls };
  }

  function adminDb(rows: { matches: any[]; signals: any[]; requests: any[] }) {
    return new FakeDb({ holler_matches: rows.matches, holler_signals: rows.signals, holler_requests: rows.requests });
  }
  const seed = (status = 'open') => ({
    matches: [{ id: 11, user_id: 'u-near', signal_id: 5 }],
    signals: [{ id: 5, source: 'holler-request', external_id: PUB }],
    requests: [{ id: 'r1', public_id: PUB, status, expires_at: iso(86_400_000), public_summary: 'Roof leak over the kitchen after the storm.', email: 'x@y.z' }],
  });

  it('shows the filtered text from holler_requests; never the public row summary; other sources unchanged', async () => {
    const { seen } = await renderFeed({ locked: false, signalSummary: 'PUBLIC ROW TEXT', adminDb: adminDb(seed()) });
    const req = seen.find((i) => i.id === 11);
    expect(req.summary).toBe('Roof leak over the kitchen after the storm.');
    expect(JSON.stringify(seen)).not.toContain('PUBLIC ROW TEXT');
    expect(JSON.stringify(seen)).not.toContain('x@y.z');
    expect(seen.find((i) => i.id === 12).summary).toBe('Gusts to 45 mph');
  });

  it('a match that is not this member’s, or a closed request: no text', async () => {
    const other = seed();
    other.matches[0].user_id = 'u-other';
    expect((await renderFeed({ locked: false, signalSummary: null, adminDb: adminDb(other) })).seen.find((i) => i.id === 11).summary).toBeNull();
    expect((await renderFeed({ locked: false, signalSummary: null, adminDb: adminDb(seed('closed')) })).seen.find((i) => i.id === 11).summary).toBeNull();
  });

  it('a locked account: the service role is never asked', async () => {
    const { seen, adminCalls } = await renderFeed({ locked: true, signalSummary: null, adminDb: adminDb(seed()) });
    expect(adminCalls).not.toHaveBeenCalled();
    expect(JSON.stringify(seen)).not.toContain('Roof leak');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P1-1: the alert email carries the request text for that member’s live request', () => {
  it('digest shows the text read by public id; the public row summary is never used', async () => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv('CRON_SECRET', 's3cret');
    const sent: any[] = [];
    const matches = [
      { id: 1, user_id: 'u1', created_at: iso(-60_000), signal: { source: 'holler-request', external_id: PUB, kind: 'ask', title: 'Service request in Atlanta: Roofing', url: 'https://holler.test/request', city: 'Atlanta', state: 'GA', occurred_at: iso(-3_600_000), expires_at: iso(86_400_000), summary: 'PUBLIC ROW TEXT' } },
    ];
    const requestsQueried: unknown[] = [];
    const admin = {
      from(table: string) {
        const q: any = {};
        let patch: unknown = null;
        for (const m of ['select', 'eq', 'order']) q[m] = () => q;
        q.range = async () => ({ data: table === 'holler_matches' ? matches : [], error: null });
        q.update = (p: unknown) => ((patch = p), q);
        q.in = async (_c: string, ids: unknown) => {
          if (patch) return { error: null };
          if (table === 'holler_requests') {
            requestsQueried.push(ids);
            return { data: [{ public_id: PUB, status: 'open', expires_at: iso(86_400_000), public_summary: 'Roof leak over the kitchen.' }], error: null };
          }
          return {
            data: [{ user_id: 'u1', business_name: 'Acme Roofing', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }],
            error: null,
          };
        };
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
        return q;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
    };
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
    vi.doMock('@/lib/email', async (orig) => ({
      ...(await orig<typeof import('@/lib/email')>()),
      sendEmail: async (m: any) => (sent.push(m), { ok: true, id: 'x' }),
    }));
    const { GET } = await import('@/app/api/cron/notify/route');
    const res = await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    expect(res.status).toBe(200);
    expect(requestsQueried).toEqual([[PUB]]);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain('Roof leak over the kitchen.');
    expect(sent[0].text).toContain('Roof leak over the kitchen.');
    expect(sent[0].html + sent[0].text).not.toContain('PUBLIC ROW TEXT');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P1-2: closing expires the tagged cache entries at once', () => {
  let h: Harness;
  it('POST /request/close -> revalidateTag("holler-requests", { expire: 0 })', async () => {
    h = harness();
    await createRequest(h.deps, VALID, '203.0.113.9');
    await confirmRequest(h.deps, tokenIn(h.sent[0].text, '/request/confirm'));
    const id = h.db.rows('holler_requests')[0].id;
    vi.resetModules();
    const revalidateTag = vi.fn();
    vi.doMock('next/cache', () => ({ revalidateTag, cacheLife: vi.fn(), cacheTag: vi.fn() }));
    vi.doMock('@/lib/requests/deps', () => ({ requestDeps: () => h.deps }));
    const { POST } = await import('@/app/request/close/route');
    const body = new URLSearchParams({ token: linkToken('close', id, SECRET) });
    const res = await POST(new Request('https://holler.test/request/close', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('within about 15 minutes');
    expect(revalidateTag).toHaveBeenCalledWith('holler-requests', { expire: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P2-5: REQUESTS_ENABLED', () => {
  it('on by default; "0", "false", "off" turn it off', () => {
    expect(requestsEnabled(undefined)).toBe(true);
    expect(requestsEnabled('')).toBe(true);
    expect(requestsEnabled('1')).toBe(true);
    for (const v of ['0', 'false', 'OFF', ' no ']) expect(requestsEnabled(v)).toBe(false);
  });

  it('the API answers 503 with a short note, JSON and plain form', async () => {
    const h = harness();
    vi.resetModules();
    vi.doMock('@/lib/requests/deps', () => ({ requestDeps: () => ({ ...h.deps, enabled: false }) }));
    const { POST } = await import('@/app/api/requests/route');
    const json = await POST(new Request('https://holler.test/api/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID) }));
    expect(json.status).toBe(503);
    expect(await json.json()).toMatchObject({ ok: false, paused: true, message: 'We are not taking new requests right now. Try again later.' });
    const form = await POST(new Request('https://holler.test/api/requests', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ trade: 'roofing' }) }));
    expect(form.status).toBe(503);
    expect(h.sent).toHaveLength(0);
  });

  it('the /request page shows a short "paused" note instead of the form', async () => {
    vi.stubEnv('REQUESTS_ENABLED', '0');
    vi.resetModules();
    const Page = (await import('@/app/request/page')).default;
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain('Requests are paused right now. Try again later.');
    expect(html).not.toContain('action="/api/requests"');
    vi.unstubAllEnvs();
    vi.resetModules();
    const On = (await import('@/app/request/page')).default;
    expect(renderToStaticMarkup(createElement(On))).toContain('action="/api/requests"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('P2-7: business names and replies in emails', () => {
  it('cleanBusinessName: no control characters or line breaks, no links or emails, at most 80 characters', () => {
    expect(cleanBusinessName('Acme\r\nBcc: evil@x.example')).toBe('Acme Bcc');
    expect(cleanBusinessName('Acme Roofing https://evil.example/x www.evil.example evil.example')).toBe('Acme Roofing');
    expect(cleanBusinessName(`Acme${String.fromCharCode(0x202e)}${String.fromCharCode(0x200b)} Roofing`)).toBe('Acme Roofing');
    expect(cleanBusinessName('A'.repeat(200))).toHaveLength(80);
    expect(cleanBusinessName('   ')).toBe('A business');
  });

  it('reply email: subject is one clean line; the reply is plain text, escaped in HTML', () => {
    const m = renderRequestReply({
      businessName: 'Holler Support\r\nBcc: evil@x.example <script>alert(1)</script> https://evil.example',
      businessPlace: 'Atlanta, GA',
      message: `We can come Tuesday.\n<img src=x onerror=alert(1)>${String.fromCharCode(0x202e)}`,
      tradeLabel: 'Roofing',
      place: 'Atlanta, GA',
      closeUrl: 'https://holler.test/request/close?token=abc',
      reportAddress: null,
      replyRef: 'req_1-1',
    });
    expect(m.subject).not.toMatch(/[\r\n<>]|evil|https?:/);
    expect(m.subject.length).toBeLessThanOrEqual(80 + ' replied to your request on Holler'.length);
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(plainReply(`a${String.fromCharCode(0x202e)}b\r\nc`)).toBe('ab\nc');
  });
});
