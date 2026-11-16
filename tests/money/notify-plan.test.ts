// Fixtures: hand-written (assumed). Pure planning for the notify cron (F-3).
import { describe, expect, it } from 'vitest';
import { chunk, classifyForNotify, planNotify, type PlanProfile } from '../../lib/email/notify-logic';

const now = new Date('2026-06-15T12:00:00Z');
const base: PlanProfile = {
  user_id: 'u',
  alert_email: true,
  subscription_status: 'trialing',
  trial_ends_at: '2026-06-20T00:00:00Z',
  last_notified_at: null,
  email_verified_at: '2026-06-10T00:00:00Z',
  created_at: '2026-06-10T00:00:00Z',
};
const p = (o: Partial<PlanProfile>): PlanProfile => ({ ...base, ...o });

describe('classifyForNotify', () => {
  it('sends to a verified trialing user', () => expect(classifyForNotify(p({}), now).action).toBe('send'));
  it('sends to an active paid user past the original trial', () =>
    expect(classifyForNotify(p({ subscription_status: 'active', trial_ends_at: '2020-01-01T00:00:00Z' }), now).action).toBe('send'));
  it('skips when alerts are off', () => expect(classifyForNotify(p({ alert_email: false }), now)).toEqual({ action: 'skip', reason: 'alerts_off' }));
  it('waits for unverified accounts inside 7 days, skips after', () => {
    expect(classifyForNotify(p({ email_verified_at: null, created_at: '2026-06-10T12:00:01Z' }), now).action).toBe('wait');
    expect(classifyForNotify(p({ email_verified_at: null, created_at: '2026-06-08T11:59:00Z' }), now)).toEqual({ action: 'skip', reason: 'unverified' });
  });
  it('treats unverified with no created_at as inside the grace window (never skips on missing data)', () =>
    expect(classifyForNotify(p({ email_verified_at: null, created_at: null }), now).action).toBe('wait'));
  it('skips canceled and expired trials, holds past_due', () => {
    expect(classifyForNotify(p({ subscription_status: 'canceled' }), now).action).toBe('skip');
    expect(classifyForNotify(p({ trial_ends_at: '2026-06-01T00:00:00Z' }), now)).toEqual({ action: 'skip', reason: 'not_entitled' });
    expect(classifyForNotify(p({ subscription_status: 'past_due' }), now).action).toBe('wait');
  });
  it('keeps the 60 minute throttle as wait, not skip', () => {
    expect(classifyForNotify(p({ last_notified_at: '2026-06-15T11:30:00Z' }), now)).toEqual({ action: 'wait', reason: 'throttled' });
    expect(classifyForNotify(p({ last_notified_at: '2026-06-15T10:59:00Z' }), now).action).toBe('send');
  });
  it('skips users with no profile row', () => expect(classifyForNotify(undefined, now)).toEqual({ action: 'skip', reason: 'missing' }));
});

describe('planNotify', () => {
  it('splits users into send, wait and skip and counts reasons', () => {
    const profiles = [
      p({ user_id: 'a' }),
      p({ user_id: 'b', alert_email: false }),
      p({ user_id: 'c', last_notified_at: '2026-06-15T11:45:00Z' }),
      p({ user_id: 'd', subscription_status: 'canceled' }),
    ];
    const plan = planNotify(['a', 'b', 'c', 'd', 'ghost'], profiles, now);
    expect(plan.send).toEqual(['a']);
    expect(plan.wait).toEqual(['c']);
    expect(plan.skip).toEqual(['b', 'd', 'ghost']);
    expect(plan.counts).toMatchObject({ ok: 1, throttled: 1, alerts_off: 1, not_entitled: 1, missing: 1 });
  });
  it('scales: 5000 ineligible users do not displace 3 eligible ones', () => {
    const ids = Array.from({ length: 5003 }, (_, i) => `u${i}`);
    const profiles = ids.map((id, i) => p({ user_id: id, alert_email: i >= 3 ? false : true }));
    const plan = planNotify(ids, profiles, now);
    expect(plan.send).toEqual(['u0', 'u1', 'u2']);
    expect(plan.skip).toHaveLength(5000);
  });
});

describe('chunk', () => {
  it('splits into batches of at most 200 by default', () => {
    const parts = chunk(Array.from({ length: 450 }, (_, i) => i));
    expect(parts.map((x) => x.length)).toEqual([200, 200, 50]);
    expect(chunk([])).toEqual([]);
  });
});
