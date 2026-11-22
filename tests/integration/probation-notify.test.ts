// Source probation: the digest (GET /api/cron/notify) never mails a row of a source on probation, whether the flag arrives as the
// data->>probation alias (the real select) or inside data, and leaves its match unmarked. Same harness as notify-requests.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-17T12:00:00.000Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const h = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string; html: string; text: string }[],
  updates: [] as { table: string; patch: unknown; ids: unknown }[],
}));

function adminFake(matches: unknown[]) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let patch: unknown = null;
      for (const m of ['select', 'eq', 'order']) q[m] = () => q;
      q.range = () => Promise.resolve({ data: table === 'holler_matches' ? matches : [], error: null });
      q.update = (p: unknown) => ((patch = p), q);
      q.in = (_c: string, ids: unknown) => {
        if (patch) {
          h.updates.push({ table, patch, ids });
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({
          data: [
            {
              // u2: the digest labels each match for the member's trades, so the profile carries them.
              user_id: 'u1', business_name: 'Acme Roofing', categories: ['roofing'], alert_email: true, subscription_status: 'active', trial_ends_at: null,
              last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z',
            },
          ],
          error: null,
        });
      };
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
  };
}

async function load(matches: unknown[]) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches) }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: (typeof h.sent)[number]) => (h.sent.push(m), { ok: true, id: 'x' }),
  }));
  return (await import('@/app/api/cron/notify/route')).GET;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  h.sent.length = 0;
  h.updates.length = 0;
});

const match = (id: number, signal: Record<string, unknown>) => ({
  id, user_id: 'u1', created_at: iso(-60_000),
  signal: { kind: 'ask', categories: ['roofing'], url: 'https://holler.test/request', city: 'Atlanta', state: 'GA', occurred_at: iso(-3_600_000), ...signal },
});

describe('GET /api/cron/notify and probation rows', () => {
  const hail = { source: 'spc', kind: 'report', opp_type: 'hail', opp_hail: '1.5' };

  it('mails the plain hail report and never the probation ones; marks only what it mailed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const GET = await load([
      match(1, { ...hail, title: 'PLAIN hail report' }),
      match(2, { ...hail, title: 'PROBATION alias report', probation: 'true' }),
      match(3, { ...hail, title: 'PROBATION data report', data: { probation: true } }),
    ]);
    const res = await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    expect(res.status).toBe(200);
    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0].html + h.sent[0].text;
    expect(mail).toContain('PLAIN hail report');
    expect(mail).not.toContain('PROBATION');
    const marked = h.updates.filter((u) => u.table === 'holler_matches').flatMap((u) => u.ids as number[]);
    expect(marked).toEqual([1]);
  });

  it('a member whose only matches are probation rows gets no email', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const GET = await load([match(1, { ...hail, title: 'PROBATION alias report', probation: 'true' })]);
    await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    expect(h.sent).toHaveLength(0);
  });
});
