// The notify cron (app/api/cron/notify/route.ts) driven run after run with a stateful in-memory database and a fake FCM sender:
// push must not depend on the email path (round 7 review, P1 "push for members without email digests", and P2 "count is new since
// the last push"). Reproduces the reviewer's timeline: email alerts off, push on, match at 12:05, runs every 15 minutes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileRow, UA } from './fakes';
import { memDb, type MemDb } from './memdb';

const day = (d: string, hm: string) => new Date(`${d}T${hm}:00.000Z`);
const D = '2026-11-19';

let m: MemDb;
let pushes: { token: string; title: string; body: string }[];
let emails: number;

function setup(profile: Record<string, unknown>) {
  m = memDb({
    holler_profiles: [profileRow(UA, profile)],
    holler_push_tokens: [{ id: 'd1', user_id: UA, token: 'device-token-1', platform: 'ios', disabled_at: null }],
    holler_matches: [],
    holler_signals: [],
  });
  pushes = [];
  emails = 0;
}

let nextId = 1;
function match(at: Date, title: string) {
  const id = nextId++;
  m.tables.holler_signals.push({ id: 900 + id, source: 'spc', external_id: `x${id}`, expires_at: null, kind: 'report', title, url: null, city: 'Smyrna', state: 'GA', occurred_at: at.toISOString(), severity: 1, subtype: null });
  m.tables.holler_matches.push({ id, user_id: UA, signal_id: 900 + id, status: 'new', notified: false, pushed_at: null, created_at: at.toISOString() });
}

async function runAt(at: Date) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ ...m.db, auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@x.test' } }, error: null }) } } }) }));
  vi.doMock('@/lib/push/fcm', async (orig) => ({
    ...(await orig<typeof import('@/lib/push/fcm')>()),
    isFcmConfigured: () => true,
    sendPush: async (x: { token: string; title: string; body: string }) => (pushes.push({ token: x.token, title: x.title, body: x.body }), { ok: true as const }),
  }));
  vi.doMock('@/lib/email', async (orig) => ({
    ...(await orig<typeof import('@/lib/email')>()),
    sendEmail: async () => (emails++, { ok: true as const, id: 'e' }),
  }));
  vi.doMock('@/lib/outreach/loader', () => ({ loadMemberContacts: async () => new Map() }));
  const { GET } = await import('@/app/api/cron/notify/route');
  const res = await GET(new Request('https://holler.test/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  return (await res.json()) as Record<string, unknown> & { push: Record<string, unknown> | null };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const x of ['server-only', '@/lib/supabase/admin', '@/lib/push/fcm', '@/lib/email', '@/lib/outreach/loader']) vi.doUnmock(x);
});

describe('notify cron: push is independent of the email digest', () => {
  it('email alerts off: a match inside the hour after a push is pushed in the next hour, not lost', async () => {
    setup({ alert_email: false, push_alerts: true });
    match(day(D, '12:05'), 'Hail 1.00 in near Smyrna');
    const r1 = await runAt(day(D, '12:07'));
    expect(pushes.map((p) => p.title)).toEqual(['New alert near Smyrna']);
    expect(r1.push).toMatchObject({ members_pushed: 1, matches_pushed: 1 });

    match(day(D, '12:20'), 'Tree down on Main St');
    const r2 = await runAt(day(D, '12:22'));
    expect(r2.matches_skipped_marked).toBe(1); // the email path marks it notified (email is off) ...
    expect(r2.push).toMatchObject({ members_pushed: 0, skipped_recent: 1 }); // ... and push holds it for the next hour
    for (const t of ['12:37', '12:52', '13:07']) await runAt(day(D, t));
    expect(pushes).toHaveLength(1);
    const r = await runAt(day(D, '13:22'));
    expect(r.push).toMatchObject({ members_pushed: 1, matches_pushed: 1 });
    expect(pushes.map((p) => [p.title, p.body])).toEqual([
      ['New alert near Smyrna', 'Hail 1.00 in near Smyrna'],
      ['New alert near Smyrna', 'Tree down on Main St'],
    ]);
    expect(m.tables.holler_matches.every((x) => x.notified === true && typeof x.pushed_at === 'string')).toBe(true);
    expect(emails).toBe(0);
  });

  it('unconfirmed email inside the grace days: the push counts only what is new since the last push', async () => {
    setup({ email_verified_at: null, created_at: day('2026-11-18', '12:00').toISOString() });
    for (const t of ['11:50', '11:52', '11:54', '11:56', '11:58']) match(day(D, t), `Report ${t}`);
    await runAt(day(D, '12:07'));
    expect(pushes.map((p) => p.title)).toEqual(['5 new alerts near Smyrna']);
    match(day(D, '13:20'), 'Roof permit on Elm');
    await runAt(day(D, '13:22'));
    expect(pushes.map((p) => p.title)).toEqual(['5 new alerts near Smyrna', 'New alert near Smyrna']);
    expect(pushes[1].body).toBe('Roof permit on Elm');
  });

  it('unconfirmed email past the grace days (skipped and marked by email) still gets the push', async () => {
    setup({ email_verified_at: null, created_at: day('2026-11-01', '12:00').toISOString() });
    match(day(D, '12:05'), 'Hail 1.00 in near Smyrna');
    const r = await runAt(day(D, '12:07'));
    expect(r.matches_skipped_marked).toBe(1);
    expect(pushes).toHaveLength(1);
  });

  it('before migration 0020 (no pushed_at column) the email digest still runs and push is skipped', async () => {
    setup({});
    match(day(D, '12:05'), 'Hail 1.00 in near Smyrna');
    m.failOn.holler_push_tokens = { code: '42P01', message: 'relation "public.holler_push_tokens" does not exist' };
    const r = await runAt(day(D, '12:07'));
    expect(r.emailed).toBe(1);
    expect(r.push).toMatchObject({ status: 'not_ready' });
    expect(pushes).toEqual([]);
  });
});
