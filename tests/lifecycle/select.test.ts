import { describe, expect, it } from 'vitest';
import { dueKind, hasSubscription, isReturningMember, queryRanges, selectLifecycle, WINDOWS, type LifecycleProfile } from '@/lib/lifecycle/select';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const H = 3_600_000;
const ago = (h: number) => new Date(NOW.getTime() - h * H).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * H).toISOString();
const ms = (n: number) => n; // readability

function prof(over: Partial<LifecycleProfile> = {}): LifecycleProfile {
  return {
    user_id: 'u1',
    created_at: ago(2 * 24 * 7), // old enough that day 1 never applies unless a test says so
    email_verified_at: ago(2 * 24 * 7),
    subscription_status: 'trialing',
    trial_ends_at: ahead(24 * 30), // far away
    stripe_subscription_id: null,
    ...over,
  };
}
const welcome = (hoursOld: number, over: Partial<LifecycleProfile> = {}) => prof({ created_at: new Date(NOW.getTime() - hoursOld * H).toISOString(), ...over });
const trial_ending = (hoursLeft: number, over: Partial<LifecycleProfile> = {}) => prof({ trial_ends_at: new Date(NOW.getTime() + hoursLeft * H).toISOString(), ...over });
const trial_ended = (hoursSince: number, over: Partial<LifecycleProfile> = {}) => prof({ trial_ends_at: new Date(NOW.getTime() - hoursSince * H).toISOString(), ...over });

describe('windows', () => {
  it('are the ones in the brief', () => {
    expect(WINDOWS).toEqual({ welcome: { from: 20, to: 44 }, trial_ending: { from: 36, to: 60 }, trial_ended: { from: 18, to: 48 } });
  });
});

describe('day 1: 20 to 44 hours after signup', () => {
  it.each([
    [20 - 1 / 3600, null], // one second early
    [20, 'welcome'],
    [32, 'welcome'],
    [44, 'welcome'],
    [44 + 1 / 3600, null], // one second late
  ])('%f hours old gives %s', (h, want) => {
    expect(dueKind(welcome(h), NOW)).toBe(want);
  });

  it('needs a verified email', () => {
    expect(dueKind(welcome(30, { email_verified_at: null }), NOW)).toBeNull();
    expect(dueKind(welcome(30, { email_verified_at: ago(1) }), NOW)).toBe('welcome');
  });

  it('a missing or unreadable created_at never matches', () => {
    expect(dueKind(welcome(30, { created_at: null }), NOW)).toBeNull();
    expect(dueKind(welcome(30, { created_at: 'not a date' }), NOW)).toBeNull();
  });
});

describe('day 5: 36 to 60 hours before the trial ends', () => {
  it.each([
    [36 - 1 / 3600, null],
    [36, 'trial_ending'],
    [48, 'trial_ending'],
    [60, 'trial_ending'],
    [60 + 1 / 3600, null],
  ])('%f hours left gives %s', (h, want) => {
    expect(dueKind(trial_ending(h), NOW)).toBe(want);
  });

  it('needs a verified email: no lifecycle email of any kind goes to an unverified address', () => {
    // Was a documented choice (only day 1 needed verification). Flipped by the round 7 review: a mistyped address belongs to a stranger.
    expect(dueKind(trial_ending(48, { email_verified_at: null }), NOW)).toBeNull();
    expect(dueKind(trial_ending(48, { email_verified_at: ago(1) }), NOW)).toBe('trial_ending');
  });
});

describe('day 8: 18 to 48 hours after the trial ended', () => {
  it.each([
    [18 - 1 / 3600, null],
    [18, 'trial_ended'],
    [30, 'trial_ended'],
    [48, 'trial_ended'],
    [48 + 1 / 3600, null],
  ])('%f hours since gives %s', (h, want) => {
    expect(dueKind(trial_ended(h), NOW)).toBe(want);
  });

  it('needs a verified email', () => {
    expect(dueKind(trial_ended(30, { email_verified_at: null }), NOW)).toBeNull();
  });
});

describe('unverified members get nothing from selectLifecycle', () => {
  it('reviewer repro: created 12 days ago, unverified, trial ending in 48 h or ended 24 h ago', () => {
    const created = ago(12 * 24);
    const a = prof({ user_id: 'a', created_at: created, email_verified_at: null, trial_ends_at: ahead(48) });
    const b = prof({ user_id: 'b', created_at: created, email_verified_at: null, trial_ends_at: ago(24) });
    expect(dueKind(a, NOW)).toBeNull();
    expect(dueKind(b, NOW)).toBeNull();
    expect(selectLifecycle([a, b], [], NOW)).toEqual([]);
  });
});

describe('isReturningMember', () => {
  it('a stamp clearly older than the profile row is a returning member', () => {
    expect(isReturningMember(ago(30), ago(30 * 24))).toBe(true);
    expect(isReturningMember(ago(30), ago(32))).toBe(true);
  });
  it('a first profile (stamp equals created_at), no stamp, or an unreadable one is not', () => {
    expect(isReturningMember(ago(30), ago(30))).toBe(false);
    expect(isReturningMember(ago(30), ago(30.5))).toBe(false); // inside the slack
    expect(isReturningMember(ago(30), null)).toBe(false);
    expect(isReturningMember(ago(30), undefined)).toBe(false);
    expect(isReturningMember(ago(30), 'garbage')).toBe(false);
    expect(isReturningMember(null, ago(300))).toBe(false);
  });
});

describe('members who already pay, or paid, or left get nothing', () => {
  const cases: [string, Partial<LifecycleProfile>][] = [
    ['active', { subscription_status: 'active' }],
    ['past_due', { subscription_status: 'past_due' }],
    ['canceled', { subscription_status: 'canceled' }],
    ['trialing with a Stripe subscription (checkout started during the trial)', { stripe_subscription_id: 'sub_123' }],
  ];
  for (const [name, over] of cases) {
    it(`${name}: no day 1, day 5 or day 8`, () => {
      expect(dueKind(welcome(30, over), NOW)).toBeNull();
      expect(dueKind(trial_ending(48, over), NOW)).toBeNull();
      expect(dueKind(trial_ended(30, over), NOW)).toBeNull();
      expect(hasSubscription({ subscription_status: over.subscription_status ?? 'trialing', stripe_subscription_id: over.stripe_subscription_id })).toBe(true);
    });
  }
  it('an unknown status is treated as not trialing (nothing sent), the cautious reading', () => {
    expect(dueKind(trial_ending(48, { subscription_status: 'weird' }), NOW)).toBeNull();
  });
});

describe('selectLifecycle', () => {
  it('skips members who already have a row for the kind they are due, and keeps the others', () => {
    const a = trial_ending(48, { user_id: 'a' });
    const b = trial_ending(48, { user_id: 'b' });
    const out = selectLifecycle([a, b], [{ user_id: 'a', kind: 'trial_ending' }], NOW);
    expect(out).toEqual([{ userId: 'b', kind: 'trial_ending' }]);
  });

  it('a row for another kind does not block this one', () => {
    const a = trial_ended(30, { user_id: 'a' });
    expect(selectLifecycle([a], [{ user_id: 'a', kind: 'welcome' }, { user_id: 'a', kind: 'trial_ending' }], NOW)).toEqual([{ userId: 'a', kind: 'trial_ended' }]);
  });

  it('an opt-out blocks every kind', () => {
    const ps = [welcome(30, { user_id: 'a' }), trial_ending(48, { user_id: 'b' }), trial_ended(30, { user_id: 'c' })];
    const sends = ['a', 'b', 'c'].map((u) => ({ user_id: u, kind: 'optout' }));
    expect(selectLifecycle(ps, sends, NOW)).toEqual([]);
    expect(selectLifecycle(ps, [{ user_id: 'b', kind: 'optout' }], NOW).map((c) => c.userId)).toEqual(['a', 'c']);
  });

  it('orders day 5, then day 1, then day 8, then by id, and lists a member once', () => {
    const ps = [trial_ended(30, { user_id: 'z' }), welcome(30, { user_id: 'y' }), trial_ending(48, { user_id: 'x' }), trial_ending(48, { user_id: 'w' }), trial_ending(48, { user_id: 'w' })];
    expect(selectLifecycle(ps, [], NOW).map((c) => `${c.kind}:${c.userId}`)).toEqual(['trial_ending:w', 'trial_ending:x', 'welcome:y', 'trial_ended:z']);
  });

  it('queryRanges covers exactly the three windows', () => {
    const r = queryRanges(NOW);
    expect(r.created).toEqual({ gte: ago(44), lte: ago(20) });
    expect(r.endsSoon).toEqual({ gte: ahead(36), lte: ahead(60) });
    expect(r.endedRecently).toEqual({ gte: ago(48), lte: ago(18) });
    void ms;
  });
});
