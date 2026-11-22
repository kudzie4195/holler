// Regression tests from the r18 TRIAL review (probe 03), with the FINDING cases turned into the fixed behaviour.
// Reviewer probe 03 (r18 TRIAL): lib/auth/trial.ts applyTrialRules. Can a member extend their own trial by calling it again? What happens
// when the write is refused? Is it safe after 0028? In-memory fake of the admin client that APPLIES PostgREST filters for real.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { applyTrialRules, mayExtendTrial, repairShortTrial } from '../../lib/auth/trial';
import { TRIAL_DAYS, trialEndFromStart } from '../../lib/auth/membership';

const DAY = 86_400_000;
const NOW = new Date('2026-11-22T12:00:00.000Z');
const at = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

function fake(init: { meta?: Record<string, unknown>; profile: Record<string, unknown> | null; updateError?: { code: string; message: string }; mutateBeforeUpdate?: (p: Record<string, unknown>) => void }) {
  const state = { meta: { ...(init.meta ?? {}) }, profile: init.profile ? { ...init.profile } : null, sends: ['welcome', 'trial_ending', 'trial_ended', 'optout'], updates: 0, sendDeletes: 0, stampWrites: 0 };
  const admin: any = {
    auth: { admin: {
      getUserById: async () => ({ data: { user: { id: 'u1', app_metadata: state.meta } }, error: null }),
      updateUserById: async (_i: string, p: any) => { state.stampWrites++; Object.assign(state.meta, p.app_metadata); return { error: null }; },
    } },
    from: (table: string) => {
      if (table === 'holler_lifecycle_sends') {
        const d: any = { delete: () => d, eq: () => d, in: (_k: string, kinds: string[]) => { state.sendDeletes++; state.sends = state.sends.filter((k) => !kinds.includes(k)); return Promise.resolve({ error: null }); } };
        return d;
      }
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: state.profile ? { ...state.profile } : null, error: null }),
        update: (patch: Record<string, unknown>) => {
          let ok = true;
          const u: any = {
            eq: (k: string, v: unknown) => { if (k !== 'user_id' && state.profile?.[k] !== v) ok = false; return u; },
            is: (k: string, v: unknown) => { if ((state.profile?.[k] ?? null) !== v) ok = false; return u; },
            lt: (k: string, v: string) => { if (!(Date.parse(String(state.profile?.[k])) < Date.parse(v))) ok = false; return u; },
            or: () => u,
            select: () => u,
            then: (res: (v: { error: unknown; data?: unknown }) => void) => {
              if (init.updateError) return res({ error: init.updateError });
              init.mutateBeforeUpdate?.(state.profile!); // a webhook landing between the read and the write
              // re-evaluate nothing: filters were computed against the row as read; emulate the race by recomputing here
              if (init.mutateBeforeUpdate) ok = state.profile!.subscription_status === 'trialing' && (state.profile!.stripe_subscription_id ?? null) === null;
              const hit = ok && !!state.profile;
              if (hit) { Object.assign(state.profile!, patch); state.updates++; }
              res({ error: null, data: hit ? [{ user_id: 'u1' }] : [] });
            },
          };
          return u;
        },
      };
      return q;
    },
  };
  return { admin, state };
}
const trialing = (created: number, ends: number, extra: Record<string, unknown> = {}) => ({ user_id: 'u1', created_at: at(created), trial_ends_at: at(ends), subscription_status: 'trialing', stripe_subscription_id: null, ...extra });

describe('REV applyTrialRules: who gets how many days', () => {
  it('new signup BEFORE 0028 (row has 14 days): moved to exactly created_at + 60 days, and 5 more calls change nothing', async () => {
    const { admin, state } = fake({ profile: trialing(0, 14) });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('first');
    expect(state.profile!.trial_ends_at).toBe(at(60));
    for (let i = 0; i < 5; i++) expect(await applyTrialRules(admin, 'u1', new Date(NOW.getTime() + i * 10 * DAY))).toBe('unchanged');
    expect(state.profile!.trial_ends_at).toBe(at(60));
    expect(state.updates).toBe(1);
    expect(state.stampWrites).toBe(1);
  });

  it('new signup AFTER 0028 (row has created_at + 60 days with microseconds): no write, no ledger reset (no double extension)', async () => {
    const { admin, state } = fake({ profile: { ...trialing(0, 60), created_at: '2026-11-22T12:00:00.123456+00:00', trial_ends_at: '2027-01-21T12:00:00.123456+00:00' } });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('first');
    expect(state.updates).toBe(0);
    expect(state.sendDeletes).toBe(0);
    expect(state.profile!.trial_ends_at).toBe('2027-01-21T12:00:00.123456+00:00');
  });

  it('member mid-trial BEFORE 0028 (day 10 of 14) who re-submits onboarding: gets the rest of 60 days from the ORIGINAL start, not more', async () => {
    const { admin, state } = fake({ meta: { holler_trial_started_at: at(-10) }, profile: trialing(-10, 4) });
    await applyTrialRules(admin, 'u1', NOW);
    expect(state.profile!.trial_ends_at).toBe(at(50)); // 60 days from the start
  });

  it('14-day trial ended 20 days ago, never paid (start 34 d ago): re-submitting onboarding revives it to start + 60 (26 more days)', async () => {
    const { admin, state } = fake({ meta: { holler_trial_started_at: at(-34) }, profile: trialing(-34, -20) });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('returning');
    expect(state.profile!.trial_ends_at).toBe(at(26));
    expect(state.sends).toEqual(['welcome', 'optout']); // trial_ending and trial_ended can be sent again; opt-out kept
  });

  it('start 61 days ago: never revived', async () => {
    const { admin, state } = fake({ meta: { holler_trial_started_at: at(-61) }, profile: trialing(-61, -47) });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('unchanged');
    expect(state.updates).toBe(0);
  });

  it('deleted the account and came back (first start 40 d ago, new row today): 20 days left, never a second 60', async () => {
    // after 0028 the insert trigger already cut the row to stamp + 60
    const a = fake({ meta: { holler_trial_started_at: at(-40) }, profile: trialing(0, 20) });
    expect(await applyTrialRules(a.admin, 'u1', NOW)).toBe('unchanged');
    // a row that somehow carries a fresh 60 (trigger missing) is cut back
    const b = fake({ meta: { holler_trial_started_at: at(-40) }, profile: trialing(0, 60) });
    expect(await applyTrialRules(b.admin, 'u1', NOW)).toBe('returning');
    expect(b.state.profile!.trial_ends_at).toBe(at(20));
    // before 0028 the old trigger cut it to stamp + 14 (26 days ago): the code gives the remainder of 60
    const c = fake({ meta: { holler_trial_started_at: at(-40) }, profile: trialing(0, -26) });
    await applyTrialRules(c.admin, 'u1', NOW);
    expect(c.state.profile!.trial_ends_at).toBe(at(20));
  });

  it('paying, past_due, canceled, or a Stripe subscription id on a trialing row: never lengthened', async () => {
    for (const extra of [{ subscription_status: 'active' }, { subscription_status: 'past_due' }, { subscription_status: 'canceled' }, { stripe_subscription_id: 'sub_1' }, { subscription_status: 'active', plan_source: 'apple' }]) {
      const { admin, state } = fake({ meta: { holler_trial_started_at: at(-10) }, profile: trialing(-10, 4, extra) });
      await applyTrialRules(admin, 'u1', NOW);
      expect(state.profile!.trial_ends_at, JSON.stringify(extra)).toBe(at(4));
      expect(state.sendDeletes, JSON.stringify(extra)).toBe(0);
    }
  });
});

describe('REV applyTrialRules: failure and edge behaviour (review findings, fixed)', () => {
  it('F5 fixed: a refused write leaves 14 days, and on the next signed-in load (repairShortTrial) moves the row to start + 60', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, state } = fake({ profile: trialing(0, 14), updateError: { code: '42501', message: 'holler_billing_guard: billing fields are set by the server only' } });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('error');
    expect(state.profile!.trial_ends_at).toBe(at(14));
    expect(state.meta.holler_trial_started_at).toBe(at(0)); // the stamp WAS written
    spy.mockRestore();
    // Next visit: the same row, a working admin client.
    const next = fake({ meta: { ...state.meta }, profile: { ...state.profile! } });
    const later = new Date(NOW.getTime() + DAY);
    const end = await repairShortTrial({ id: 'u1', app_metadata: next.state.meta }, next.state.profile as never, () => next.admin, later);
    expect(end).toBe(at(60));
    expect(next.state.profile!.trial_ends_at).toBe(at(60));
    // A row that is already right costs no admin call at all.
    let called = 0;
    expect(await repairShortTrial({ id: 'u1', app_metadata: next.state.meta }, next.state.profile as never, () => { called++; return next.admin; }, later)).toBeNull();
    expect(called).toBe(0);
  });

  it('F5: the repair never touches a paid, store-billed or canceled row, and never revives an ended trial with 72 hours or less left', async () => {
    for (const extra of [{ subscription_status: 'active' }, { subscription_status: 'canceled' }, { stripe_subscription_id: 'sub_1' }, { plan_source: 'google' }]) {
      let called = 0;
      const row = trialing(-10, 4, extra);
      expect(await repairShortTrial({ id: 'u1', app_metadata: { holler_trial_started_at: at(-10) } }, row as never, () => { called++; return {} as never; }, NOW)).toBeNull();
      expect(called, JSON.stringify(extra)).toBe(0);
    }
    for (const startDaysAgo of [57.5, 58, 59, 59.9]) {
      const row = trialing(-startDaysAgo, 14 - startDaysAgo);
      expect(mayExtendTrial(row as never, at(-startDaysAgo), NOW.getTime()), `start ${startDaysAgo} d ago`).toBe(false);
    }
    expect(mayExtendTrial(trialing(-56, -42) as never, at(-56), NOW.getTime())).toBe(true); // 96 h left: revived, the reminder comes first
    expect(mayExtendTrial(trialing(-46, -32) as never, at(-46), NOW.getTime())).toBe(true);
  });

  it('F1 parity with 0028: onboarding does not revive an ended trial with 72 hours or less left', async () => {
    const { admin, state } = fake({ meta: { holler_trial_started_at: at(-58) }, profile: trialing(-58, -44) });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('unchanged');
    expect(state.updates).toBe(0);
    expect(state.sendDeletes).toBe(0);
  });

  it('F8 fixed: a stamp LATER than created_at never pushes the start later; the code agrees with 0028 (created_at + 60)', async () => {
    const { admin, state } = fake({ meta: { holler_trial_started_at: at(-2) }, profile: trialing(-20, 40) }); // 0028 sets created + 60 = +40
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('unchanged');
    expect(state.profile!.trial_ends_at).toBe(at(40));
    expect(state.updates).toBe(0);
  });

  it('F9 fixed: when the guarded UPDATE matches no row (member subscribed between the read and the write) nothing is reported and the ledger stays', async () => {
    const { admin, state } = fake({ meta: { holler_trial_started_at: at(-10) }, profile: trialing(-10, 4), mutateBeforeUpdate: (p) => { p.subscription_status = 'active'; p.stripe_subscription_id = 'sub_new'; } });
    expect(await applyTrialRules(admin, 'u1', NOW)).toBe('unchanged');
    expect(state.updates).toBe(0);
    expect(state.profile!.trial_ends_at).toBe(at(4));
    expect(state.sendDeletes).toBe(0);
  });

  it('the code writes whole milliseconds: created_at .123456 becomes an end of .123 (what probe 01 fixture 18 feeds to 0028)', () => {
    expect(trialEndFromStart('2026-11-01T12:00:00.123456+00:00')).toBe('2026-12-31T12:00:00.123Z');
    expect(TRIAL_DAYS).toBe(60);
  });
});

describe('F5: the signed-in repair is wired where members land', () => {
  it('/app and GET /api/m/me call repairShortTrial and use the repaired end for access', async () => {
    const fs = await import('node:fs');
    const app = fs.readFileSync('app/app/page.tsx', 'utf8');
    expect(app).toMatch(/const repairedEnd = await repairShortTrial\(user, loaded, createAdminClient, new Date\(now\)\);/);
    expect(app.indexOf('repairShortTrial(user')).toBeLessThan(app.indexOf('computeAccess(profile, now)'));
    const me = fs.readFileSync('app/api/m/me/route.ts', 'utf8');
    expect(me).toMatch(/await repairShortTrial\(m\.ctx\.user, profile, createAdminClient\)/);
    expect(me).toMatch(/meBody\(m\.ctx\.user, row,/);
  });
});
