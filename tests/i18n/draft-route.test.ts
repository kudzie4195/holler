/**
 * Round 17, unit ES: POST /api/draft reads the member's language from the profile. With migration 0024 not applied the profile has no
 * `language` key and everything is English, exactly as before.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

beforeEach(() => {
  for (const m of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const m of ['@/lib/supabase/server', '@/lib/supabase/admin', '@/lib/ai/draft', '@/lib/auth/ratelimit']) vi.doUnmock(m);
});

async function call(profile: Record<string, unknown>, o: { outcome?: unknown; limited?: 'allowed' | 'limited' | 'error' } = {}) {
  vi.resetModules();
  const generateDraft = vi.fn(async () => o.outcome ?? { ok: true, draft: 'Texto', source: 'ai' });
  vi.doMock('@/lib/ai/draft', () => ({ generateDraft }));
  vi.doMock('@/lib/auth/ratelimit', () => ({ hit: async () => o.limited ?? 'allowed', LIMITS: { draftUser: () => ({ key: 'd', max: 20, windowSeconds: 3600 }) } }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }) }));
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from(table: string) {
        const q: any = {};
        for (const m of ['select', 'eq']) q[m] = () => q;
        q.maybeSingle = async () =>
          table === 'holler_matches'
            ? { data: { id: 7, user_id: 'u1', signal: { source: 'bluesky', kind: 'ask', title: 'Anyone know a roofer?', summary: 'x', city: 'Atlanta' } }, error: null }
            : { data: { business_name: 'Acme', categories: ['roofing'], city: 'Atlanta', subscription_status: 'active', trial_ends_at: PAST, ...profile }, error: null };
        return q;
      },
    }),
  }));
  const { POST } = await import('@/app/api/draft/route');
  const res = await POST(new Request('https://holler.test/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matchId: 7 }) }));
  return { res, body: await res.json(), generateDraft };
}

describe('POST /api/draft language', () => {
  it('a Spanish member: generateDraft gets lang "es"', async () => {
    const { generateDraft } = await call({ language: 'es' });
    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect((generateDraft.mock.calls[0] as unknown[])[0]).toMatchObject({ lang: 'es', businessName: 'Acme' });
  });
  it('an English member and a profile with no language key (0024 not applied): lang "en"', async () => {
    for (const p of [{ language: 'en' }, {}, { language: null }, { language: 'fr' }]) {
      const { generateDraft } = await call(p);
      expect((generateDraft.mock.calls[0] as unknown[])[0]).toMatchObject({ lang: 'en' });
    }
  });
  it('the error messages are in the member\'s language: locked, rate limited, unavailable, paused', async () => {
    const locked = await call({ language: 'es', subscription_status: 'trialing', trial_ends_at: PAST });
    expect(locked.res.status).toBe(403);
    expect(locked.body.message).toBe('Su prueba o su plan terminó. Elija un plan para recibir borradores de respuesta otra vez.');
    const limited = await call({ language: 'es', subscription_status: 'trialing', trial_ends_at: FUTURE }, { limited: 'limited' });
    expect(limited.res.status).toBe(429);
    expect(limited.body.message).toMatch(/20 borradores/);
    const down = await call({ language: 'es', subscription_status: 'trialing', trial_ends_at: FUTURE }, { limited: 'error' });
    expect(down.res.status).toBe(503);
    expect(down.body.message).toMatch(/no están disponibles/);
    const paused = await call({ language: 'es', subscription_status: 'trialing', trial_ends_at: FUTURE }, { outcome: { ok: false, reason: 'cap_reached' } });
    expect(paused.body.error).toBe('ai_paused');
    expect(paused.body.message).toMatch(/en pausa/);
    const en = await call({ subscription_status: 'trialing', trial_ends_at: PAST });
    expect(en.body.message).toBe('Your trial or plan has ended. Pick a plan to get reply drafts again.');
  });
});
