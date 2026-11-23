// Regression tests from the r18 TRIAL review (probe 04); the skew NOTE is fixed (F12).
// Reviewer probe 04 (r18 TRIAL): what Checkout is told at every point of a trial, and that Stripe can never charge inside it.
// Round 23: TRIAL_DAYS is 30, and the bad-data cap is TRIAL_MAX_DAYS (60), so a member still holding a 60-day trial is not charged early.
import { describe, expect, it } from 'vitest';
import { MAX_TRIAL_MS, trialParams } from '../../lib/stripe/scope';
import { TRIAL_DAYS, TRIAL_MAX_DAYS } from '../../lib/auth/membership';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const START = Date.parse('2026-11-22T12:00:00.000Z');
const END = START + TRIAL_DAYS * DAY;
const endIso = new Date(END).toISOString();
/** When Stripe would first charge if the session is completed at `completedAt` (trial_period_days counts from completion). */
function firstCharge(p: ReturnType<typeof trialParams>, completedAt: number): number {
  if ('trial_end' in p) return p.trial_end * 1000;
  if ('trial_period_days' in p) return completedAt + p.trial_period_days * DAY;
  return completedAt;
}

describe('REV trialParams for a full trial', () => {
  it('day 0, 15, 28, 29.9 and after the end', () => {
    expect(trialParams(endIso, START)).toEqual({ trial_end: END / 1000 }); // day 0: the exact end, TRIAL_DAYS out
    expect(trialParams(endIso, START + 15 * DAY)).toEqual({ trial_end: END / 1000 }); // day 15
    expect(trialParams(endIso, START + 28 * DAY)).toEqual({ trial_period_days: 2 }); // day 28: exactly 48 h left is under the 48 h + 5 min floor
    expect(trialParams(endIso, START + 28 * DAY - 5 * 60_000)).toEqual({ trial_end: END / 1000 }); // 48 h 5 min left: still exact
    expect(trialParams(endIso, START + 28 * DAY - 5 * 60_000 + 1)).toEqual({ trial_period_days: 3 }); // 1 ms under the floor: 3 whole days (up to ~24 h extra)
    expect(trialParams(endIso, START + 29.9 * DAY)).toEqual({ trial_period_days: 1 }); // day 29.9
    expect(trialParams(endIso, END)).toEqual({}); // ended: charge now
    expect(trialParams(endIso, END + 1)).toEqual({});
    expect(trialParams(null, START)).toEqual({});
    expect(trialParams('garbage', START)).toEqual({});
  });

  it('never a charge before trial_ends_at, at any hour of the trial, even if the member completes Checkout at once', () => {
    let maxExtraMs = 0;
    for (let t = START; t < END; t += HOUR / 4) {
      const p = trialParams(endIso, t);
      const charge = firstCharge(p, t);
      expect(charge, new Date(t).toISOString()).toBeGreaterThanOrEqual(END);
      if ('trial_end' in p) expect(p.trial_end * 1000 - t).toBeGreaterThanOrEqual(48 * HOUR); // Stripe's 48 h rule for trial_end
      if ('trial_period_days' in p) expect(p.trial_period_days).toBeGreaterThanOrEqual(1);
      maxExtraMs = Math.max(maxExtraMs, charge - END);
    }
    expect(maxExtraMs).toBeLessThanOrEqual(DAY); // the whole-day fallback gives away at most one day
  });

  it('cap: an end beyond TRIAL_MAX_DAYS (bad data) is cut to that; a member still holding a 60-day trial is NOT cut', () => {
    expect(MAX_TRIAL_MS).toBe(TRIAL_MAX_DAYS * DAY);
    expect(TRIAL_MAX_DAYS).toBe(60);
    expect(trialParams(new Date(START + 90 * DAY).toISOString(), START)).toEqual({ trial_end: (START + 60 * DAY) / 1000 });
    // Round 23, the one that matters: a round-18 member with 60 days still running gets their own end, not now + 30 days.
    expect(trialParams(new Date(START + 60 * DAY).toISOString(), START)).toEqual({ trial_end: (START + 60 * DAY) / 1000 });
    expect(trialParams(new Date(START + 45 * DAY).toISOString(), START)).toEqual({ trial_end: (START + 45 * DAY) / 1000 });
  });

  it('F12 fixed: app clock up to 5 minutes behind the database: the exact trial_end is kept, never earlier than trial_ends_at', () => {
    for (const skew of [30_000, 5 * 60_000]) {
      const p = trialParams(endIso, START - skew) as { trial_end: number };
      expect(p.trial_end * 1000, `skew ${skew}`).toBe(END);
    }
    // Beyond TRIAL_MAX_DAYS plus the guard's 5 minutes it is bad data and is cut to now + TRIAL_MAX_DAYS. (Measured from an end
    // TRIAL_MAX_DAYS out, since an end TRIAL_DAYS out is well inside the cap and must never be cut.)
    const maxEndIso = new Date(START + TRIAL_MAX_DAYS * DAY).toISOString();
    const far = trialParams(maxEndIso, START - 6 * 60_000) as { trial_end: number };
    expect(far.trial_end * 1000).toBe(START - 6 * 60_000 + TRIAL_MAX_DAYS * DAY);
    for (const skew of [30_000, 5 * 60_000]) {
      expect((trialParams(maxEndIso, START - skew) as { trial_end: number }).trial_end * 1000, `max skew ${skew}`).toBe(START + TRIAL_MAX_DAYS * DAY);
    }
  });
});
