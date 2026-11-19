/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { runMoat } from '@/lib/moat/run';
import { verifyOutcomeToken } from '@/lib/moat/token';
import { verifyUnsubscribeToken } from '@/lib/email/token';
import { makeDb } from './fakedb';

vi.mock('server-only', () => ({}));

const SECRET = 'test-secret-value';
const SITE = 'https://example.test';
const NOW = new Date('2026-11-19T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function profile(user_id: string, over: Record<string, unknown> = {}) {
  return {
    user_id,
    business_name: 'Acme Roofing',
    alert_email: true,
    subscription_status: 'active',
    trial_ends_at: null,
    last_notified_at: new Date(NOW.getTime() - 60_000).toISOString(), // emailed a minute ago: the hourly digest throttle must not block this
    email_verified_at: daysAgo(30),
    created_at: daysAgo(40),
    ...over,
  };
}
function world(n: number, over: Record<string, unknown> = {}) {
  const feedback: any[] = [];
  const signals: any[] = [];
  for (let i = 1; i <= n; i++) {
    feedback.push({ user_id: 'u1', signal_id: i, verdict: 'useful', updated_at: daysAgo(10 + i * 0.01) });
    signals.push({ id: i, source: 'nws', kind: 'alert', title: `Storm ${i}`, city: 'Marietta', state: 'GA', occurred_at: daysAgo(12) });
  }
  return makeDb(
    { holler_signal_feedback: feedback, holler_signals: signals, holler_profiles: [profile('u1', over)], holler_outcome_asks: [] },
    { users: { u1: 'u1@example.test' } },
  );
}
const okSend = () => vi.fn(async () => ({ ok: true as const }));
const args = (db: any, send: any, extra: Record<string, unknown> = {}) => ({ db, now: NOW, dry: false, siteUrl: SITE, secret: SECRET, send, ...extra });

describe('runMoat', () => {
  it('sends one email with at most 5 alerts and marks exactly those as asked', async () => {
    const db = world(7);
    const send = okSend();
    const c = await runMoat(args(db, send));
    expect(send).toHaveBeenCalledTimes(1);
    expect(c.emailed).toBe(1);
    expect(c.emailed_alerts).toBe(5);
    expect(db.tables.holler_outcome_asks).toHaveLength(5);
    expect(db.tables.holler_outcome_asks.every((a: any) => a.channel === 'email' && a.answer === undefined)).toBe(true);
    const mail = (send.mock.calls[0] as any[])[0];
    expect((mail.text.match(/^Yes: /gm) ?? []).length).toBe(5);
  });

  it('asks each alert once: a second run the same day sends nothing and adds nothing', async () => {
    const db = world(3);
    const send = okSend();
    await runMoat(args(db, send));
    const again = await runMoat(args(db, send));
    expect(send).toHaveBeenCalledTimes(1);
    expect(again.emailed).toBe(0);
    expect(db.tables.holler_outcome_asks).toHaveLength(3);
  });

  it('at most one follow-up email per member per week; the rest wait for next week', async () => {
    const db = world(7);
    const send = okSend();
    await runMoat(args(db, send));
    const sameWeek = await runMoat(args(db, send, { now: new Date(NOW.getTime() + 3 * 86_400_000) }));
    expect(sameWeek.skipped_gap).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const nextWeek = await runMoat(args(db, send, { now: new Date(NOW.getTime() + 8 * 86_400_000) }));
    expect(nextWeek.emailed_alerts).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(db.tables.holler_outcome_asks).toHaveLength(7);
  });

  it('respects the unsubscribe: alerts off means no email, only a feed ask', async () => {
    const db = world(2, { alert_email: false });
    const send = okSend();
    const c = await runMoat(args(db, send));
    expect(send).not.toHaveBeenCalled();
    expect(c.skipped_ineligible).toBe(1);
    expect(db.tables.holler_outcome_asks.map((a: any) => a.channel)).toEqual(['feed', 'feed']);
  });

  it('does not email an unverified, canceled or expired-trial member', async () => {
    for (const over of [{ email_verified_at: null }, { subscription_status: 'canceled' }, { subscription_status: 'trialing', trial_ends_at: daysAgo(1) }]) {
      const db = world(1, over);
      const send = okSend();
      await runMoat(args(db, send));
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('dry run reads and counts but sends and writes nothing', async () => {
    const db = world(4);
    const send = okSend();
    const c = await runMoat(args(db, send, { dry: true }));
    expect(c.dry).toBe(true);
    expect(c.emailed_alerts).toBe(4);
    expect(send).not.toHaveBeenCalled();
    expect(db.tables.holler_outcome_asks).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
  });

  it('skips alerts marked Led to work, answered or asked already, too recent, and resident requests', async () => {
    const db = world(5);
    db.tables.holler_signal_feedback[0].verdict = 'led_to_work';
    db.tables.holler_signal_feedback[1].updated_at = daysAgo(3);
    db.tables.holler_outcome_asks.push({ user_id: 'u1', signal_id: 3, channel: 'feed', asked_at: daysAgo(2), answer: 'no' });
    db.tables.holler_signals[3].source = 'holler-request';
    const send = okSend();
    await runMoat(args(db, send));
    const mail = (send.mock.calls[0] as any[])[0];
    expect((mail.text.match(/^Yes: /gm) ?? []).length).toBe(1);
    expect(mail.text).toContain('Storm 5');
    expect(mail.text).not.toContain('Storm 1\n');
  });

  it('leaves alerts marked Useful over 37 days ago alone', async () => {
    const db = world(1);
    db.tables.holler_signal_feedback[0].updated_at = daysAgo(60);
    const send = okSend();
    const c = await runMoat(args(db, send));
    expect(c.candidates).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('the links carry signed tokens bound to this member, this alert and the answer, plus a working unsubscribe', async () => {
    const db = world(1);
    const send = okSend();
    await runMoat(args(db, send));
    const mail = (send.mock.calls[0] as any[])[0];
    const urls = [...mail.text.matchAll(/(?:Yes|No): (\S+)/g)].map((m) => new URL(m[1] as string));
    const toks = urls.map((u) => verifyOutcomeToken(u.searchParams.get('t') as string, SECRET, NOW.getTime()));
    expect(toks).toEqual([
      { userId: 'u1', signalId: 1, answer: 'yes' },
      { userId: 'u1', signalId: 1, answer: 'no' },
    ]);
    const unsub = /Turn off email alerts: (\S+)/.exec(mail.text)![1];
    expect(verifyUnsubscribeToken(new URL(unsub).searchParams.get('t') as string, SECRET)).toBe('u1');
    expect(mail.headers['List-Unsubscribe']).toContain('/api/cron/notify/unsubscribe');
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.text).toContain('ColorLabPro, Inc.');
  });

  it('a failed or skipped send moves the asks to the feed and spends the week not at all', async () => {
    for (const res of [{ ok: false as const, error: 'x' }, { skipped: true as const, reason: 'no_api_key' }]) {
      const db = world(2);
      const c = await runMoat(args(db, vi.fn(async () => res)));
      expect(c.emailed).toBe(0);
      expect(db.tables.holler_outcome_asks.map((a: any) => a.channel)).toEqual(['feed', 'feed']);
    }
  });

  it('a member with no email address gets feed asks and nothing throws', async () => {
    const db = world(1);
    db.auth.admin.getUserById = async () => ({ data: { user: null }, error: null });
    const send = okSend();
    const c = await runMoat(args(db, send));
    expect(send).not.toHaveBeenCalled();
    expect(c.failed).toBe(1);
    expect(db.tables.holler_outcome_asks[0].channel).toBe('feed');
  });
});

describe('runMoat before migration 0015 is applied', () => {
  it('throws an error the route recognizes as "table missing" (the route then answers ok and skipped)', async () => {
    const db: any = makeDb({ holler_signal_feedback: [{ user_id: 'u1', signal_id: 1, verdict: 'useful', updated_at: daysAgo(10) }] });
    const real = db.from.bind(db);
    db.from = (t: string) => {
      if (t !== 'holler_outcome_asks') return real(t);
      // order and range: the asks lookup is paged since round 7 fix-g2.
      const q: any = { select: () => q, in: () => q, order: () => q, range: () => q, then: (r: any) => Promise.resolve({ data: null, error: { message: "Could not find the table 'public.holler_outcome_asks' in the schema cache" } }).then(r) };
      return q;
    };
    await expect(runMoat(args(db, okSend()))).rejects.toThrow(/holler_outcome_asks/);
  });

  it('already-asked rows never crowd out new ones: 600 asked rows plus one fresh useful row still asks the fresh one (review r4 repro)', async () => {
    const feedback: any[] = [];
    const asks: any[] = [];
    const signals: any[] = [{ id: 9999, source: 'nws', kind: 'alert', title: 'Fresh storm', city: 'Marietta', state: 'GA', occurred_at: daysAgo(9) }];
    for (let i = 1; i <= 600; i++) {
      // Answered "no" keeps the verdict useful, so these stay in the window.
      feedback.push({ user_id: `old${i % 50}`, signal_id: i, verdict: 'useful', updated_at: daysAgo(30) });
      asks.push({ user_id: `old${i % 50}`, signal_id: i, channel: 'email', asked_at: daysAgo(20), answer: 'no' });
    }
    feedback.push({ user_id: 'newbie', signal_id: 9999, verdict: 'useful', updated_at: daysAgo(8) });
    const db = makeDb(
      { holler_signal_feedback: feedback, holler_signals: signals, holler_profiles: [profile('newbie')], holler_outcome_asks: asks },
      { users: { newbie: 'newbie@example.test' } },
    );
    const send = okSend();
    const c = await runMoat(args(db, send));
    expect(c.candidates).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.tables.holler_outcome_asks.some((a: any) => a.user_id === 'newbie' && a.signal_id === 9999)).toBe(true);
  });

  it('verify-v3 P2: the already-asked lookup is paged past max_rows (1000), so a member with 1,600 ask rows cannot starve a new one', async () => {
    const feedback: any[] = [];
    const asks: any[] = [];
    const signals: any[] = [{ id: 9999, source: 'nws', kind: 'alert', title: 'Fresh storm', city: 'Marietta', state: 'GA', occurred_at: daysAgo(9) }];
    // 1,000 older asks for signals outside this window sort first (signal ids 1..1000), then the 600 asked rows of this window.
    for (let i = 1; i <= 1000; i++) asks.push({ user_id: 'heavy', signal_id: i, channel: 'feed', asked_at: daysAgo(60), answer: 'no' });
    for (let i = 1001; i <= 1600; i++) {
      feedback.push({ user_id: 'heavy', signal_id: i, verdict: 'useful', updated_at: daysAgo(30) });
      asks.push({ user_id: 'heavy', signal_id: i, channel: 'email', asked_at: daysAgo(20), answer: 'no' });
    }
    feedback.push({ user_id: 'newbie', signal_id: 9999, verdict: 'useful', updated_at: daysAgo(8) });
    const db = makeDb(
      { holler_signal_feedback: feedback, holler_signals: signals, holler_profiles: [profile('newbie')], holler_outcome_asks: asks },
      { users: { newbie: 'newbie@example.test' }, maxRows: 1000 },
    );
    const send = okSend();
    const c = await runMoat(args(db, send));
    expect(c.candidates).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.tables.holler_outcome_asks.some((a: any) => a.user_id === 'newbie' && a.signal_id === 9999)).toBe(true);
  });

  it('verify-v3 P2: with max_rows below the page size, a short page is not taken as the last one', async () => {
    const feedback: any[] = [];
    const asks: any[] = [];
    const signals: any[] = [{ id: 9999, source: 'nws', kind: 'alert', title: 'Fresh storm', city: 'Marietta', state: 'GA', occurred_at: daysAgo(9) }];
    for (let i = 1; i <= 600; i++) {
      feedback.push({ user_id: 'heavy', signal_id: i, verdict: 'useful', updated_at: daysAgo(30) });
      asks.push({ user_id: 'heavy', signal_id: i, channel: 'email', asked_at: daysAgo(20), answer: 'no' });
    }
    feedback.push({ user_id: 'newbie', signal_id: 9999, verdict: 'useful', updated_at: daysAgo(8) });
    const db = makeDb(
      { holler_signal_feedback: feedback, holler_signals: signals, holler_profiles: [profile('newbie')], holler_outcome_asks: asks },
      { users: { newbie: 'newbie@example.test' }, maxRows: 250 },
    );
    const c = await runMoat(args(db, okSend()));
    expect(c.candidates).toBe(1);
  });
});
