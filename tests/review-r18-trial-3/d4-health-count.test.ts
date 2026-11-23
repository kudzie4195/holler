// Round 18 integration, review 3 D4: the health line states the real number of never-paid members still on a shorter trial, and no longer
// says the hourly email job moves everyone (it moves only members due a trial email).
import { describe, expect, it } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { countShortTrials, trialCheckLine, type TrialDbCheck } from '@/lib/auth/trial-check';

const NOW = new Date('2026-11-22T12:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const row = (id: string, startDaysAgo: number, endDays: number, over: Record<string, unknown> = {}) => ({
  user_id: id, created_at: at(-startDaysAgo), trial_ends_at: at(endDays), subscription_status: 'trialing', stripe_subscription_id: null, plan_source: 'none', ...over,
});

describe('review 3 D4: the real count of members still on a shorter trial', () => {
  it('counts exactly the rows the app would move (never paid, end earlier than signup + TRIAL_DAYS, not an ended trial with 72 h or less left)', async () => {
    const db = new FakeDb({
      holler_profiles: [
        row('short-running', 5, 9), // 14-day row, day 5: moved by the app -> counted
        row('short-ended', 20, -6), // 14-day row ended 6 days ago, 10 days of the 30 left -> counted
        row('at-full', 5, 25), // already at signup + TRIAL_DAYS -> not counted
        row('ended-late', 28, -14), // 2 days of the 30 left: never revived -> not counted
        row('paid', 5, 9, { subscription_status: 'active' }),
        row('stripe', 5, 9, { stripe_subscription_id: 'sub_1' }),
        row('store', 5, 9, { plan_source: 'apple' }),
        row('old', 40, -26), // outside the TRIAL_DAYS window
      ],
    });
    expect(await countShortTrials(db as never, NOW)).toBe(2);
  });

  it('a read error gives null, never a made-up number', async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ gt: () => ({ limit: async () => ({ data: null, error: { message: 'x' } }) }) }) }) }) };
    expect(await countShortTrials(broken as never, NOW)).toBeNull();
  });

  it('the not-applied line states the count and the real reach of the hourly job', () => {
    const base: TrialDbCheck = { status: 'not_applied', codeDays: 30, defaultDays: null, stampCapDays: null, guardCapDays: null };
    const two = trialCheckLine({ ...base, shortTrials: 2 });
    expect(two).toContain('Today 2 never-paid members still hold a shorter trial that the app would move');
    expect(two).toContain('the hourly email job moves only members due a trial email (verified, not unsubscribed)');
    expect(two).toContain('Everyone else keeps the end their row holds until they sign in or the migration is applied.');
    expect(two).not.toMatch(/and by the hourly email job\./);
    expect(trialCheckLine({ ...base, shortTrials: 1 })).toContain('Today 1 never-paid member still holds');
    expect(trialCheckLine({ ...base, shortTrials: null })).toContain('could not be counted');
    expect(trialCheckLine({ ...base, status: 'mismatch', defaultDays: 14, stampCapDays: 14, guardCapDays: 14, shortTrials: 0 })).toContain('Today 0 never-paid members');
  });
});
