// Security pass r16 SEC-3: the Supabase session cookie is HttpOnly and (in production) Secure. Both places that build the cookie
// client (lib/supabase/server.ts and lib/supabase/proxy.ts) must pass the options; @supabase/ssr merges cookieOptions over its
// defaults (httpOnly: false, no Secure) for every cookie it sets (node_modules/@supabase/ssr/dist/main/cookies.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));

const calls: { opts: { cookieOptions?: Record<string, unknown> } }[] = [];
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookieOptions?: Record<string, unknown> }) => {
    calls.push({ opts });
    return { auth: { getClaims: async () => ({ data: null }) } };
  },
}));

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-for-tests');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('session cookie flags (SEC-3)', () => {
  it('server client (route handlers, server actions): HttpOnly, SameSite=Lax, Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { createClient } = await import('../../lib/supabase/server');
    await createClient();
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  });

  it('proxy (session refresh on /app, /onboarding, guest pages): the same flags, and the login redirect still works', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { updateSession } = await import('../../lib/supabase/proxy');
    const res = await updateSession(new NextRequest('https://localholler.com/app'));
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fapp');
  });

  it('outside production the cookie is not marked Secure (local http dev keeps working), still HttpOnly', async () => {
    const { sessionCookieOptions } = await import('../../lib/supabase/cookie-options');
    expect(sessionCookieOptions('development')).toMatchObject({ httpOnly: true, secure: false });
    expect(sessionCookieOptions('production')).toMatchObject({ httpOnly: true, secure: true });
  });
});
