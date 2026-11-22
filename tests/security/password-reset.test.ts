// Security pass r16 SEC-4: POST /api/auth/reset needs proof that this browser just opened a recovery link, not only a session.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signRecoveryProof, amrHasRecentRecovery, recoveryProofValid, RECOVERY_COOKIE } from '../../lib/auth/recovery';
import { signVerifyToken } from '../../lib/email/token';

vi.mock('server-only', () => ({}));
const SECRET = 'test-secret-sec4';
vi.mock('@/lib/env', () => ({ env: { CRON_SECRET: 'test-secret-sec4' }, siteUrl: 'https://localholler.com' }));

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const state = {
  user: { id: USER } as { id: string } | null,
  amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 30 }] as unknown,
  updateUser: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(async () => ({ data: { user: { id: USER } }, error: null })),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      getClaims: async () => ({ data: state.user ? { claims: { sub: state.user.id, amr: state.amr } } : null }),
      updateUser: state.updateUser,
      verifyOtp: state.verifyOtp,
    },
  }),
}));

function resetRequest(cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request('https://localholler.com/api/auth/reset', { method: 'POST', headers, body: JSON.stringify({ password: 'new-password-123' }) });
}

beforeEach(() => {
  state.user = { id: USER };
  state.amr = [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 30 }];
  state.updateUser.mockClear();
  state.verifyOtp.mockClear();
});

describe('POST /api/auth/reset (SEC-4)', () => {
  it('refuses an ordinary signed-in session (password login, no recovery proof): 403, password untouched', async () => {
    const { POST } = await import('../../app/api/auth/reset/route');
    const res = await POST(resetRequest());
    expect(res.status).toBe(403);
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it('accepts the recovery proof cookie for this user, then clears it', async () => {
    const { POST } = await import('../../app/api/auth/reset/route');
    const res = await POST(resetRequest(`other=1; ${RECOVERY_COOKIE}=${encodeURIComponent(signRecoveryProof(USER, SECRET))}`));
    expect(res.status).toBe(200);
    expect(state.updateUser).toHaveBeenCalledWith({ password: 'new-password-123' });
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${RECOVERY_COOKIE}=;`);
    expect(set).toMatch(/Max-Age=0/i);
  });

  it("refuses another user's proof, an expired proof and a different-purpose token", async () => {
    const { POST } = await import('../../app/api/auth/reset/route');
    const other = signRecoveryProof(OTHER, SECRET);
    const expired = signRecoveryProof(USER, SECRET, Date.now() - 16 * 60_000);
    const verifyTok = signVerifyToken(USER, SECRET);
    for (const v of [other, expired, verifyTok, 'junk']) {
      const res = await POST(resetRequest(`${RECOVERY_COOKIE}=${encodeURIComponent(v)}`));
      expect(res.status).toBe(403);
    }
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it('accepts a session that Supabase created from a recovery link minutes ago (amr), even without the cookie', async () => {
    state.amr = [{ method: 'recovery', timestamp: Math.floor(Date.now() / 1000) - 120 }];
    const { POST } = await import('../../app/api/auth/reset/route');
    const res = await POST(resetRequest());
    expect(res.status).toBe(200);
  });

  it('still answers 401 with no session', async () => {
    state.user = null;
    const { POST } = await import('../../app/api/auth/reset/route');
    expect((await POST(resetRequest())).status).toBe(401);
  });
});

describe('POST /auth/confirm sets the proof (SEC-4)', () => {
  it('a recovery token sets an HttpOnly, SameSite=Strict proof cookie scoped to /api/auth/reset, for the verified user', async () => {
    const { POST } = await import('../../app/auth/confirm/route');
    const form = new FormData();
    form.set('token_hash', 'hash');
    form.set('type', 'recovery');
    form.set('next', '/reset');
    const req = new NextRequest('https://localholler.com/auth/confirm', { method: 'POST', body: form, headers: { origin: 'https://localholler.com' } });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://localholler.com/reset');
    const c = res.cookies.get(RECOVERY_COOKIE);
    expect(c).toBeTruthy();
    expect(recoveryProofValid(c!.value, USER, SECRET)).toBe(true);
    const raw = res.headers.get('set-cookie') ?? '';
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=strict/i);
    expect(raw).toMatch(/Path=\/api\/auth\/reset/);
  });
});

describe('amrHasRecentRecovery', () => {
  const now = Date.now();
  it('only a recovery entry from the last 15 minutes counts', () => {
    expect(amrHasRecentRecovery([{ method: 'recovery', timestamp: Math.floor(now / 1000) - 60 }], now)).toBe(true);
    expect(amrHasRecentRecovery([{ method: 'recovery', timestamp: Math.floor(now / 1000) - 16 * 60 }], now)).toBe(false);
    expect(amrHasRecentRecovery([{ method: 'password', timestamp: Math.floor(now / 1000) }], now)).toBe(false);
    expect(amrHasRecentRecovery(undefined, now)).toBe(false);
  });
});
