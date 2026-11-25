// Round 33 review P2-6c: the owner pages are partial prerender routes, so a notFound() inside the page would stream after a 200 shell.
// The proxy answers first: anyone but the owner gets a real 404 status for /app/owner/*, before any page is rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ sub: null as string | null }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: h.sub ? { claims: { sub: h.sub } } : null }) } }),
}));

const OWNER_ID = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
const MEMBER_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-for-tests');
  vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '1');
  vi.stubEnv('HOLLER_OWNER_USER_ID', OWNER_ID);
});
afterEach(() => vi.unstubAllEnvs());

async function statusFor(path: string): Promise<{ status: number; rewrite: string | null; location: string | null }> {
  const { updateSession } = await import('@/lib/supabase/proxy');
  const res = await updateSession(new NextRequest(`https://localholler.com${path}`));
  return { status: res.status, rewrite: res.headers.get('x-middleware-rewrite'), location: res.headers.get('location') };
}

describe('/app/owner/* status codes', () => {
  it.each(['/app/owner/bids', '/app/owner/bids/import', '/app/owner/bids/checklist'])('%s: 404 for a member, a signed-out visitor and with the switch off; 200 for the owner', async (path) => {
    h.sub = MEMBER_ID;
    expect(await statusFor(path)).toMatchObject({ status: 404, location: null });
    h.sub = null;
    // Signed out: a 404, not a redirect to the log-in page (which would say the page exists).
    expect(await statusFor(path)).toMatchObject({ status: 404, location: null });
    h.sub = OWNER_ID;
    vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '');
    expect((await statusFor(path)).status).toBe(404);
    vi.stubEnv('HOLLER_MANUAL_BIDS_ENABLED', '1');
    const owner = await statusFor(path);
    expect(owner.status).toBe(200);
    expect(owner.rewrite).toBeNull();
  });

  it('the rest of /app is unchanged: a member gets 200, a signed-out visitor the log-in redirect', async () => {
    h.sub = MEMBER_ID;
    expect((await statusFor('/app')).status).toBe(200);
    h.sub = null;
    const r = await statusFor('/app/settings');
    expect(r.status).toBe(307);
    expect(r.location).toMatch(/\/login\?next=%2Fapp%2Fsettings$/);
  });
});
