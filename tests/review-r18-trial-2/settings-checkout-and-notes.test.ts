// Regression tests from the r18 TRIAL re-review (probe 27); FINDING R1, R2b and R5 now assert the fixed behaviour.
// REV2 probe 27 (r18 TRIAL, commit ef745e4).
//  R1: the repair runs on /app and GET /api/m/me only. The trial emails' button goes to /app/settings#billing-h, and Settings and
//      Checkout read the UNREPAIRED row. While 0028 is not applied, a member who subscribes from that button is charged at the old
//      14-day end (or at once, if that end has passed), although the same member is due start + TRIAL_DAYS and would get it on /app.
//  R2: in that same state the hourly cron sends "Your trial ends in 3 days" to a member the app would extend on their next /app load.
//  R5: 0028 has a 46-day floor the app does not have (7-day-era rows).
//  plus: the Stripe cap after the F12 fix, and what "canceled" means for access while trial_ends_at is still ahead.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { mayExtendTrial } from '../../lib/auth/trial';
import { trialEndFromStart } from '../../lib/auth/membership';
import { MAX_TRIAL_MS, trialParams } from '../../lib/stripe/scope';
import { renewalNote } from '../../lib/stripe/plans';
import { computeAccess } from '../../lib/auth/access';
import { selectLifecycle, type LifecycleProfile } from '../../lib/lifecycle/select';
import { TRIAL_ENDING_SUBJECT } from '../../lib/lifecycle/templates';
import { lifecycleIdempotencyKey } from '../../lib/lifecycle/run';

const HOUR = 3_600_000; const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const row = (startBackD: number, lenD: number) => ({ created_at: iso(NOW - startBackD * DAY), trial_ends_at: iso(NOW - startBackD * DAY + lenD * DAY), subscription_status: 'trialing', stripe_subscription_id: null, plan_source: 'none' });

describe('R1 fixed (was P2, only while 0028 is not applied): Settings and Checkout repair the row first', () => {
  it('where the repair is wired: /app, Settings, Checkout, GET /api/m/me, PATCH /api/m/profile and the lifecycle cron', () => {
    const has = (f: string) => /repairShortTrial|applyTrialRules|repairTrialForCron/.test(readFileSync(f, 'utf8'));
    for (const f of ['app/app/page.tsx', 'app/api/m/me/route.ts', 'app/api/m/profile/route.ts', 'app/app/settings/page.tsx', 'app/api/stripe/checkout/route.ts', 'app/api/cron/lifecycle/route.ts']) expect(has(f), f).toBe(true);
    expect(readFileSync('lib/lifecycle/run.ts', 'utf8')).toContain('mayExtendTrial(p, start, now.getTime())');
    expect(readFileSync('lib/lifecycle/run.ts', 'utf8')).toContain('plansUrl: `${base}/app/settings#billing-h`');
    // Checkout gives Stripe the repaired (stored) end, never the unrepaired read
    expect(readFileSync('app/api/stripe/checkout/route.ts', 'utf8')).toContain('...trialParams(trialEnd)');
    expect(readFileSync('app/api/stripe/checkout/route.ts', 'utf8')).not.toContain('trialParams(profile.trial_ends_at');
  });

  // The two cases below are the arithmetic of what the repair prevents; checkout-from-settings.test.ts runs the real route.
  it('day 11 of an old 14-day trial: Checkout from Settings sets the first charge to day 14; after one /app load it would be day 30 (16 days later)', () => {
    const r = row(11, 14);
    const start = r.created_at;
    expect(mayExtendTrial(r, start, NOW)).toBe(true);                       // /app would move this row to start + TRIAL_DAYS
    const unrepaired = trialParams(r.trial_ends_at, NOW) as { trial_end: number };
    const repaired = trialParams(trialEndFromStart(start), NOW) as { trial_end: number };
    expect(unrepaired.trial_end * 1000).toBe(NOW + 3 * DAY);                 // charged in 3 days
    expect(repaired.trial_end * 1000).toBe(NOW + 19 * DAY);                  // charged in 19 days
    expect((repaired.trial_end - unrepaired.trial_end) / 86400).toBe(16);
    expect(computeAccess(r, NOW).daysLeft).toBe(3);                          // Settings prints "Free trial: 3 days left."
  });

  it('14-day trial ended 6 days ago (start 20 days back): Checkout from Settings charges TODAY; after one /app load it would be in 10 days', () => {
    const r = row(20, 14);
    expect(mayExtendTrial(r, r.created_at, NOW)).toBe(true);
    expect(trialParams(r.trial_ends_at, NOW)).toEqual({});                   // no Stripe trial: charge now
    expect(computeAccess(r, NOW).trialEnded).toBe(true);                     // Settings prints "Your free trial has ended."
    expect(renewalNote('starter', 'monthly', { inTrial: false })).toContain('starting today');
    expect((trialParams(trialEndFromStart(r.created_at), NOW) as { trial_end: number }).trial_end * 1000).toBe(NOW + 10 * DAY);
  });
});

describe('R2 (only while 0028 is not applied): the selection still picks the member, and the cron extends first (cron-before-0028.test.ts)', () => {
  it('day 10.5 to 12.5 of an old 14-day trial: selectLifecycle picks trial_ending, and mayExtendTrial is true for every one of them, so runLifecycle extends instead of sending', () => {
    let sent = 0;
    for (let h = 0; h <= 14 * 24; h++) {
      const start = NOW - h * HOUR;
      const p: LifecycleProfile = { user_id: 'u', created_at: iso(start), email_verified_at: iso(start), subscription_status: 'trialing', trial_ends_at: iso(start + 14 * DAY), stripe_subscription_id: null };
      const due = selectLifecycle([p], [{ user_id: 'u', kind: 'welcome' }], new Date(NOW));
      if (due.some((c) => c.kind === 'trial_ending')) {
        sent++;
        expect(mayExtendTrial({ ...p, plan_source: 'none' }, p.created_at!, NOW)).toBe(true); // the app says: this member has start + TRIAL_DAYS
        expect(Date.parse(trialEndFromStart(p.created_at!)) - NOW).toBeGreaterThanOrEqual(17.5 * DAY); // 17.5 days or more really left
      }
    }
    expect(sent).toBe(49); // every hour of start from 10 d 12 h to 12 d 12 h back (window 36 to 84 h)
    expect(TRIAL_ENDING_SUBJECT).toBe('Your trial ends in 3 days');
  });
  it('R2b fixed: the window is 36 to 84 h (sent at about 84 h), so no trial with any time left at the last old-code tick misses the reminder, and nobody gets two', () => {
    const oldDue = (leftH: number) => leftH >= 36 && leftH <= 60; // lib/lifecycle/select.ts at 8bee203
    const skipped: number[] = []; const doubled: number[] = [];
    for (let m = 0; m <= 14 * 24 * 60; m += 5) {                    // minutes left at the last old-code tick
      const leftAtSwitch = m / 60;
      const start = NOW + leftAtSwitch * HOUR - 14 * DAY;
      let sentOld = false;
      for (let k = 14 * 24; k >= 0; k--) if (leftAtSwitch + k <= 14 * 24 && oldDue(leftAtSwitch + k)) sentOld = true; // every earlier hourly old tick
      const p: LifecycleProfile = { user_id: 'u', created_at: iso(start), email_verified_at: iso(start), subscription_status: 'trialing', trial_ends_at: iso(start + 14 * DAY), stripe_subscription_id: null };
      const ledger = [{ user_id: 'u', kind: 'welcome' }, ...(sentOld ? [{ user_id: 'u', kind: 'trial_ending' }] : [])];
      let sentNew = 0;
      for (let k = 1; k <= 14 * 24; k++) {                           // new code from the next hourly tick on
        for (const c of selectLifecycle([p], ledger, new Date(NOW + k * HOUR))) if (c.kind === 'trial_ending') { sentNew++; ledger.push({ user_id: 'u', kind: 'trial_ending' }); }
      }
      if (!sentOld && sentNew === 0 && leftAtSwitch > 0) skipped.push(leftAtSwitch);
      if (sentOld && sentNew > 0) doubled.push(leftAtSwitch);
    }
    expect(doubled).toEqual([]);
    expect(skipped).toEqual([]); // the 60 h 05 min .. 60 h 55 min band is gone
  });
  it('NOTE: the provider idempotency key is the same for every send of a kind to a member, for 24 hours', () => {
    expect(lifecycleIdempotencyKey('u', 'trial_ending')).toBe('lifecycle:u:trial_ending');
  });
});

describe('R5 fixed: 0028 bounded by the start (created_at > now - 60 days), like the app (tests/ops/migration-0028.test.ts runs it)', () => {
  it('a 7-day-era row (migration 0001 default) with start 25 days back ended 18 days ago: the app revives it (5 days left)', () => {
    const r = row(25, 7);
    expect(Date.parse(r.trial_ends_at)).toBeLessThan(NOW - 16 * DAY);
    expect(mayExtendTrial(r, r.created_at, NOW)).toBe(true);                 // inside the app's window (start + TRIAL_DAYS is 5 days out)
  });
});

describe('REV2 notes', () => {
  it('F12 after the fix: no first charge before trial_ends_at for any time left up to TRIAL_MAX_DAYS plus 5 minutes; beyond that it is cut back', () => {
    for (let left = 60_000; left <= MAX_TRIAL_MS + 5 * 60_000; left += 7 * 60_000 + 13) {
      const p = trialParams(iso(NOW + left), NOW);
      const chargeAt = 'trial_end' in p ? (p as { trial_end: number }).trial_end * 1000 : 'trial_period_days' in p ? NOW + (p as { trial_period_days: number }).trial_period_days * DAY : NOW;
      expect(chargeAt).toBeGreaterThanOrEqual(NOW + left);
      expect(chargeAt - (NOW + left)).toBeLessThan(DAY);
    }
    expect(trialParams(iso(NOW + MAX_TRIAL_MS + 5 * 60_000), NOW)).toEqual({ trial_end: Math.ceil((NOW + MAX_TRIAL_MS + 5 * 60_000) / 1000) });
    expect(trialParams(iso(NOW + MAX_TRIAL_MS + 5 * 60_000 + 1), NOW)).toEqual({ trial_end: Math.ceil((NOW + MAX_TRIAL_MS) / 1000) });
  });
  it('NOTE: a canceled row whose trial_ends_at is still ahead is NOT locked on /app', () => {
    const a = computeAccess({ subscription_status: 'canceled', trial_ends_at: iso(NOW + 20 * DAY) }, NOW);
    expect(a.locked).toBe(false);
    expect(computeAccess({ subscription_status: 'canceled', trial_ends_at: iso(NOW - DAY) }, NOW).locked).toBe(true);
  });
});
