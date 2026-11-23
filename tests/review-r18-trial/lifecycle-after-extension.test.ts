// Regression tests from the r18 TRIAL review (probe 05); F1 fixed: an ended trial is revived only with more than 72 h left (mayExtendTrial,
// the same rule as migration 0028), so the reminder always comes first and nobody gets a second "ended" email without one.
// Reviewer probe 05 (r18 TRIAL): the lifecycle emails after 0028 extends a member and clears their trial_ending / trial_ended ledger rows.
// Uses the real selection (lib/lifecycle/select.ts) hour by hour, with the ledger exactly as probe 01 shows 0028 leaves it.
import { describe, expect, it } from 'vitest';
import { selectLifecycle, WINDOWS, type LifecycleProfile, type SendRow } from '../../lib/lifecycle/select';
import { TRIAL_ENDED_SUBJECT, TRIAL_ENDING_SUBJECT, renderTrialEnded } from '../../lib/lifecycle/templates';
import { mayExtendTrial } from '../../lib/auth/trial';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-22T12:00:00.000Z'); // the moment 0028 runs
const iso = (ms: number) => new Date(ms).toISOString();
function run(p: LifecycleProfile, ledger: SendRow[], hours: number): string[] {
  const sent: string[] = [];
  const sends = [...ledger];
  for (let h = 0; h <= hours; h++) {
    for (const c of selectLifecycle([p], sends, new Date(T0 + h * HOUR))) {
      sent.push(`${c.kind}@+${h}h`);
      sends.push({ user_id: c.userId, kind: c.kind });
    }
  }
  return sent;
}
const member = (createdDaysAgo: number, endsInDays: number): LifecycleProfile => ({
  user_id: 'u1', created_at: iso(T0 - createdDaysAgo * DAY), email_verified_at: iso(T0 - createdDaysAgo * DAY), subscription_status: 'trialing', trial_ends_at: iso(T0 + endsInDays * DAY), stripe_subscription_id: null,
});
const AFTER_0028: SendRow[] = [{ user_id: 'u1', kind: 'welcome' }]; // 0028 deleted trial_ending and trial_ended

describe('REV lifecycle emails after the 0028 extension', () => {
  it('extended mid-trial member (day 10, new end +50 d): one reminder about 3 days before the new end, one ended email after it, nothing else', () => {
    const sent = run(member(10, 50), AFTER_0028, 53 * 24);
    expect(sent).toEqual([`trial_ending@+${50 * 24 - WINDOWS.trial_ending.to}h`, `trial_ended@+${50 * 24 + WINDOWS.trial_ended.from}h`]);
    expect(TRIAL_ENDING_SUBJECT).toBe('Your trial ends in 3 days');
  });

  it('no "trial ended" email goes to an extended member while the new trial runs', () => {
    const sent = run(member(34, 26), AFTER_0028, 26 * 24 - 1);
    expect(sent.filter((s) => s.startsWith('trial_ended'))).toEqual([]);
  });

  it('a member who opted out of trial emails gets none after the extension (opt-out row survives 0028)', () => {
    expect(run(member(10, 50), [...AFTER_0028, { user_id: 'u1', kind: 'optout' }], 53 * 24)).toEqual([]);
  });

  it('welcome is not re-sent (its ledger row is kept)', () => {
    expect(run(member(1, 59), AFTER_0028, 48).filter((s) => s.startsWith('welcome'))).toEqual([]);
  });

  /** What 0028 / the app leave behind for a member whose 14-day trial ended: revived (ledger reset) only when mayExtendTrial allows. */
  function afterMigration(startDaysAgo: number): { p: LifecycleProfile; ledger: SendRow[]; revived: boolean } {
    const ended = member(startDaysAgo, 14 - startDaysAgo);
    const start = iso(T0 - startDaysAgo * DAY);
    const revived = mayExtendTrial(ended, start, T0);
    if (!revived) return { p: ended, ledger: [...AFTER_0028, { user_id: 'u1', kind: 'trial_ending' }, { user_id: 'u1', kind: 'trial_ended' }], revived };
    return { p: member(startDaysAgo, 60 - startDaysAgo), ledger: AFTER_0028, revived };
  }

  it('F1 fixed: a member whose trial ended 45.9 days ago (start 59.875 d back) is NOT revived, so no second "Your alerts are paused"', () => {
    const m = afterMigration(59.875);
    expect(m.revived).toBe(false);
    expect(run(m.p, m.ledger, 96)).toEqual([]);
    expect(TRIAL_ENDED_SUBJECT).toBe('Your alerts are paused');
    expect(renderTrialEnded({ businessName: 'Biz', feedUrl: 'https://x.test/app', plansUrl: 'https://x.test/p', unsubscribeUrl: 'https://x.test/u', missed: 0 }).text).toContain('Your free trial has ended, so Holler has paused your alerts');
  });

  it('F1 fixed: original start 57 to 60 days back stays ended (no email at all); 56 and 46 days back are revived and get the reminder FIRST', () => {
    for (const startDaysAgo of [57, 57.5, 57.6, 58, 59, 59.9]) {
      const m = afterMigration(startDaysAgo);
      expect(m.revived, `start ${startDaysAgo} d ago`).toBe(false);
      expect(run(m.p, m.ledger, 6 * 24), `start ${startDaysAgo} d ago`).toEqual([]);
    }
    for (const startDaysAgo of [56, 46]) {
      const m = afterMigration(startDaysAgo);
      expect(m.revived, `start ${startDaysAgo} d ago`).toBe(true);
      expect(run(m.p, m.ledger, (62 - startDaysAgo) * 24).map((s) => s.split('@')[0]), `start ${startDaysAgo} d ago`).toEqual(['trial_ending', 'trial_ended']);
    }
  });
});
