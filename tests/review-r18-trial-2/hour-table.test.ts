// Regression test from the r18 TRIAL re-review (probe 22), re-pointed in round 23.
// REV2 probe 22 (r18 TRIAL): the 72-hour revival rule, hour by hour, for original starts around the TRIAL_DAYS boundary.
// Each member: never paid, verified email, the old 14-day trial (ended at start + 14 days), all three ledger rows already written.
// It runs the app's own decision (mayExtendTrial / repairShortTrial) at every hour of the grid, then the real lifecycle selection
// (selectLifecycle) at every hourly cron tick afterwards, and fails on any anomaly.
//
// WHAT CHANGED IN ROUND 23. The original version compared each hour with a TSV fixture of what migration 0028 really did on Postgres 16
// (fixtures/hour-grid-0028-pg16.tsv), because 0028 extended members and the app had to agree with it hour for hour. Round 23 moves the
// trial to 30 days and migration 0038 extends NOBODY (it must not: existing trials keep their end date), so there is no migration side
// left to agree with, and a 60-day fixture cannot be re-pointed at a 30-day rule. The fixture and that comparison are gone; 0038's own
// "touches no existing row" guarantee is proved directly in tests/ops/migration-0038.test.ts, and 0028 itself still runs in
// tests/ops/migration-0028.test.ts. Everything the app does is still checked here, hour by hour, against TRIAL_DAYS.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { mayExtendTrial, repairShortTrial, REVIVE_MIN_LEFT_MS } from '../../lib/auth/trial';
import { selectLifecycle, WINDOWS, type LifecycleProfile, type SendRow } from '../../lib/lifecycle/select';
import { TRIAL_DAYS } from '../../lib/auth/membership';

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-22T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

interface Mail { kind: string; atH: number; relEndH: number }
/** Hourly cron, first tick `phaseMin` minutes after T0, for `days` days. Returns every lifecycle email that goes out. */
function emails(p: LifecycleProfile, ledger0: string[], phaseMin: number, days = 26, skipTicks: (k: number) => boolean = () => false): Mail[] {
  const ledger: SendRow[] = ledger0.map((kind) => ({ user_id: p.user_id, kind }));
  const out: Mail[] = [];
  const end = Date.parse(p.trial_ends_at!);
  for (let k = 0; k < days * 24; k++) {
    if (skipTicks(k)) continue;
    const t = T0 + phaseMin * MIN + k * HOUR;
    for (const c of selectLifecycle([p], ledger, new Date(t))) {
      out.push({ kind: c.kind, atH: (t - T0) / HOUR, relEndH: (t - end) / HOUR });
      ledger.push({ user_id: p.user_id, kind: c.kind });
    }
  }
  return out;
}

describe('REV2 hour table: starts around the TRIAL_DAYS boundary', () => {
  it('the app revives exactly the members with more than 72 h left, and every one of them gets the reminder before the second "paused"', async () => {
    // Every hour from TRIAL_DAYS - 20 days back to TRIAL_DAYS + 4 days back: the whole revival boundary and well past it.
    const fromH = (TRIAL_DAYS - 20) * 24;
    const toH = (TRIAL_DAYS + 4) * 24;
    const anomalies: string[] = [];
    let revived = 0;
    let untouched = 0;
    let minLeft = Infinity;
    let maxLeft = 0;
    for (let h = fromH; h <= toH; h++) {
      const start = T0 - h * HOUR;
      const oldEnd = start + 14 * DAY;
      const target = start + TRIAL_DAYS * DAY;
      const row = { created_at: iso(start), trial_ends_at: iso(oldEnd), subscription_status: 'trialing', stripe_subscription_id: null, plan_source: 'none' };
      // What the rule says should happen: never paid, the row is short, and (it has ended) more than 72 h would be left.
      const shouldRevive = target > T0 && (oldEnd > T0 || target > T0 + REVIVE_MIN_LEFT_MS);

      const appMay = mayExtendTrial(row, iso(start), T0);
      const state = { end: row.trial_ends_at, ledger: ['welcome', 'trial_ending', 'trial_ended'] };
      const admin: any = {
        auth: { admin: { getUserById: async () => ({ data: { user: { id: 'u', app_metadata: { holler_trial_started_at: iso(start) } } }, error: null }), updateUserById: async () => ({ error: null }) } },
        from: (t: string) => t === 'holler_lifecycle_sends'
          ? (() => { const d: any = { delete: () => d, eq: () => d, in: async (_k: string, kinds: string[]) => { state.ledger = state.ledger.filter((k) => !kinds.includes(k)); return { error: null }; } }; return d; })()
          : (() => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { ...row, trial_ends_at: state.end }, error: null }),
              update: (patch: any) => { const u: any = { eq: () => u, is: () => u, lt: () => u, or: () => u, select: () => u, then: (res: any) => { state.end = patch.trial_ends_at; res({ data: [{ user_id: 'u' }], error: null }); } }; return u; } }; return q; })(),
      };
      const repaired = await repairShortTrial({ id: 'u', app_metadata: { holler_trial_started_at: iso(start) } }, row, () => admin, new Date(T0));
      const appRevived = repaired !== null;
      if (appMay !== shouldRevive || appRevived !== shouldRevive) anomalies.push(`${h} h: the rule says ${shouldRevive ? 'revive' : 'leave'} but the app ${appRevived ? 'revives' : 'leaves'}`);
      if (shouldRevive && Date.parse(state.end) !== target) anomalies.push(`${h} h: app end ${state.end}, want ${iso(target)}`);
      if (shouldRevive && state.ledger.join(',') !== 'welcome') anomalies.push(`${h} h: app ledger after = ${state.ledger.join(',')}`);
      if (!shouldRevive && state.ledger.join(',') !== 'welcome,trial_ending,trial_ended') anomalies.push(`${h} h: untouched row lost ledger rows`);

      // Emails afterwards, for three cron phases (the cron is hourly at :17; T0 can be any minute).
      const p: LifecycleProfile = { user_id: 'u', created_at: iso(start), email_verified_at: iso(start + HOUR), subscription_status: 'trialing', trial_ends_at: shouldRevive ? iso(target) : iso(oldEnd), stripe_subscription_id: null };
      for (const ph of [1, 17, 59]) {
        const ms = emails(p, shouldRevive ? ['welcome'] : ['welcome', 'trial_ending', 'trial_ended'], ph);
        const ending = ms.filter((m) => m.kind === 'trial_ending');
        const ended = ms.filter((m) => m.kind === 'trial_ended');
        if (ms.some((m) => m.kind === 'welcome')) anomalies.push(`${h} h: a second welcome`);
        if (shouldRevive) {
          if (ending.length !== 1) anomalies.push(`${h} h: ${ending.length} reminders (want 1)`);
          if (ended.length !== 1) anomalies.push(`${h} h: ${ended.length} ended emails after revival (want 1)`);
          if (ending[0] && ending[0].relEndH >= 0) anomalies.push(`${h} h: the reminder was sent AFTER the end`);
          if (ending[0] && (-ending[0].relEndH < WINDOWS.trial_ending.from || -ending[0].relEndH > WINDOWS.trial_ending.to)) anomalies.push(`${h} h: reminder ${-ending[0].relEndH} h before the end`);
          if (ending[0] && ended[0] && ending[0].atH >= ended[0].atH) anomalies.push(`${h} h: "paused" before the reminder`);
          if (ended[0] && ended[0].relEndH < WINDOWS.trial_ended.from) anomalies.push(`${h} h: ended email ${ended[0].relEndH} h after the end`);
        } else if (ms.length) anomalies.push(`${h} h: an untouched member got ${ms.map((m) => m.kind).join(',')}`);
      }
      if (shouldRevive) {
        revived++;
        minLeft = Math.min(minLeft, (target - T0) / HOUR);
        maxLeft = Math.max(maxLeft, (target - T0) / HOUR);
      } else untouched++;
    }
    expect(anomalies).toEqual([]);
    // Every hour of the grid is decided, the revived ones all have more than 72 h, and both outcomes really occur.
    expect(revived + untouched).toBe(toH - fromH + 1);
    expect(revived).toBeGreaterThan(300);
    expect(untouched).toBeGreaterThan(80);
    expect(minLeft).toBeGreaterThan(72);
    expect(maxLeft).toBeLessThanOrEqual(20 * 24);
  }, 60_000);

  it('a later page load follows the same clock: the decision depends only on the time left at that load', () => {
    // start (TRIAL_DAYS - 3 d 12 h) back at T0: 84 h left -> revived if the member loads now, not revived 12 h later (72 h left)
    const start = T0 - ((TRIAL_DAYS - 4) * 24 + 12) * HOUR;
    const row = { created_at: iso(start), trial_ends_at: iso(start + 14 * DAY), subscription_status: 'trialing', stripe_subscription_id: null };
    expect(mayExtendTrial(row, iso(start), T0)).toBe(true);
    expect(mayExtendTrial(row, iso(start), T0 + 12 * HOUR - 1)).toBe(true);
    expect(mayExtendTrial(row, iso(start), T0 + 12 * HOUR)).toBe(false);
  });
});
