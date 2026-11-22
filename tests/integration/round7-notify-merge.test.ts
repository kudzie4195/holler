// Round 7 integration: the notify cron after the AI (ranking and notes), MOAT (alert log emailed_at) and ANALYTICS (first_alert)
// patches were merged into one route. Checks the merged behaviour with the round 7 tables present, and that nothing breaks or
// changes order when none of migrations 0014, 0015 and 0017 is applied yet.
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const H = 3_600_000;
const UID = '11111111-1111-4111-8111-111111111111';

type Op = { op: string; args: unknown[] };
interface World {
  migrated: boolean;
  lastNotified: string | null;
  ai: { signal_id: number; trades: Record<string, number>; notes: Record<string, string> }[];
  calls: { table: string; ops: Op[] }[];
}

// Titles name damage, hail or a tornado so all three are Act Now (a bare "wind report" is Coming soon): this test is about the AI ranking, not the label order.
const sig = (id: number, title: string, hoursAgo: number, severity = 1) => ({
  id,
  source: 'spc',
  external_id: `x${id}`,
  expires_at: null,
  kind: 'report',
  title,
  url: null,
  city: 'Smyrna',
  state: 'GA',
  occurred_at: new Date(NOW - hoursAgo * H).toISOString(),
  severity,
  subtype: null,
});
// Newest match first, as the route reads them.
const MATCHES = [
  { id: 101, user_id: UID, created_at: new Date(NOW - 1 * H).toISOString(), signal: sig(1, 'Wind damage reported near Smyrna', 2) },
  { id: 102, user_id: UID, created_at: new Date(NOW - 2 * H).toISOString(), signal: sig(2, 'Tornado warning for Cobb County', 30, 3) },
  { id: 103, user_id: UID, created_at: new Date(NOW - 3 * H).toISOString(), signal: sig(3, 'Hail report near Marietta', 40) },
];

const missing = (t: string) => ({ data: null, error: { code: '42P01', message: `relation "public.${t}" does not exist` } });

function fakeAdmin(w: World) {
  return {
    from(table: string) {
      const ops: Op[] = [];
      w.calls.push({ table, ops });
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'update', 'insert', 'limit']) {
        q[m] = (...args: unknown[]) => (ops.push({ op: m, args }), q);
      }
      const result = () => {
        const has = (o: string) => ops.some((x) => x.op === o);
        if (table === 'holler_matches') return has('update') ? { error: null } : { data: MATCHES, error: null };
        if (table === 'holler_profiles') {
          if (has('update')) return { error: null };
          return {
            data: [
              {
                user_id: UID,
                business_name: 'Peachtree Roofing',
                categories: ['roofing'],
                alert_email: true,
                subscription_status: 'active',
                trial_ends_at: null,
                last_notified_at: w.lastNotified,
                email_verified_at: '2026-11-01T00:00:00Z',
                created_at: '2026-11-01T00:00:00Z',
              },
            ],
            error: null,
          };
        }
        if (table === 'holler_signal_ai') {
          if (!w.migrated) return missing(table);
          const ids = (ops.find((x) => x.op === 'in')?.args[1] ?? []) as number[];
          return { data: w.ai.filter((r) => ids.includes(r.signal_id)), error: null };
        }
        if (table === 'holler_alert_log' || table === 'holler_events') return w.migrated ? { data: [], error: null } : missing(table);
        return { data: [], error: null };
      };
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@peachtree.test' } }, error: null }) } },
  };
}

async function runNotify(w: World) {
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const sent: { subject: string; html: string; text: string }[] = [];
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin(w) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => ({
    ...(await orig<typeof import('@/lib/outreach/loader')>()),
    loadMemberContacts: async () => new Map(),
  }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async (m: { subject: string; html: string; text: string }) => (sent.push(m), { ok: true as const, id: 'e1' }),
  }));
  const { GET } = await import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, sent };
}

const order = (text: string) =>
  ['Wind damage reported near Smyrna', 'Tornado warning for Cobb County', 'Hail report near Marietta'].map((t) => [t, text.indexOf(t)] as const).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
const ops = (w: World, table: string) => w.calls.filter((c) => c.table === table).map((c) => c.ops);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const m of ['@/lib/supabase/admin', '@/lib/outreach/loader', '@/lib/email', 'server-only']) vi.doUnmock(m);
});

describe('notify cron after the round 7 merge', () => {
  it('none of 0014, 0015, 0017 applied: the digest still goes out, newest first, with no AI line, and every match is marked', async () => {
    const w: World = { migrated: false, lastNotified: null, ai: [], calls: [] };
    const r = await runNotify(w);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, emailed: 1, matches_marked: 3, failed: 0 });
    expect(r.sent).toHaveLength(1);
    expect(order(r.sent[0].text)).toEqual(['Wind damage reported near Smyrna', 'Tornado warning for Cobb County', 'Hail report near Marietta']);
    expect(r.sent[0].text).not.toContain('Why it may matter');
    expect(r.sent[0].html).not.toContain('Why it may matter');
    // The log and funnel writes were attempted and failed quietly against the missing tables.
    expect(ops(w, 'holler_alert_log')).toHaveLength(1);
    expect(ops(w, 'holler_events')).toHaveLength(1);
  });

  it('with stored AI results: ranked by the member trade, the note is in the html and the text, emailed_at is stamped, first_alert recorded', async () => {
    const w: World = {
      migrated: true,
      lastNotified: null,
      ai: [
        { signal_id: 3, trades: { roofing: 0.95 }, notes: { roofing: 'A roof inspection may follow this hail report.' } },
        { signal_id: 1, trades: { roofing: 0.1, 'tree-service': 0.9 }, notes: { 'tree-service': 'Fallen limbs may need clearing.' } },
      ],
      calls: [],
    };
    const r = await runNotify(w);
    expect(r.body).toMatchObject({ ok: true, emailed: 1, matches_marked: 3 });
    // Hail (0.95 for roofing) first, then the unscored tornado warning (0.5, severe), then the wind report (0.1 for roofing).
    expect(order(r.sent[0].text)).toEqual(['Hail report near Marietta', 'Tornado warning for Cobb County', 'Wind damage reported near Smyrna']);
    expect(r.sent[0].text).toContain('Why it may matter: A roof inspection may follow this hail report.');
    expect(r.sent[0].html).toContain('<strong>Why it may matter:</strong> A roof inspection may follow this hail report.');
    // The note of a trade the member did not pick is never shown.
    expect(r.sent[0].text).not.toContain('Fallen limbs');

    const [log] = ops(w, 'holler_alert_log');
    expect(log.map((o) => o.op)).toEqual(['update', 'eq', 'in', 'is']);
    expect(log[0].args[0]).toEqual({ emailed_at: new Date(NOW).toISOString() });
    expect(log[1].args).toEqual(['user_id', UID]);
    expect([...(log[2].args[1] as number[])].sort()).toEqual([1, 2, 3]);
    expect(log[3].args).toEqual(['emailed_at', null]);

    const ev = ops(w, 'holler_events');
    expect(ev).toHaveLength(1);
    expect(ev[0][0].op).toBe('insert');
    expect(ev[0][0].args[0]).toMatchObject({ name: 'first_alert', user_id: UID });
  });

  it('a member who was emailed before gets no second first_alert event', async () => {
    const w: World = { migrated: true, lastNotified: new Date(NOW - 5 * H).toISOString(), ai: [], calls: [] };
    const r = await runNotify(w);
    expect(r.body).toMatchObject({ emailed: 1 });
    expect(ops(w, 'holler_events')).toHaveLength(0);
    expect(ops(w, 'holler_alert_log')).toHaveLength(1);
  });
});
