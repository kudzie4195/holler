// Push: the FCM HTTP v1 sender (JWT signing, token cache, error handling, never throws, not_configured) and pushNewMatches
// (one notification per member per run, at most one an hour, preference, access, dead tokens, text from real counts).
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyFcmError, fcmErrorCode, parseServiceAccount, resetFcmCache, sendPush, signAssertion } from '@/lib/push/fcm';
import { buildNotification, pushEntriesFromMatches, pushNewMatches, truncate } from '@/lib/push/notify';
import { activeTokens, registerToken } from '@/lib/push/tokens';
import { fakeDb, profileRow, UA, UB, type FakeDb } from './fakes';
import { memDb, type MemDb, type Row } from './memdb';

type PushDb = Parameters<typeof pushNewMatches>[0];
const asDb = (d: FakeDb) => d as unknown as PushDb & FakeDb;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SA = JSON.stringify({ type: 'service_account', project_id: 'holler-test', client_email: 'push@holler-test.iam.gserviceaccount.com', private_key: PEM, token_uri: 'https://oauth2.googleapis.com/token' });
const MSG = { token: 'tok-1', title: 'New alert near Smyrna', body: 'Hail', data: { type: 'feed', path: '/feed' } };

type Call = { url: string; init: RequestInit };
function fetcher(answers: ((c: Call) => Response)[]) {
  const calls: Call[] = [];
  let i = 0;
  const f = (async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    const a = answers[Math.min(i++, answers.length - 1)];
    return a(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenOk = json(200, { access_token: 'ya29.test', expires_in: 3600 });
const sendOk = json(200, { name: 'projects/holler-test/messages/1' });
const fcmErr = (status: number, code: string, st = 'NOT_FOUND') => json(status, { error: { code: status, status: st, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } });

beforeEach(() => resetFcmCache());

describe('service account and JWT', () => {
  it('parses raw JSON or base64; refuses junk', () => {
    expect(parseServiceAccount(SA)?.project_id).toBe('holler-test');
    expect(parseServiceAccount(Buffer.from(SA).toString('base64'))?.client_email).toContain('push@');
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('{}')).toBeNull();
    expect(parseServiceAccount('not json')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: 'x y', client_email: 'a', private_key: PEM }))).toBeNull();
  });
  it('signs an RS256 assertion for the firebase.messaging scope that verifies with the public key', () => {
    const sa = parseServiceAccount(SA)!;
    const jwt = signAssertion(sa, 1_700_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('sendPush', () => {
  it('not configured: does nothing', async () => {
    const { f, calls } = fetcher([sendOk]);
    expect(await sendPush(MSG, { env: undefined, fetch: f })).toEqual({ ok: false, reason: 'not_configured' });
    expect(calls).toEqual([]);
  });
  it('mints a token once, then sends; the token is cached for the next send', async () => {
    const { f, calls } = fetcher([tokenOk, sendOk, sendOk]);
    expect(await sendPush(MSG, { env: SA, fetch: f, now: () => 1_700_000_000_000 })).toEqual({ ok: true });
    expect(await sendPush(MSG, { env: SA, fetch: f, now: () => 1_700_000_060_000 })).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/holler-test/messages:send',
      'https://fcm.googleapis.com/v1/projects/holler-test/messages:send',
    ]);
    expect(String(calls[0].init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.message).toMatchObject({ token: 'tok-1', notification: { title: 'New alert near Smyrna', body: 'Hail' }, data: { type: 'feed', path: '/feed' }, android: { notification: { channel_id: 'alerts' } } });
  });
  it('re-mints when the cached token is close to expiry', async () => {
    const { f, calls } = fetcher([tokenOk, sendOk, tokenOk, sendOk]);
    await sendPush(MSG, { env: SA, fetch: f, now: () => 0 + 1_000_000 });
    await sendPush(MSG, { env: SA, fetch: f, now: () => 1_000_000 + 3_400_000 });
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(2);
  });
  // Changed in round 7 (fix-f): INVALID_ARGUMENT used to mark the token dead whatever FCM's details said. It is dead now only when
  // the details name the token field; otherwise it is our payload's fault and disables nothing.
  it('UNREGISTERED, NOT_FOUND from FCM, and INVALID_ARGUMENT naming message.token mark the token dead', async () => {
    let r = await sendPush(MSG, { env: SA, fetch: fetcher([tokenOk, fcmErr(404, 'UNREGISTERED')]).f });
    expect(r).toEqual({ ok: false, reason: 'dead', code: 'UNREGISTERED' });
    r = await sendPush(MSG, { env: SA, fetch: fetcher([fcmErr(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT')]).f });
    expect(r).toEqual({ ok: false, reason: 'payload', code: 'INVALID_ARGUMENT' });
    const badToken = json(400, {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        details: [
          { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' },
          { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'not a valid FCM registration token' }] },
        ],
      },
    });
    r = await sendPush(MSG, { env: SA, fetch: fetcher([badToken]).f });
    expect(r).toEqual({ ok: false, reason: 'dead', code: 'INVALID_ARGUMENT' });
  });
  it('a payload error (INVALID_ARGUMENT about another field) is not a dead device', () => {
    const body = (field: string) => ({
      error: { status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field }] }] },
    });
    expect(classifyFcmError(400, body('message.data[0].key'))).toBe('payload');
    expect(classifyFcmError(400, body('message.apns.payload'))).toBe('payload');
    expect(classifyFcmError(400, { error: { status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' } })).toBe('payload');
    expect(classifyFcmError(400, body('message.token'))).toBe('dead');
  });
  it('NOT_FOUND counts only with FCM error detail (a bare 404, such as a wrong project id, kills nothing)', () => {
    expect(classifyFcmError(404, { error: { status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } })).toBe('dead');
    expect(classifyFcmError(404, { error: { status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError' }] } })).toBe('dead');
    expect(classifyFcmError(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } })).toBe('error');
    expect(classifyFcmError(503, { error: { status: 'UNAVAILABLE' } })).toBe('error');
  });
  it('other errors are reported, not thrown, and do not kill the token', async () => {
    expect(await sendPush(MSG, { env: SA, fetch: fetcher([tokenOk, fcmErr(503, 'UNAVAILABLE', 'UNAVAILABLE')]).f })).toEqual({ ok: false, reason: 'error', status: 503, code: 'UNAVAILABLE' });
    resetFcmCache();
    expect(await sendPush(MSG, { env: SA, fetch: fetcher([json(400, { error: 'invalid_grant' })]).f })).toMatchObject({ ok: false, reason: 'error', code: 'AUTH_FAILED' });
    const boom = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    resetFcmCache();
    expect(await sendPush(MSG, { env: SA, fetch: boom })).toMatchObject({ ok: false, reason: 'error', code: 'NETWORK' });
    const garbage = (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch;
    expect(await sendPush(MSG, { env: SA, fetch: garbage })).toMatchObject({ ok: false, reason: 'error' });
  });
  it('a 401 from FCM re-mints the access token once', async () => {
    const { f, calls } = fetcher([tokenOk, json(401, { error: { status: 'UNAUTHENTICATED' } }), tokenOk, sendOk]);
    expect(await sendPush(MSG, { env: SA, fetch: f })).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
  });
  it('fcmErrorCode reads details first, then status', () => {
    expect(fcmErrorCode({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })).toBe('UNREGISTERED');
    expect(fcmErrorCode({ error: { status: 'INTERNAL' } })).toBe('INTERNAL');
    expect(fcmErrorCode(null)).toBe('UNKNOWN');
  });
});

describe('notification text', () => {
  it('real counts, city, the public title at most 80 characters, deep link', () => {
    const one = buildNotification({ count: 1, top: { signalId: 42, title: 'Hail 1.25 in reported', city: 'Smyrna' } }, 'Marietta');
    expect(one).toEqual({ title: 'New alert near Smyrna', body: 'Hail 1.25 in reported', data: { type: 'alert', signalId: '42', path: '/alert/42' } });
    const many = buildNotification({ count: 3, top: { signalId: 42, title: 'x', city: null } }, 'Marietta');
    expect(many.title).toBe('3 new alerts near Marietta');
    expect(many.data).toEqual({ type: 'feed', path: '/feed' });
    expect(buildNotification({ count: 2, top: { signalId: 1, title: 'x', city: null } }, null).title).toBe('2 new alerts for you');
    const long = 'Building permit for a new two story addition with a detached garage and a full roof replacement at the rear';
    const b = buildNotification({ count: 1, top: { signalId: 1, title: long, city: 'Smyrna' } }, null).body;
    expect(b.length).toBeLessThanOrEqual(80);
    expect(b.endsWith('...')).toBe(true);
    expect(truncate('short')).toBe('short');
    expect(/[–—]/.test(one.title + many.title)).toBe(false);
  });
  it('pushEntriesFromMatches: counts per member, newest is the top, ended requests left out, match ids kept', () => {
    const m = pushEntriesFromMatches(
      [
        { id: 11, user_id: UA, created_at: '2026-11-19T10:00:00Z', signal: { id: 1, title: 'Old', city: 'A', occurred_at: '2026-11-19T09:00:00Z' } },
        { id: 12, user_id: UA, created_at: '2026-11-19T11:00:00Z', signal: [{ id: 2, title: 'New', city: 'Smyrna', occurred_at: '2026-11-19T10:00:00Z' }] },
        { id: 13, user_id: UA, created_at: '2026-11-19T12:00:00Z', signal: { id: 3, title: 'Closed request', city: 'X', source: 'holler-request', expires_at: '2026-01-01T00:00:00Z', occurred_at: '2026-11-19T10:00:00Z' } },
        { id: 21, user_id: UB, created_at: '2026-11-19T09:00:00Z', signal: { id: 9, title: 'B', city: null, occurred_at: '2026-11-19T08:00:00Z' } },
        { id: 22, user_id: UB, created_at: '2026-11-19T09:00:00Z', signal: null },
      ],
      Date.parse('2026-11-19T13:00:00Z'),
    );
    expect(m.get(UA)).toEqual({ count: 2, top: { signalId: 2, title: 'New', city: 'Smyrna' }, matchIds: [11, 12] });
    expect(m.get(UB)?.count).toBe(1);
  });
});

// pushNewMatches (round 7, fix-f): push keeps its own record (holler_matches.pushed_at) and reads its own matches, so it no longer
// takes the email path's in-memory list. The tests below are the earlier ones moved to that shape, plus the reviewer's cases.
describe('pushNewMatches', () => {
  const NOW = new Date('2026-11-19T12:00:00Z');
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
  let m: MemDb;
  let sent: { token: string; title: string; body: string }[];
  let result: (token: string) => Awaited<ReturnType<typeof sendPush>>;
  const send = async (x: { token: string; title: string; body: string }) => (sent.push({ token: x.token, title: x.title, body: x.body }), result(x.token));
  let nextMatch = 1;
  const addMatch = (userId: string, createdAt: Date, title = `Hail report ${nextMatch}`, over: Row = {}) => {
    const id = nextMatch++;
    // occurred_at: the record happened when it was matched (news); verify-v1 decision 2 pushes news only
    m.tables.holler_signals.push({ id: 500 + id, title, city: 'Smyrna', source: 'spc', expires_at: null, occurred_at: createdAt.toISOString() });
    m.tables.holler_matches.push({ id, user_id: userId, signal_id: 500 + id, status: 'new', notified: false, pushed_at: null, created_at: createdAt.toISOString(), ...over });
    return id;
  };
  const run = (now: Date, extra: Record<string, unknown> = {}) => pushNewMatches(asDb(m.db), { now, configured: true, send, ...extra });

  beforeEach(() => {
    nextMatch = 1;
    m = memDb({
      holler_profiles: [profileRow(UA), profileRow(UB)],
      holler_push_tokens: [
        { id: 'a1', user_id: UA, token: 'tA1', platform: 'ios', disabled_at: null },
        { id: 'a2', user_id: UA, token: 'tA2', platform: 'android', disabled_at: null },
        { id: 'b1', user_id: UB, token: 'tB1', platform: 'ios', disabled_at: null },
      ],
      holler_matches: [],
      holler_signals: [],
    });
    sent = [];
    result = () => ({ ok: true });
  });

  it('not configured: nothing read, nothing sent', async () => {
    addMatch(UA, at(-5));
    const r = await pushNewMatches(asDb(m.db), { now: NOW, configured: false, send });
    expect(r.status).toBe('not_configured');
    expect(m.db.log).toEqual([]);
    expect(sent).toEqual([]);
  });
  it('one notification per member, to every active device; the hour is claimed and the counted matches stamped', async () => {
    const a = [addMatch(UA, at(-10)), addMatch(UA, at(-8)), addMatch(UA, at(-5), 'Hail 1.25 in reported')];
    addMatch(UB, at(-3));
    const r = await run(NOW);
    expect(r).toMatchObject({ status: 'ok', members_pushed: 2, devices_sent: 3, matches_pushed: 4 });
    expect(sent.filter((s) => s.token.startsWith('tA')).map((s) => [s.title, s.body])).toEqual([
      ['3 new alerts near Smyrna', 'Hail 1.25 in reported'],
      ['3 new alerts near Smyrna', 'Hail 1.25 in reported'],
    ]);
    expect(m.tables.holler_profiles.find((p) => p.user_id === UA)!.last_pushed_at).toBe(NOW.toISOString());
    expect(m.tables.holler_matches.filter((x) => a.includes(x.id as number)).every((x) => x.pushed_at === NOW.toISOString())).toBe(true);
  });
  it('at most one push per member per hour; matches that arrive inside the hour go in the next push, counted once', async () => {
    addMatch(UA, at(-5));
    await run(NOW);
    expect(sent.map((s) => s.title)).toEqual(['New alert near Smyrna', 'New alert near Smyrna']);
    sent = [];
    addMatch(UA, at(20), 'Tree down on Main St');
    const r = await run(at(22));
    expect(sent).toEqual([]);
    expect(r.skipped_recent).toBe(1);
    expect(await run(at(37))).toMatchObject({ members_pushed: 0 });
    expect(await run(at(52))).toMatchObject({ members_pushed: 0 });
    await run(at(61));
    expect(sent.map((s) => [s.title, s.body])).toEqual([
      ['New alert near Smyrna', 'Tree down on Main St'],
      ['New alert near Smyrna', 'Tree down on Main St'],
    ]);
  });
  it('the count is new since the last push, never a running total (matches held back from email still count once)', async () => {
    for (let i = 0; i < 5; i++) addMatch(UA, at(-30 + i));
    await run(NOW);
    expect(sent[0].title).toBe('5 new alerts near Smyrna');
    sent = [];
    addMatch(UA, at(80), 'Roof permit on Elm');
    await run(at(82));
    expect(sent[0].title).toBe('New alert near Smyrna');
    expect(sent[0].body).toBe('Roof permit on Elm');
  });
  it('push does not depend on the email path: a match already marked notified (email off or unconfirmed) is still pushed', async () => {
    addMatch(UA, at(-5), 'Hail 1 in', { notified: true });
    m.tables.holler_profiles.find((p) => p.user_id === UA)!.alert_email = false;
    const r = await run(NOW);
    expect(r.members_pushed).toBeGreaterThanOrEqual(1);
    expect(sent.some((s) => s.token === 'tA1')).toBe(true);
  });
  it('a concurrent run that already claimed the hour wins: no second push', async () => {
    addMatch(UA, at(-5));
    const raw = m.db;
    const orig = raw.from;
    raw.from = (t: string) => {
      const q = orig(t);
      if (t === 'holler_profiles') {
        const u = q.update.bind(q);
        q.update = (p: unknown) => ((m.tables.holler_profiles.find((x) => x.user_id === UA)!.last_pushed_at = NOW.toISOString()), u(p)); // another run claimed it first
      }
      return q;
    };
    const r = await run(NOW);
    expect(sent.filter((s) => s.token.startsWith('tA'))).toEqual([]);
    expect(r.skipped_recent).toBe(1);
    expect(m.tables.holler_matches[0].pushed_at).toBeNull();
  });
  it('nothing new since the last push: no push even after the hour', async () => {
    addMatch(UA, at(-120), 'Old', { pushed_at: at(-110).toISOString() });
    m.tables.holler_profiles.find((p) => p.user_id === UA)!.last_pushed_at = at(-110).toISOString();
    const r = await run(NOW);
    expect(sent).toEqual([]);
    expect(r.skipped_nothing_new).toBe(2); // UA (all pushed) and UB (no matches)
  });
  it('matches older than a day, or no longer new, are never pushed', async () => {
    addMatch(UA, at(-25 * 60));
    addMatch(UA, at(-5), 'Saved one', { status: 'saved' });
    await run(NOW);
    expect(sent).toEqual([]);
  });
  it('respects the push preference and access (locked members get no push)', async () => {
    addMatch(UA, at(-5));
    addMatch(UB, at(-5));
    m.tables.holler_profiles.find((p) => p.user_id === UA)!.push_alerts = false;
    m.tables.holler_profiles.find((p) => p.user_id === UB)!.trial_ends_at = '2026-01-01T00:00:00Z';
    const r = await run(NOW);
    expect(sent).toEqual([]);
    expect(r).toMatchObject({ skipped_off: 1, skipped_locked: 1 });
  });
  it('no device: not considered, hour not claimed, matches wait', async () => {
    m.tables.holler_push_tokens = [];
    addMatch(UA, at(-5));
    const r = await run(NOW);
    expect(r.considered).toBe(0);
    expect(m.tables.holler_profiles.find((p) => p.user_id === UA)!.last_pushed_at).toBeNull();
    expect(m.tables.holler_matches[0].pushed_at).toBeNull();
  });
  it('dead tokens are disabled; errors are counted, never thrown; undelivered matches stay unstamped', async () => {
    addMatch(UA, at(-5));
    const b = addMatch(UB, at(-5));
    result = (t) => (t === 'tA1' ? { ok: false, reason: 'dead', code: 'UNREGISTERED' } : t === 'tB1' ? { ok: false, reason: 'error', status: 500, code: 'INTERNAL' } : { ok: true });
    const r = await run(NOW);
    expect(r).toMatchObject({ members_pushed: 1, devices_sent: 1, dead_tokens: 1, failed: 1 });
    const dis = m.db.log.find((q) => q.table === 'holler_push_tokens' && q.op === 'update')!;
    expect(dis.filters.find((f) => f[0] === 'in')?.[2]).toEqual(['a1']);
    expect(dis.payload).toEqual({ disabled_at: NOW.toISOString() });
    expect(m.tables.holler_matches.find((x) => x.id === b)!.pushed_at).toBeNull();
  });
  it('a payload error disables nothing, is logged once per run, and the matches wait', async () => {
    addMatch(UA, at(-5));
    addMatch(UB, at(-5));
    result = () => ({ ok: false, reason: 'payload', code: 'INVALID_ARGUMENT' });
    const logs: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logs.push(a);
    try {
      const r = await run(NOW);
      expect(r).toMatchObject({ payload_errors: 3, dead_tokens: 0, members_pushed: 0 });
    } finally {
      console.error = orig;
    }
    expect(logs.filter((l) => String(l[0]).includes('payload'))).toHaveLength(1);
    expect(m.db.log.some((q) => q.table === 'holler_push_tokens' && q.op === 'update')).toBe(false);
    expect(m.tables.holler_matches.every((x) => x.pushed_at === null)).toBe(true);
  });
  it('before migration 0020: no table, no push columns, or no pushed_at column -> not_ready, nothing sent', async () => {
    addMatch(UA, at(-5));
    m.failOn.holler_push_tokens = { code: '42P01', message: 'relation "public.holler_push_tokens" does not exist' };
    expect((await run(NOW)).status).toBe('not_ready');
    m.failOn.holler_push_tokens = undefined;
    m.failOn.holler_profiles = { code: '42703', message: 'column push_alerts does not exist' };
    expect((await run(NOW)).status).toBe('not_ready');
    m.failOn.holler_profiles = undefined;
    const raw = m.db;
    const orig = raw.from;
    raw.from = (t: string) => {
      const q = orig(t);
      if (t === 'holler_matches') {
        const is = q.is.bind(q);
        q.is = (c: string, v: unknown) => (c === 'pushed_at' ? ((m.failOn.holler_matches = { code: '42703', message: 'column holler_matches.pushed_at does not exist' }), is(c, v)) : is(c, v));
      }
      return q;
    };
    expect((await run(NOW)).status).toBe('not_ready');
    expect(sent).toEqual([]);
  });
  it('a sender that throws is contained', async () => {
    addMatch(UA, at(-5));
    const r = await pushNewMatches(asDb(m.db), {
      now: NOW,
      configured: true,
      send: async () => {
        throw new Error('boom');
      },
    });
    expect(r.failed).toBe(1);
  });
  it('active tokens are read in pages; a read failure is reported, not hidden as "no device"', async () => {
    m.tables.holler_push_tokens = Array.from({ length: 2500 }, (_, i) => ({ id: `t${String(i).padStart(5, '0')}`, user_id: `u${i % 700}`, token: `tok${i}`, platform: 'ios', disabled_at: null }));
    const r = await run(NOW);
    expect(r.considered).toBe(700);
    const reads = m.db.log.filter((q) => q.table === 'holler_push_tokens' && q.op === 'select');
    expect(reads.length).toBe(3);
    expect(reads.every((q) => q.filters.some((f) => f[0] === 'limit' && f[1] === 1000))).toBe(true);
    // Profile reads are chunked by 200 members.
    const prof = m.db.log.filter((q) => q.table === 'holler_profiles' && q.op === 'select');
    expect(prof.map((q) => (q.filters.find((f) => f[0] === 'in')?.[2] as string[]).length)).toEqual([200, 200, 200, 100]);
    m.failOn.holler_push_tokens = { code: 'XX000', message: 'boom' };
    expect((await run(at(90))).failed).toBe(1);
  });
});

describe('push tokens', () => {
  it('activeTokens reads in chunks of 200 members and reports a failure', async () => {
    const d = fakeDb((q) => ({ data: (q.filters.find((f) => f[0] === 'in')?.[2] as string[]).map((u) => ({ id: u, user_id: u, token: 't', platform: 'ios' })) }));
    const ids = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const r = await activeTokens(asDb(d), ids);
    expect(r.tokens).toHaveLength(450);
    expect(r.error).toBeNull();
    expect(d.log.map((q) => (q.filters.find((f) => f[0] === 'in')?.[2] as string[]).length)).toEqual([200, 200, 50]);
    const bad = await activeTokens(asDb(fakeDb(() => ({ error: { code: 'XX000', message: 'boom' } }))), ids);
    expect(bad.error).toBe('failed');
  });
  it('registering over and over keeps at most 10 rows per member (oldest removed, disabled ones first)', async () => {
    const m = memDb({ holler_push_tokens: [] });
    for (let i = 0; i < 500; i++) {
      const res = await registerToken(asDb(m.db), UA, { token: `fcm-token-${String(i).padStart(4, '0')}-abcdefghijklmnop`, platform: 'ios', appVersion: null }, new Date(Date.UTC(2026, 10, 19, 0, 0, i)));
      expect(res).toBe('ok');
    }
    const mine = m.tables.holler_push_tokens.filter((r) => r.user_id === UA);
    expect(mine).toHaveLength(10);
    expect(mine.map((r) => r.token).sort()[0]).toBe('fcm-token-0490-abcdefghijklmnop');
  });
});
