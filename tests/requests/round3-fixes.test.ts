// Review round 3 (gates/r3/review-requests.md): one test per finding, against the in-memory database (tests/requests/fake-db.ts).
// P1-1 the public record carries no text; the filtered text reaches only the matched business. P1-4 the daily cap holds in parallel.
// P2-3 a close that lands while a confirm or a reply is in flight wins. Retention: ending a request wipes everything personal at once.
// P2-5 limiter mailbox, global cap, REQUESTS_ENABLED. P2-11 the old honeypot name no longer drops a real person.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRequestConfirm } from '@/lib/email/request-emails';
import { requestTextByPublicId, requestTextForMember } from '@/lib/requests/details';
import {
  closeRequest,
  confirmRequest,
  createRequest,
  purgeEndedRequests,
  replyToRequest,
  type Db,
  type ReplierProfile,
} from '@/lib/requests/service';
import { emailRateValue, limiterMailbox, linkToken } from '@/lib/requests/tokens';
import { RESIDENT, SECRET, T0, VALID, harness, tokenIn, type Harness } from './helpers';

const DAY = 86_400_000;
const MESSAGE = 'Hi, we can look at the roof tomorrow morning. Call us at 404-555-0100 any time today.';
const REPLIER: ReplierProfile = {
  business_name: 'Acme Roofing',
  city: 'Atlanta',
  state: 'GA',
  email_verified_at: '2026-11-01T00:00:00.000Z',
  subscription_status: 'trialing',
  trial_ends_at: '2026-12-31T00:00:00.000Z',
};
const USER = { id: 'u-near', email: 'owner@acme-roofing.example' };

beforeEach(() => {
  for (const m of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function openOne(h: Harness, over: Record<string, unknown> = {}) {
  const before = h.sent.length;
  expect(await createRequest(h.deps, { ...VALID, ...over }, '203.0.113.9')).toEqual({ status: 'accepted' });
  const token = tokenIn(h.sent[before].text, '/request/confirm');
  const r = await confirmRequest(h.deps, token);
  expect(r.state).toBe('confirmed');
  const req = h.db.rows('holler_requests').at(-1)!;
  const signal = h.db.rows('holler_signals').find((s) => s.external_id === req.public_id)!;
  const match = h.db.rows('holler_matches').find((m) => m.user_id === 'u-near' && m.signal_id === signal.id)!;
  return { req, signal, match };
}

/** Runs `before` the first time `table` is written with `op`, then lets the write go ahead. Forces an interleaving. */
function beforeFirstWrite(h: Harness, table: string, ops: string[], before: () => Promise<unknown>) {
  const orig = h.db.from.bind(h.db);
  let fired = false;
  (h.db as any).from = (t: string) => {
    const b: any = orig(t);
    if (t !== table) return b;
    for (const op of ops) {
      const m = b[op].bind(b);
      b[op] = (...args: unknown[]) => {
        const inner = m(...args);
        const then = inner.then.bind(inner);
        inner.then = (f: any, r: any) => {
          if (fired) return then(f, r);
          fired = true;
          return before().then(() => then(f, r));
        };
        return inner;
      };
    }
    return b;
  };
}

describe('P1-1: the public record holds no free text; only the matched business gets the filtered text', () => {
  it('confirm writes summary null on holler_signals, keeps the filtered text in holler_requests', async () => {
    const h = harness();
    const { req, signal } = await openOne(h);
    expect(signal.summary).toBeNull();
    expect(JSON.stringify(h.db.rows('holler_signals'))).not.toMatch(/kitchen|storm|Sarah|404/);
    expect(req.public_summary).toContain('Roof leak over the kitchen');
  });

  it('requestTextForMember: only this member, only their own match ids, only while open', async () => {
    const h = harness();
    const { match, req } = await openOne(h);
    const db = h.db as unknown as Db;
    expect(await requestTextForMember(db, 'u-near', [match.id], T0)).toEqual({ [match.id]: req.public_summary });
    // Another member asking for someone else's match id gets nothing.
    expect(await requestTextForMember(db, 'u-far', [match.id], T0)).toEqual({});
    expect(await requestTextForMember(db, 'u-other', [match.id], T0)).toEqual({});
    // After the 14 days: nothing.
    expect(await requestTextForMember(db, 'u-near', [match.id], new Date(T0.getTime() + 15 * DAY))).toEqual({});
    // After close: nothing (and the text itself is wiped).
    await closeRequest(h.deps, linkToken('close', req.id, SECRET));
    expect(await requestTextForMember(db, 'u-near', [match.id], T0)).toEqual({});
    expect(await requestTextByPublicId(db, [req.public_id], T0)).toEqual(new Map());
  });

  it('requestTextByPublicId ignores ids that are not request public ids', async () => {
    const h = harness();
    const { req } = await openOne(h);
    const db = h.db as unknown as Db;
    expect((await requestTextByPublicId(db, [req.public_id, 'x', "req_' or 1=1"], T0)).get(req.public_id)).toBe(req.public_summary);
    expect((await requestTextByPublicId(db, ['x'], T0)).size).toBe(0);
  });
});

describe('P1-4: 10 replies per business per day, also when the replies run in parallel', () => {
  it('15 parallel replies to 15 open requests -> 10 sent, 5 daily_limit, 10 emails', async () => {
    const h = harness();
    const matches: number[] = [];
    for (let i = 0; i < 15; i++) matches.push((await openOne(h, { email: `resident${i}@example.org` })).match.id);
    h.sent.length = 0;
    const results = await Promise.all(
      matches.map((matchId) => replyToRequest(h.deps, { user: USER, profile: REPLIER, matchId, message: MESSAGE })),
    );
    const codes = results.map((r) => r.code);
    expect(codes.filter((c) => c === 'sent')).toHaveLength(10);
    expect(codes.filter((c) => c === 'daily_limit')).toHaveLength(5);
    expect(h.sent).toHaveLength(10);
    expect(h.db.rows('holler_request_replies')).toHaveLength(10);
  });
});

describe('P2-3: a close that lands during a confirm or a reply wins', () => {
  it('close while the confirm is writing the public row: request ends, row expired, nothing matched, no "live" or owner email', async () => {
    const h = harness();
    await createRequest(h.deps, VALID, '203.0.113.9');
    const confirmToken = tokenIn(h.sent[0].text, '/request/confirm');
    const id = h.db.rows('holler_requests')[0].id;
    h.sent.length = 0;
    let closed: unknown;
    beforeFirstWrite(h, 'holler_signals', ['upsert', 'insert'], async () => {
      closed = await closeRequest(h.deps, linkToken('close', id, SECRET));
    });
    const r = await confirmRequest(h.deps, confirmToken);
    expect(closed).toEqual({ state: 'closed' });
    expect(r.state).toBe('ended');
    const req = h.db.rows('holler_requests')[0];
    expect(req).toMatchObject({ status: 'closed', email: null, description: null, public_summary: null });
    expect(req.signal_id ?? null).toBeNull(); // never linked to the public row
    const sig = h.db.rows('holler_signals')[0];
    expect(Date.parse(sig.expires_at)).toBeLessThanOrEqual(T0.getTime());
    expect(h.db.rows('holler_matches')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
    // The next purge deletes the expired row.
    expect((await purgeEndedRequests(h.db as unknown as Db, T0)).signalsDeleted).toBe(1);
    expect(h.db.rows('holler_signals')).toHaveLength(0);
  });

  it('close right after the reply record is written: no email to the deleted address, the record is removed', async () => {
    const h = harness();
    const { match, req } = await openOne(h);
    h.sent.length = 0;
    beforeFirstWrite(h, 'holler_request_replies', ['insert'], async () => {
      await closeRequest(h.deps, linkToken('close', req.id, SECRET));
    });
    const r = await replyToRequest(h.deps, { user: USER, profile: REPLIER, matchId: match.id, message: MESSAGE });
    expect(r.code).toBe('closed');
    expect(h.sent).toHaveLength(0);
    expect(h.db.rows('holler_request_replies')).toHaveLength(0);
  });
});

describe('Retention: ending a request wipes everything personal at once', () => {
  it('close wipes email, raw description, filtered text and the ZIP mid-point; keeps trade, ZIP, city and dates', async () => {
    const h = harness();
    const { req } = await openOne(h);
    expect(await closeRequest(h.deps, linkToken('close', req.id, SECRET))).toEqual({ state: 'closed' });
    const row = h.db.rows('holler_requests')[0];
    expect(row).toMatchObject({ email: null, description: null, public_summary: null, lat: null, lon: null, status: 'closed' });
    expect(row).toMatchObject({ trade: 'roofing', zip: '30301', city: 'Atlanta' });
    expect(row.closed_at).toBeTruthy();
    expect(row.created_at).toBeTruthy();
    expect(JSON.stringify(h.db.tables)).not.toMatch(/kitchen|Sarah|404-555/);
  });

  it('remove (site owner) wipes the same', async () => {
    const h = harness();
    const { req } = await openOne(h);
    expect(await closeRequest(h.deps, linkToken('remove', req.id, SECRET))).toEqual({ state: 'removed' });
    expect(h.db.rows('holler_requests')[0]).toMatchObject({ email: null, description: null, public_summary: null });
  });

  it('a request that runs out keeps them 30 days, then the purge wipes them all', async () => {
    const h = harness();
    await openOne(h);
    const at = (d: number) => new Date(T0.getTime() + d * DAY);
    await purgeEndedRequests(h.db as unknown as Db, at(14 + 29));
    expect(h.db.rows('holler_requests')[0].public_summary).toBeTruthy();
    await purgeEndedRequests(h.db as unknown as Db, at(14 + 31));
    expect(h.db.rows('holler_requests')[0]).toMatchObject({ email: null, description: null, public_summary: null, lat: null, lon: null });
  });
});

describe('P2-5: limiter mailbox, global cap, off switch', () => {
  it('plus-address and dot variants of one mailbox share one limiter key; sending still uses the address as typed', () => {
    for (const v of ['Victim+1@Gmail.com', 'v.i.c.t.i.m@gmail.com', 'victim+x.y@googlemail.com', ' VICTIM@gmail.com ']) {
      expect(limiterMailbox(v)).toBe('victim@gmail.com');
      expect(emailRateValue(v, SECRET)).toBe(emailRateValue('victim@gmail.com', SECRET));
    }
    expect(emailRateValue('other@gmail.com', SECRET)).not.toBe(emailRateValue('victim@gmail.com', SECRET));
  });

  it('variants hit the same per-email limit: the 4th variant in a day is dropped silently', async () => {
    const h = harness();
    const counts = new Map<string, number>();
    h.setHit((limits) => {
      const k = limits[0].key;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return k.startsWith('request:email:') && counts.get(k)! > 3 ? 'limited' : 'allowed';
    });
    for (const email of ['victim+1@gmail.com', 'victim+2@gmail.com', 'v.ictim@gmail.com', 'vic.tim+9@gmail.com']) {
      expect(await createRequest(h.deps, { ...VALID, email }, '203.0.113.9')).toEqual({ status: 'accepted' });
    }
    expect(h.sent).toHaveLength(3);
    expect(h.sent.map((m) => m.to)).toEqual(['victim+1@gmail.com', 'victim+2@gmail.com', 'v.ictim@gmail.com']);
  });

  it('global daily cap reached: nothing stored, no email, the form is told requests are paused', async () => {
    const h = harness();
    h.setHit((l) => (l[0].key === 'request:global:confirm' ? 'limited' : 'allowed'));
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'paused' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('REQUESTS_ENABLED off: createRequest answers paused before anything else', async () => {
    const h = harness();
    h.deps.enabled = false;
    expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'paused' });
    expect(h.hits).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it('confirm email says plainly what happens if it was not you', () => {
    const m = renderRequestConfirm({ confirmUrl: 'https://h.test/c', tradeLabel: 'Roofing', place: 'Atlanta, GA', summary: 'Leak', openDays: 14, confirmDays: 7 });
    for (const part of [m.html, m.text]) {
      expect(part).toContain('If this was not you, ignore this email. Nothing is posted and the request is deleted in 7 days.');
      expect(part).toContain("Holler's public pages show only the service and your city");
    }
  });
});

describe('P2-11: honeypot', () => {
  it('a filled "website" field (old honeypot name, autofilled by a browser) no longer drops a real request', async () => {
    const h = harness();
    expect(await createRequest(h.deps, { ...VALID, website: 'https://me.example' } as never, '203.0.113.9')).toEqual({ status: 'accepted' });
    expect(h.db.rows('holler_requests')).toHaveLength(1);
    expect(h.sent[0].to).toBe(RESIDENT);
  });
  it('the new honeypot field still drops a bot silently', async () => {
    const h = harness();
    expect(await createRequest(h.deps, { ...VALID, leave_blank: 'buy now' }, '203.0.113.9')).toEqual({ status: 'accepted' });
    expect(h.db.rows('holler_requests')).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });
});
