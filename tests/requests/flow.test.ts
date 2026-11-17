// Create -> confirm -> close / remove -> housekeeping, against an in-memory database (tests/requests/fake-db.ts).
// Criteria 1 (no resident email anywhere public), 3 (unconfirmed never public, confirm idempotent, unknown tokens), 4 (limits, honeypot),
// 6 (close and remove) and the housekeeping job.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeRequest, confirmRequest, createRequest, purgeEndedRequests } from '@/lib/requests/service';
import { hashToken, randomToken } from '@/lib/requests/tokens';
import { RESIDENT, SECRET, T0, VALID, harness, tokenIn, type Harness } from './helpers';

const DAY = 86_400_000;
let logs: string[];

beforeEach(() => {
  logs = [];
  for (const m of ['log', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

async function created(h: Harness, over: Record<string, unknown> = {}) {
  const r = await createRequest(h.deps, { ...VALID, ...over }, '203.0.113.9');
  expect(r).toEqual({ status: 'accepted' });
  const mail = h.sent[h.sent.length - 1];
  return { mail, confirmToken: tokenIn(mail.text, '/request/confirm') };
}

function expectNoResidentEmail(h: Harness) {
  expect(JSON.stringify(h.db.rows('holler_signals'))).not.toContain(RESIDENT);
  expect(JSON.stringify(h.db.rows('holler_matches'))).not.toContain(RESIDENT);
  expect(JSON.stringify(h.db.rows('holler_request_replies'))).not.toContain(RESIDENT);
  expect(JSON.stringify(h.db.rows('holler_rate_limits'))).not.toContain(RESIDENT);
  for (const m of h.sent.filter((x) => x.to !== RESIDENT)) {
    expect(JSON.stringify(m)).not.toContain(RESIDENT);
  }
  expect(logs.join('\n')).not.toContain(RESIDENT);
  expect(JSON.stringify(h.hits)).not.toContain(RESIDENT);
}

describe('createRequest', () => {
  it('stores a pending row and emails a confirm link; nothing is public or matched yet', async () => {
    const h = harness();
    const { mail, confirmToken } = await created(h);
    const rows = h.db.rows('holler_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', trade: 'roofing', zip: '30301', city: 'Atlanta', state: 'GA', email: RESIDENT });
    expect(mail.to).toBe(RESIDENT);
    expect(mail.subject).toBe('Confirm your request on Holler');
    // Only hashes are stored, each different, none equal to the raw token.
    expect(rows[0].confirm_token_hash).toBe(hashToken('confirm', confirmToken));
    for (const k of ['confirm_token_hash', 'close_token_hash', 'remove_token_hash']) expect(rows[0][k]).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([rows[0].confirm_token_hash, rows[0].close_token_hash, rows[0].remove_token_hash]).size).toBe(3);
    expect(JSON.stringify(h.db.tables)).not.toContain(confirmToken);
    // Unconfirmed: no public record, no matches.
    expect(h.db.rows('holler_signals')).toHaveLength(0);
    expect(h.db.rows('holler_matches')).toHaveLength(0);
    expectNoResidentEmail(h);
  });

  it('the confirm email previews the scrubbed public text, not the raw description', async () => {
    const h = harness();
    const { mail } = await created(h);
    expect(mail.text).not.toContain('404-555-1212');
    expect(mail.text).not.toContain('Sarah');
    expect(mail.text).toContain('Roof leak over the kitchen');
  });

  it.each([
    [{ trade: '' }, 'trade'],
    [{ trade: 'rideshare-delivery' }, 'trade'],
    [{ trade: 'not-a-trade' }, 'trade'],
    [{ zip: '3030' }, 'zip'],
    [{ zip: '00000' }, 'zip'],
    [{ description: 'too short' }, 'description'],
    [{ description: 'x'.repeat(501) }, 'description'],
    [{ description: '\u{1F600}'.repeat(15) }, 'description'],
    [{ description: 'Roof leak over the kitchen\u0007 after the storm' }, 'description'],
    [{ email: 'not-an-email' }, 'email'],
    [{ consent: false }, 'consent'],
    [{ consent: undefined }, 'consent'],
  ])('rejects %o with an error on %s', async (over, field) => {
    const h = harness();
    const r = await createRequest(h.deps, { ...VALID, ...over }, '203.0.113.9');
    expect(r.status).toBe('invalid');
    expect(r.status === 'invalid' && r.errors[field as 'trade']).toBeTruthy();
    expect(h.db.rows('holler_requests')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('honeypot: accepted with the same answer, nothing stored, nothing sent, limiter not touched', async () => {
    const h = harness();
    const r = await createRequest(h.deps, { ...VALID, leave_blank: 'http://spam.example' }, '203.0.113.9');
    expect(r).toEqual({ status: 'accepted' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
    expect(h.hits).toHaveLength(0);
  });

  it('per-IP limit answers "limited" and stores nothing', async () => {
    const h = harness();
    h.setHit((l) => (l[0].key.startsWith('request:ip:') ? 'limited' : 'allowed'));
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'limited' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('per-email limit is silent: same "accepted" answer, nothing stored, nothing sent', async () => {
    const h = harness();
    h.setHit((l) => (l[0].key.startsWith('request:email:') ? 'limited' : 'allowed'));
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'accepted' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('limit keys: one per IP and one per email, the email key is a keyed hash (no address, no plain sha256)', async () => {
    const h = harness();
    await created(h);
    const keys = h.hits.map((l) => l[0]);
    expect(keys.map((k) => k.key.split(':').slice(0, 2).join(':'))).toEqual(['request:ip', 'request:email', 'request:global']);
    expect(keys[2]).toMatchObject({ key: 'request:global:confirm', max: 300, windowSeconds: 86_400 });
    expect(keys[0]).toMatchObject({ max: 5, windowSeconds: 3600 });
    expect(keys[1]).toMatchObject({ max: 3, windowSeconds: 86_400 });
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update(RESIDENT).digest('hex').slice(0, 32);
    expect(keys[1].key).not.toContain(plain);
    expect(keys[1].key).not.toContain('example.org');
  });

  it('limiter outage fails closed (no email goes out)', async () => {
    const h = harness();
    h.setHit(() => 'error');
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'unavailable' });
    expect(h.sent).toHaveLength(0);
  });

  it('a repeated email gets the same answer as a new one', async () => {
    const h = harness();
    const a = await createRequest(h.deps, VALID, '203.0.113.9');
    const b = await createRequest(h.deps, VALID, '203.0.113.9');
    const c = await createRequest(h.deps, { ...VALID, email: 'someone.else@example.net' }, '203.0.113.9');
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('when the confirm email cannot be sent the row is dropped', async () => {
    const h = harness();
    h.setSend(() => false);
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'unavailable' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
  });

  it('without the server secret nothing is stored', async () => {
    const h = harness();
    h.deps.secret = undefined;
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'unavailable' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
  });
});

describe('confirmRequest', () => {
  it('opens the request for 14 days, writes ONE public record and matches nearby members', async () => {
    const h = harness();
    const { confirmToken } = await created(h);
    const r = await confirmRequest(h.deps, confirmToken);
    expect(r.state).toBe('confirmed');
    const req = h.db.rows('holler_requests')[0];
    expect(req.status).toBe('open');
    expect(req.expires_at).toBe(new Date(T0.getTime() + 14 * DAY).toISOString());

    const signals = h.db.rows('holler_signals');
    expect(signals).toHaveLength(1);
    const s = signals[0];
    expect(s).toMatchObject({
      source: 'holler-request',
      kind: 'ask',
      external_id: req.public_id,
      categories: ['roofing'],
      city: 'Atlanta',
      state: 'GA',
      zip: '30301',
      severity: 2,
      url: 'https://holler.test/request',
      title: 'Service request in Atlanta: Roofing',
      occurred_at: T0.toISOString(),
      expires_at: req.expires_at,
      data: {},
    });
    expect(s.place_slug).toBeTruthy();
    expect(s.lat).toBeCloseTo(33.8444, 3);
    expect(s.lon).toBeCloseTo(-84.4741, 3);
    // Round 3 P1-1: the public row carries no free text; the filtered text stays in holler_requests (service role only).
    expect(s.summary).toBeNull();
    expect(req.public_summary).toContain('Roof leak over the kitchen');
    expect(req.public_summary).not.toMatch(/404|555|1212|Sarah|Connor/);
    expect(req.signal_id).toBe(s.id);

    const matches = h.db.rows('holler_matches');
    expect(matches.map((m) => m.user_id)).toEqual(['u-near']);
    expect(matches[0].signal_id).toBe(s.id);
    expectNoResidentEmail(h);
  });

  it('emails the site owner the text with a remove link, never the resident address', async () => {
    const h = harness();
    const { confirmToken } = await created(h);
    await confirmRequest(h.deps, confirmToken);
    const admin = h.sent.find((m) => m.to === 'owner@holler.test')!;
    expect(admin).toBeTruthy();
    expect(admin.text).toContain('Roof leak over the kitchen');
    expect(admin.text).toMatch(/\/request\/close\?token=[A-Za-z0-9_-]{43}/);
    expect(JSON.stringify(admin)).not.toContain(RESIDENT);
  });

  it('confirming twice is harmless: one record, no duplicate matches, one admin email', async () => {
    const h = harness();
    const { confirmToken } = await created(h);
    await confirmRequest(h.deps, confirmToken);
    const again = await confirmRequest(h.deps, confirmToken);
    expect(again.state).toBe('already_open');
    expect(h.db.rows('holler_signals')).toHaveLength(1);
    expect(h.db.rows('holler_matches')).toHaveLength(1);
    expect(h.sent.filter((m) => m.to === 'owner@holler.test')).toHaveLength(1);
    expect(h.db.rows('holler_requests')[0].expires_at).toBe(new Date(T0.getTime() + 14 * DAY).toISOString());
  });

  it('unknown, malformed and expired tokens answer "invalid" and publish nothing', async () => {
    const h = harness();
    const { confirmToken } = await created(h);
    expect(await confirmRequest(h.deps, randomToken())).toEqual({ state: 'invalid' });
    expect(await confirmRequest(h.deps, 'short')).toEqual({ state: 'invalid' });
    expect(await confirmRequest(h.deps, undefined)).toEqual({ state: 'invalid' });
    h.setNow(new Date(T0.getTime() + 8 * DAY));
    expect(await confirmRequest(h.deps, confirmToken)).toEqual({ state: 'invalid' });
    expect(h.db.rows('holler_signals')).toHaveLength(0);
    expect(h.db.rows('holler_matches')).toHaveLength(0);
  });

  it('a request past its 14 days counts as closed', async () => {
    const h = harness();
    const { confirmToken } = await created(h);
    await confirmRequest(h.deps, confirmToken);
    h.setNow(new Date(T0.getTime() + 15 * DAY));
    expect(await confirmRequest(h.deps, confirmToken)).toEqual({ state: 'ended' });
  });

  it('if the public record cannot be written the request goes back to pending and the link still works', async () => {
    const h = harness();
    const { confirmToken } = await created(h);
    h.db.failOn['holler_signals.upsert'] = 'boom';
    expect(await confirmRequest(h.deps, confirmToken)).toEqual({ state: 'error' });
    expect(h.db.rows('holler_requests')[0].status).toBe('pending');
    delete h.db.failOn['holler_signals.upsert'];
    expect((await confirmRequest(h.deps, confirmToken)).state).toBe('confirmed');
  });
});

describe('closeRequest (resident) and remove (site owner)', () => {
  async function open(h: Harness) {
    const { confirmToken } = await created(h);
    const r = await confirmRequest(h.deps, confirmToken);
    if (r.state !== 'confirmed') throw new Error('not confirmed');
    const closeToken = new URL(r.closeUrl).searchParams.get('token')!;
    const admin = h.sent.find((m) => m.to === 'owner@holler.test')!;
    const removeToken = tokenIn(admin.text, '/request/close');
    return { confirmToken, closeToken, removeToken };
  }

  it('close: status closed, email deleted, public record expired and its summary removed', async () => {
    const h = harness();
    const { closeToken } = await open(h);
    h.setNow(new Date(T0.getTime() + 2 * DAY));
    expect(await closeRequest(h.deps, closeToken)).toEqual({ state: 'closed' });
    const req = h.db.rows('holler_requests')[0];
    expect(req.status).toBe('closed');
    expect(req.email).toBeNull();
    expect(req.closed_at).toBe(new Date(T0.getTime() + 2 * DAY).toISOString());
    const s = h.db.rows('holler_signals')[0];
    expect(s.expires_at).toBe(new Date(T0.getTime() + 2 * DAY).toISOString());
    expect(s.summary).toBeNull();
    expect(JSON.stringify(h.db.tables)).not.toContain(RESIDENT);
  });

  it('close twice is harmless', async () => {
    const h = harness();
    const { closeToken } = await open(h);
    await closeRequest(h.deps, closeToken);
    expect(await closeRequest(h.deps, closeToken)).toEqual({ state: 'already_closed' });
    expect(h.db.rows('holler_requests')[0].status).toBe('closed');
  });

  it('remove (admin link): status removed, email deleted, public record expired', async () => {
    const h = harness();
    const { removeToken } = await open(h);
    expect(await closeRequest(h.deps, removeToken)).toEqual({ state: 'removed' });
    const req = h.db.rows('holler_requests')[0];
    expect(req.status).toBe('removed');
    expect(req.email).toBeNull();
    expect(req.removed_at).toBe(T0.toISOString());
    expect(h.db.rows('holler_signals')[0].expires_at).toBe(T0.toISOString());
    expect(JSON.stringify(h.db.tables)).not.toContain(RESIDENT);
  });

  it('remove after the resident closed it still marks it removed', async () => {
    const h = harness();
    const { closeToken, removeToken } = await open(h);
    await closeRequest(h.deps, closeToken);
    expect(await closeRequest(h.deps, removeToken)).toEqual({ state: 'removed' });
  });

  it('a closed request cannot be confirmed again', async () => {
    const h = harness();
    const { confirmToken, closeToken } = await open(h);
    await closeRequest(h.deps, closeToken);
    expect(await confirmRequest(h.deps, confirmToken)).toEqual({ state: 'ended' });
  });

  it('closing before confirming deletes the email and nothing ever becomes public', async () => {
    const h = harness();
    await created(h);
    const id = h.db.rows('holler_requests')[0].id as string;
    const { closeUrlFor } = await import('@/lib/requests/service');
    const token = new URL(closeUrlFor('https://holler.test', id, SECRET)).searchParams.get('token')!;
    expect(await closeRequest(h.deps, token)).toEqual({ state: 'closed' });
    expect(h.db.rows('holler_requests')[0].email).toBeNull();
    expect(h.db.rows('holler_signals')).toHaveLength(0);
  });

  it('token kinds are separate: a confirm token does not close, a close token does not confirm, unknown tokens are invalid', async () => {
    const h = harness();
    const { confirmToken, closeToken } = await open(h);
    expect(await closeRequest(h.deps, confirmToken)).toEqual({ state: 'invalid' });
    expect(await confirmRequest(h.deps, closeToken)).toEqual({ state: 'invalid' });
    expect(await closeRequest(h.deps, randomToken())).toEqual({ state: 'invalid' });
    expect(await closeRequest(h.deps, '../../etc')).toEqual({ state: 'invalid' });
    expect(h.db.rows('holler_requests')[0].status).toBe('open');
  });
});

describe('purgeEndedRequests (housekeeping for the scan cron)', () => {
  it('wipes email and description 30 days after a request ended and deletes stale unconfirmed rows', async () => {
    const h = harness({
      holler_requests: [
        { id: 'a', public_id: 'a', status: 'closed', email: 'a@x.org', description: 'd'.repeat(30), closed_at: new Date(T0.getTime() - 31 * DAY).toISOString(), purged_at: null },
        { id: 'b', public_id: 'b', status: 'removed', email: null, description: 'd'.repeat(30), closed_at: new Date(T0.getTime() - 40 * DAY).toISOString(), purged_at: null },
        { id: 'c', public_id: 'c', status: 'closed', email: null, description: 'd'.repeat(30), closed_at: new Date(T0.getTime() - 10 * DAY).toISOString(), purged_at: null },
        { id: 'd', public_id: 'd', status: 'open', email: 'd@x.org', description: 'd'.repeat(30), expires_at: new Date(T0.getTime() - 31 * DAY).toISOString(), purged_at: null },
        { id: 'e', public_id: 'e', status: 'open', email: 'e@x.org', description: 'd'.repeat(30), expires_at: new Date(T0.getTime() + 3 * DAY).toISOString(), purged_at: null },
        { id: 'f', public_id: 'f', status: 'pending', email: 'f@x.org', description: 'd'.repeat(30), created_at: new Date(T0.getTime() - 8 * DAY).toISOString() },
        { id: 'g', public_id: 'g', status: 'pending', email: 'g@x.org', description: 'd'.repeat(30), created_at: new Date(T0.getTime() - 2 * DAY).toISOString() },
      ],
    });
    const r = await purgeEndedRequests(h.db as never, T0);
    expect(r).toEqual({ purged: 3, deletedPending: 1, signalsDeleted: 0, error: null });
    const by = Object.fromEntries(h.db.rows('holler_requests').map((x) => [x.id, x]));
    for (const id of ['a', 'b', 'd']) {
      expect(by[id].email).toBeNull();
      expect(by[id].description).toBeNull();
      expect(by[id].purged_at).toBe(T0.toISOString());
    }
    expect(by.c.description).not.toBeNull();
    expect(by.e.email).toBe('e@x.org');
    expect(by.f).toBeUndefined();
    expect(by.g.email).toBe('g@x.org');
    // Second run: nothing left to do.
    expect(await purgeEndedRequests(h.db as never, T0)).toEqual({ purged: 0, deletedPending: 0, signalsDeleted: 0, error: null });
  });

  it('never throws and reports database errors', async () => {
    const h = harness();
    h.db.failOn['holler_requests.update'] = 'no table';
    const r = await purgeEndedRequests(h.db as never, T0);
    expect(r.error).toContain('no table');
  });
});
