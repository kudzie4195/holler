// Security pass r16 SEC-5: cookie-authenticated POST routes that spend money or AI budget refuse cross-site requests themselves
// instead of relying on SameSite=Lax alone: /api/draft needs a JSON body and a same-site Origin; /api/stripe/portal and
// /api/feedback/outcome/feed need a same-site Origin when one is sent.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: {}, siteUrl: 'https://localholler.com' }));

const touched = { supabase: 0 };
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    touched.supabase += 1;
    return { auth: { getUser: async () => ({ data: { user: null } }) } };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({}), billingNotConfigured: () => Response.json({}, { status: 503 }) }));
vi.mock('@/lib/auth/session', () => ({ getUser: async () => null }));

const EVIL = 'https://evil.example';
const post = (url: string, headers: Record<string, string>, body = '{"matchId":7}') => new Request(url, { method: 'POST', headers, body });

beforeEach(() => {
  touched.supabase = 0;
});

describe('POST /api/draft (SEC-5)', () => {
  it('a text/plain body (what a no-cors cross-site fetch can send) is 415 before any session read', async () => {
    const { POST } = await import('../../app/api/draft/route');
    const res = await POST(post('https://localholler.com/api/draft', { 'content-type': 'text/plain;charset=UTF-8' }));
    expect(res.status).toBe(415);
    expect(touched.supabase).toBe(0);
  });
  it('a cross-site Origin is 403 before any session read', async () => {
    const { POST } = await import('../../app/api/draft/route');
    const res = await POST(post('https://localholler.com/api/draft', { 'content-type': 'application/json', origin: EVIL, host: 'localholler.com' }));
    expect(res.status).toBe(403);
    expect(touched.supabase).toBe(0);
  });
  it('the site itself still gets through to the session check (401 signed out)', async () => {
    const { POST } = await import('../../app/api/draft/route');
    const res = await POST(post('https://localholler.com/api/draft', { 'content-type': 'application/json', origin: 'https://localholler.com', host: 'localholler.com' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/stripe/portal and /api/feedback/outcome/feed (SEC-5)', () => {
  it('portal: a cross-site Origin is 403 before any session read', async () => {
    const { POST } = await import('../../app/api/stripe/portal/route');
    const res = await POST(post('https://localholler.com/api/stripe/portal', { origin: EVIL, host: 'localholler.com' }, ''));
    expect(res.status).toBe(403);
    expect(touched.supabase).toBe(0);
  });
  it('portal: same origin reaches the session check (401 signed out)', async () => {
    const { POST } = await import('../../app/api/stripe/portal/route');
    const res = await POST(post('https://localholler.com/api/stripe/portal', { origin: 'https://localholler.com', host: 'localholler.com' }, ''));
    expect(res.status).toBe(401);
  });
  it('outcome feed: a cross-site Origin is 403', async () => {
    const { POST } = await import('../../app/api/feedback/outcome/feed/route');
    const res = await POST(post('https://localholler.com/api/feedback/outcome/feed', { 'content-type': 'application/json', origin: EVIL, host: 'localholler.com' }, '{"signalId":1,"answer":"yes"}'));
    expect(res.status).toBe(403);
  });
});
