// Criterion 5: every reply rule is enforced on the server (POST /api/requests/reply -> replyToRequest), the reply goes to the resident with
// reply-to set to the business, and the resident's address is only ever the `to` of that email.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = 'help@holler.test';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://holler.test';
});

import { closeRequest, confirmRequest, createRequest, replyStates, replyToRequest } from '@/lib/requests/service';
import { hashToken } from '@/lib/requests/tokens';
import { RESIDENT, T0, VALID, harness, profile, tokenIn, type Harness } from './helpers';

const DAY = 86_400_000;
const MESSAGE = 'Hi, we can look at the roof tomorrow morning. Call us at 404-555-0100 or write to office@acme-roofing.example.';

let h: Harness;
let session: { id: string; email: string | null } | null;
let logs: string[];

beforeEach(() => {
  logs = [];
  for (const m of ['log', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('@/lib/auth/session');
  vi.doUnmock('@/lib/requests/deps');
});

async function openRequest(seed: Record<string, unknown[]> = {}) {
  h = harness(seed as never);
  await createRequest(h.deps, VALID, '203.0.113.9');
  const token = tokenIn(h.sent[0].text, '/request/confirm');
  const r = await confirmRequest(h.deps, token);
  if (r.state !== 'confirmed') throw new Error('confirm failed');
  h.sent.length = 0;
  const match = h.db.rows('holler_matches').find((m) => m.user_id === 'u-near')!;
  session = { id: 'u-near', email: 'owner@acme-roofing.example' };
  return { matchId: match.id as number, request: h.db.rows('holler_requests')[0] };
}

async function route() {
  vi.resetModules();
  vi.doMock('@/lib/auth/session', () => ({ getUser: async () => session }));
  vi.doMock('@/lib/requests/deps', () => ({ requestDeps: () => h.deps }));
  return (await import('../../app/api/requests/reply/route')).POST;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const POST = await route();
  const res = await POST(
    new Request('https://holler.test/api/requests/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as { ok: boolean; code: string; message: string } };
}

function setProfile(userId: string, over: Record<string, unknown>) {
  const p = h.db.rows('holler_profiles').find((x) => x.user_id === userId)!;
  Object.assign(p, over);
}

describe('POST /api/requests/reply: success', () => {
  it('emails the resident, reply-to the business, records who replied and when (no text, no resident address)', async () => {
    const { matchId, request } = await openRequest();
    const res = await post({ matchId, message: MESSAGE });
    expect(res).toEqual({ status: 200, body: { ok: true, code: 'sent', message: expect.any(String) } });

    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0];
    expect(mail.to).toBe(RESIDENT);
    expect(mail.replyTo).toBe('owner@acme-roofing.example');
    expect(mail.subject).toBe('Biz u-near replied to your request on Holler');
    expect(mail.text).toContain(MESSAGE); // the business may share its own phone and email
    expect(mail.text).toContain('From Biz u-near, Atlanta, GA.');
    const closeToken = tokenIn(mail.text, '/request/close');
    expect(hashToken('close', closeToken)).toBe(request.close_token_hash);
    expect(mail.html).toContain('mailto:help@holler.test?subject=Report%20reply%20');
    expect(mail.html).toContain('Report this reply');
    // The resident's address is the `to` and nothing else.
    expect(JSON.stringify({ ...mail, to: null })).not.toContain(RESIDENT);

    const replies = h.db.rows('holler_request_replies');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ request_id: request.id, user_id: 'u-near', match_id: matchId, created_at: T0.toISOString() });
    expect(Object.keys(replies[0]).sort()).toEqual(['created_at', 'id', 'match_id', 'request_id', 'user_id']);
    expect(JSON.stringify(res.body)).not.toContain(RESIDENT);
    expect(logs.join('\n')).not.toContain(RESIDENT);
  });

  it('the feed state turns to "replied" for this business and stays "open" for others', async () => {
    const { matchId } = await openRequest({ holler_profiles: [profile('u-near'), profile('u-two')] });
    const other = h.db.rows('holler_matches').find((m) => m.user_id === 'u-two')!;
    expect(await replyStates(h.db as never, 'u-near', [matchId], T0)).toEqual({ [matchId]: 'open' });
    await post({ matchId, message: MESSAGE });
    expect(await replyStates(h.db as never, 'u-near', [matchId], T0)).toEqual({ [matchId]: 'replied' });
    expect(await replyStates(h.db as never, 'u-two', [other.id], T0)).toEqual({ [other.id]: 'open' });
    // Someone else's match id is ignored.
    expect(await replyStates(h.db as never, 'u-two', [matchId], T0)).toEqual({});
  });
});

describe('POST /api/requests/reply: refusals', () => {
  it('no session: 401', async () => {
    const { matchId } = await openRequest();
    session = null;
    expect((await post({ matchId, message: MESSAGE })).status).toBe(401);
    expect(h.sent).toHaveLength(0);
  });

  it('email not verified: 403', async () => {
    const { matchId } = await openRequest();
    setProfile('u-near', { email_verified_at: null });
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 403, body: { code: 'unverified' } });
  });

  it('no profile: 403', async () => {
    const { matchId } = await openRequest();
    h.db.tables.holler_profiles = h.db.rows('holler_profiles').filter((p) => p.user_id !== 'u-near');
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 403, body: { code: 'no_profile' } });
  });

  it.each([
    [{ subscription_status: 'trialing', trial_ends_at: '2026-11-16T00:00:00.000Z' }],
    [{ subscription_status: 'canceled' }],
  ])('no current access (%o): 403', async (over) => {
    const { matchId } = await openRequest();
    setProfile('u-near', over);
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 403, body: { code: 'no_access' } });
  });

  it('paid access works after the trial', async () => {
    const { matchId } = await openRequest();
    setProfile('u-near', { subscription_status: 'active', trial_ends_at: '2026-01-01T00:00:00.000Z' });
    expect((await post({ matchId, message: MESSAGE })).status).toBe(200);
  });

  it("another member's match: 404", async () => {
    const { matchId } = await openRequest({ holler_profiles: [profile('u-near'), profile('u-other', { lat: 40.7, lon: -74, state: 'NY' })] });
    session = { id: 'u-other', email: 'other@biz.example' };
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 404, body: { code: 'not_found' } });
    expect(h.sent).toHaveLength(0);
  });

  it('a match on a record that is not a resident request: 400', async () => {
    const { matchId } = await openRequest();
    h.db.rows('holler_signals').push({ id: 999, source: 'nws', external_id: 'x', kind: 'alert' });
    h.db.rows('holler_matches').push({ id: 555, user_id: 'u-near', signal_id: 999 });
    expect(await post({ matchId: 555, message: MESSAGE })).toMatchObject({ status: 400, body: { code: 'not_request' } });
    expect(matchId).not.toBe(555);
  });

  it('one reply per business: the second is refused (409)', async () => {
    const { matchId } = await openRequest();
    expect((await post({ matchId, message: MESSAGE })).status).toBe(200);
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 409, body: { code: 'already_replied' } });
    expect(h.sent).toHaveLength(1);
  });

  it('5 replies per request: the sixth is refused (409)', async () => {
    const { matchId, request } = await openRequest();
    for (let i = 0; i < 5; i++) h.db.rows('holler_request_replies').push({ id: 100 + i, request_id: request.id, user_id: `x${i}`, created_at: T0.toISOString() });
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 409, body: { code: 'full' } });
    expect(await replyStates(h.db as never, 'u-near', [matchId], T0)).toEqual({ [matchId]: 'full' });
  });

  it('the database guard settles a race on the fifth reply', async () => {
    const { matchId, request } = await openRequest();
    for (let i = 0; i < 5; i++) h.db.rows('holler_request_replies').push({ id: 100 + i, request_id: request.id, user_id: `x${i}`, created_at: T0.toISOString() });
    // Pretend the count read happened before the others landed: the insert still fails on the guard.
    const res = await replyToRequest(
      { ...h.deps, db: wrapCount(h) },
      { user: { id: 'u-near', email: 'owner@acme-roofing.example' }, profile: profile('u-near') as never, matchId, message: MESSAGE },
    );
    expect(res.code).toBe('full');
  });

  it('10 replies per business per day: the eleventh is refused (429), older ones do not count', async () => {
    const { matchId } = await openRequest();
    const replies = h.db.rows('holler_request_replies');
    for (let i = 0; i < 10; i++) replies.push({ id: 200 + i, request_id: `other-${i}`, user_id: 'u-near', created_at: new Date(T0.getTime() - 3600_000).toISOString() });
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 429, body: { code: 'daily_limit' } });
    for (const r of replies) if (r.user_id === 'u-near') r.created_at = new Date(T0.getTime() - 25 * 3600_000).toISOString();
    expect((await post({ matchId, message: MESSAGE })).status).toBe(200);
  });

  it('closed request: 409, and the feed shows it closed', async () => {
    const { matchId, request } = await openRequest();
    const { closeUrlFor } = await import('@/lib/requests/service');
    const token = new URL(closeUrlFor('https://holler.test', request.id, 'test-secret-for-request-links')).searchParams.get('token')!;
    await closeRequest(h.deps, token);
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 409, body: { code: 'closed' } });
    expect(await replyStates(h.db as never, 'u-near', [matchId], T0)).toEqual({ [matchId]: 'closed' });
    expect(h.sent).toHaveLength(0);
  });

  it('expired request (past 14 days): 409', async () => {
    const { matchId } = await openRequest();
    h.setNow(new Date(T0.getTime() + 15 * DAY));
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 409, body: { code: 'closed' } });
  });

  it.each([
    ['too short', 'Call us.'],
    ['too long', 'x'.repeat(801)],
    ['control characters', 'We can come tomorrow morning \u0000 at nine.'],
    ['not text', 42],
  ])('message %s: 400', async (_name, message) => {
    const { matchId } = await openRequest();
    expect(await post({ matchId, message })).toMatchObject({ status: 400, body: { code: 'invalid' } });
  });

  it.each([['abc'], [-1], [null], [1.5]])('bad matchId %o: 400', async (matchId) => {
    await openRequest();
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 400 });
  });

  it('send failure: 502 and the reply record is removed so the business can try again', async () => {
    const { matchId } = await openRequest();
    h.setSend(() => false);
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 502, body: { code: 'send_failed' } });
    expect(h.db.rows('holler_request_replies')).toHaveLength(0);
    h.setSend(() => true);
    expect((await post({ matchId, message: MESSAGE })).status).toBe(200);
  });

  it('attempt limiter: 429', async () => {
    const { matchId } = await openRequest();
    h.setHit(() => 'limited');
    expect(await post({ matchId, message: MESSAGE })).toMatchObject({ status: 429, body: { code: 'limited' } });
  });

  it('JSON only and same origin', async () => {
    const { matchId } = await openRequest();
    const POST = await route();
    const form = await POST(new Request('https://holler.test/api/requests/reply', { method: 'POST', body: 'matchId=1' }));
    expect(form.status).toBe(415);
    expect((await post({ matchId, message: MESSAGE }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(h.sent).toHaveLength(0);
  });
});

/** Database wrapper whose request-count read reports 0, to reach the insert as if two businesses raced. */
function wrapCount(hh: Harness) {
  const real = hh.db;
  return {
    from(table: string) {
      const b = real.from(table);
      if (table !== 'holler_request_replies') return b;
      const origSelect = b.select.bind(b);
      (b as unknown as { select: unknown }).select = (cols?: string, o?: { count?: string; head?: boolean }) => {
        if (o?.head) {
          const zero = Promise.resolve({ count: 0, error: null, data: null });
          return { eq: () => Object.assign(zero, { gte: () => zero }) };
        }
        return origSelect(cols, o);
      };
      return b;
    },
  } as never;
}
