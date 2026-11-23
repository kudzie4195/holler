/**
 * Round 17, unit ES: the notify cron emails a Spanish member in Spanish, an English member in English, and everyone in English when the
 * language read fails (migration 0024 not applied). Harness copied from tests/integration/r3-plan-trades.test.ts. No email is sent: sendEmail is a fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const H = 3_600_000;
const UID = '11111111-1111-4111-8111-111111111111';
const UID2 = '22222222-2222-4222-8222-222222222222';

type Op = { op: string; args: unknown[] };
interface World {
  /** What the language read returns: rows, or 'no0024' for the error a missing column gives, or 'throw'. */
  language: Array<{ user_id: string; language?: string }> | 'no0024' | 'throw';
  calls: { table: string; ops: Op[] }[];
}

const sig = (id: number, title: string, hoursAgo: number) => ({
  id, source: 'spc', external_id: `x${id}`, expires_at: null, kind: 'report', title, url: null, city: 'Smyrna', state: 'GA',
  occurred_at: new Date(NOW - hoursAgo * H).toISOString(), severity: 2, subtype: null,
});
const MATCHES = [
  { id: 101, user_id: UID, created_at: new Date(NOW - H).toISOString(), signal: sig(1, 'Hail damage reported near Smyrna', 2) },
  { id: 201, user_id: UID2, created_at: new Date(NOW - 2 * H).toISOString(), signal: sig(2, 'Hail damage reported near Marietta', 3) },
];

function fakeAdmin(w: World) {
  return {
    from(table: string) {
      const ops: Op[] = [];
      w.calls.push({ table, ops });
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'update', 'insert', 'limit']) q[m] = (...args: unknown[]) => (ops.push({ op: m, args }), q);
      const result = () => {
        const has = (o: string) => ops.some((x) => x.op === o);
        if (table === 'holler_matches') return has('update') ? { error: null } : { data: MATCHES, error: null };
        if (table === 'holler_profiles') {
          if (has('update')) return { error: null };
          const cols = String(ops.find((x) => x.op === 'select')?.args[0] ?? '');
          if (cols === 'user_id, language') {
            if (w.language === 'throw') throw new Error('boom');
            if (w.language === 'no0024') return { data: null, error: { code: '42703', message: 'column holler_profiles.language does not exist' } };
            return { data: w.language, error: null };
          }
          return {
            data: [UID, UID2].map((id) => ({
              user_id: id, business_name: id === UID ? 'Peachtree Roofing' : 'Techos Pinos', categories: ['roofing'], alert_email: true, subscription_status: 'active',
              trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z',
            })),
            error: null,
          };
        }
        return { data: [], error: null };
      };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(result()).then(res, rej);
        } catch (e) {
          return Promise.reject(e).then(res, rej);
        }
      };
      return q;
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: id === UID ? 'a@peachtree.test' : 'b@pinos.test' } }, error: null }) } },
  };
}

async function runNotify(w: World) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin(w) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => ({ ...(await orig<typeof import('@/lib/outreach/loader')>()), loadMemberContacts: async () => new Map() }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: { to: string; subject: string; html: string; text: string }) => (sent.push(m), { ok: true as const, id: 'e1' }),
  }));
  const { GET } = await import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', 'server-only']) vi.doUnmock(m);
});

const to = (r: Awaited<ReturnType<typeof runNotify>>, addr: string) => r.sent.find((m) => m.to === addr)!;

describe('notify digest language', () => {
  it('a Spanish member gets the Spanish digest and an English member in the same run gets the English one', async () => {
    const r = await runNotify({ calls: [], language: [{ user_id: UID, language: 'en' }, { user_id: UID2, language: 'es' }] });
    expect(r.body).toMatchObject({ emailed: 2 });
    const es = to(r, 'b@pinos.test');
    const en = to(r, 'a@peachtree.test');
    expect(es.html).toContain('lang="es"');
    // Round 23: the digest has no labelled "Por qué importa:" row; the Spanish reason sentence itself is what to look for.
    expect(es.subject).toMatch(/Reporte de tormenta|Aviso del clima|cerca de usted|novedades/);
    expect(es.text).toContain('Hay un reporte de tormenta cerca');
    expect(es.text).toContain('Hail damage reported near Marietta');
    expect(es.text).toContain('fuente pública');
    expect(en.subject).not.toMatch(/cerca de usted/);
    expect(en.text).toContain('A storm report was filed nearby');
  });
  it('migration 0024 NOT applied (the language read errors): everyone is emailed in English and the run does not fail', async () => {
    const r = await runNotify({ calls: [], language: 'no0024' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ emailed: 2, failed: 0 });
    for (const m of r.sent) {
      expect(m.text).toContain('A storm report was filed nearby');
      expect(m.html).not.toContain('lang="es"');
    }
  });
  it('the language read throws: still English, still emailed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runNotify({ calls: [], language: 'throw' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ emailed: 2 });
    for (const m of r.sent) expect(m.text).toContain('A storm report was filed nearby');
  });
  it('a row with no language (or a bad one) is English', async () => {
    const r = await runNotify({ calls: [], language: [{ user_id: UID }, { user_id: UID2, language: 'xx' }] });
    for (const m of r.sent) expect(m.text).toContain('A storm report was filed nearby');
  });
  it('the language read asks for user_id and language only, for the members being considered', async () => {
    const w: World = { calls: [], language: [{ user_id: UID2, language: 'es' }] };
    await runNotify(w);
    const reads = w.calls.filter((c) => c.table === 'holler_profiles' && c.ops.some((o) => o.op === 'select' && o.args[0] === 'user_id, language'));
    expect(reads).toHaveLength(1);
    expect(reads[0].ops.find((o) => o.op === 'in')?.args[0]).toBe('user_id');
  });
});
