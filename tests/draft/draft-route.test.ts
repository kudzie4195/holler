// Review r3 P1 (reply drafts): POST /api/draft refuses a locked account (trial ended, no plan) before anything is counted or sent,
// and answers with a clear message when the monthly AI cap is reached.
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

async function call(profile: Record<string, unknown>, outcome: unknown = { ok: true, draft: 'AI text', source: 'ai' }) {
  vi.resetModules();
  const generateDraft = vi.fn(async () => outcome);
  const hit = vi.fn(async () => 'allowed');
  const adminUpdate = vi.fn();
  vi.doMock('@/lib/ai/draft', () => ({ generateDraft }));
  vi.doMock('@/lib/auth/ratelimit', () => ({ hit, LIMITS: { draftUser: () => ({ key: 'd', max: 20, windowSeconds: 3600 }) } }));
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
            ? { data: { id: 7, user_id: 'u1', signal: { source: 'bluesky', kind: 'ask', title: 'Anyone know a roofer?', summary: 'x', city: 'Atlanta' } }, error: null }
            : { data: { business_name: 'Acme', categories: ['roofing'], city: 'Atlanta', ...profile }, error: null };
        return q;
      },
    }),
  }));
  const { POST } = await import('@/app/api/draft/route');
  const res = await POST(new Request('https://holler.test/api/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matchId: 7 }) }));
  return { res, body: await res.json(), generateDraft, hit, adminUpdate };
}

describe('POST /api/draft access and cap', () => {
  it('a locked account (trial over, no plan): 403, nothing sent to the model, nothing counted or saved', async () => {
    const { res, body, generateDraft, hit, adminUpdate } = await call({ subscription_status: 'trialing', trial_ends_at: PAST });
    expect(res.status).toBe(403);
    expect(body.error).toBe('locked');
    expect(body.message).toMatch(/plan/i);
    expect(generateDraft).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
    expect(adminUpdate).not.toHaveBeenCalled();
    const canceled = await call({ subscription_status: 'canceled', trial_ends_at: PAST });
    expect(canceled.res.status).toBe(403);
    // The message fits a canceled plan too, not only an ended trial (integrate3).
    expect(canceled.body.message).toBe('Your trial or plan has ended. Pick a plan to get reply drafts again.');
  });

  it('the feed card shows the server message on a 403, as it does on 429 and 503 (integrate3, fix-c patch 2)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../components/feed.tsx', import.meta.url), 'utf8');
    expect(src).toContain("(res.status === 403 || res.status === 429 || res.status === 503) && typeof body.message === 'string'");
  });

  it('a trial or paid account gets a draft, with the service-role client for the spend books', async () => {
    for (const p of [{ subscription_status: 'trialing', trial_ends_at: FUTURE }, { subscription_status: 'active', trial_ends_at: PAST }]) {
      const { res, body, generateDraft } = await call(p);
      expect(res.status).toBe(200);
      expect(body).toEqual({ draft: 'AI text' });
      expect(generateDraft).toHaveBeenCalledTimes(1);
      expect((generateDraft.mock.calls[0] as unknown[])[1]).toMatchObject({ db: expect.any(Object) });
    }
  });

  it('cap reached: 503 with a clear message, nothing saved', async () => {
    const { res, body, adminUpdate } = await call({ subscription_status: 'active', trial_ends_at: PAST }, { ok: false, reason: 'cap_reached' });
    expect(res.status).toBe(503);
    expect(body).toEqual({ error: 'ai_paused', message: 'Reply drafts are paused until next month. You can still write your own reply.' });
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it('spend books unavailable: 503, nothing saved', async () => {
    const { res, body, adminUpdate } = await call({ subscription_status: 'active', trial_ends_at: PAST }, { ok: false, reason: 'spend_unavailable' });
    expect(res.status).toBe(503);
    expect(body.error).toBe('unavailable');
    expect(adminUpdate).not.toHaveBeenCalled();
  });
});
