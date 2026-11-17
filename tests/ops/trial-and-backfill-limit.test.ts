// Review L3 (delete then re-onboard gives a fresh trial) and P2-5 (repeated saves each trigger a backfill).
// In-memory fakes of the Supabase admin client; values hand written (assumed). Auth user and profile shapes follow lib/auth/session.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTrialRules } from '../../lib/auth/trial';
import { leaveHollerPatch, trialEndFromStart, trialStartedAt } from '../../lib/auth/membership';
import { BACKFILL_RATE, backfillLimit, backfillWithLimit } from '../../lib/signals/backfill-run';

const h = vi.hoisted(() => ({ afterCbs: [] as (() => Promise<void> | void)[], backfill: vi.fn(async () => ({ ran: true as const, result: { matched: 0, considered: 0 } })) }));
const NOW = new Date('2026-11-17T12:00:00Z');
const day = 86_400_000;
const iso = (d: number) => new Date(NOW.getTime() + d * day).toISOString();

function fakeAdmin(init: { meta?: Record<string, unknown>; profile?: Record<string, unknown> | null; failUpdate?: boolean }) {
  const state = { meta: { ...(init.meta ?? {}) } as Record<string, unknown>, profile: init.profile === undefined ? { user_id: 'u1', created_at: iso(0), trial_ends_at: iso(7) } : init.profile };
  const calls: string[] = [];
  const admin: any = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: 'u1', app_metadata: state.meta } }, error: null }),
        updateUserById: async (_id: string, patch: { app_metadata: Record<string, unknown> }) => {
          calls.push('updateUserById');
          if (init.failUpdate) return { error: { message: 'nope' } };
          Object.assign(state.meta, patch.app_metadata); // Supabase merges app_metadata keys
          return { error: null };
        },
      },
    },
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        update: (patch: Record<string, unknown>) => {
          calls.push('profile.update');
          if (state.profile) Object.assign(state.profile, patch);
          return { eq: async () => ({ error: null }) };
        },
        maybeSingle: async () => ({ data: state.profile, error: null }),
      };
      return q;
    },
  };
  return { admin, state, calls };
}

describe('one free trial per person (review L3)', () => {
  it('first profile: records the trial start from the profile and leaves the default trial alone', async () => {
    const f = fakeAdmin({});
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('first');
    expect(f.state.meta.holler_trial_started_at).toBe(iso(0));
    expect(f.state.profile!.trial_ends_at).toBe(iso(7));
    expect(f.calls).not.toContain('profile.update');
  });

  it('delete then re-onboard 20 days later: the new profile gets the ORIGINAL trial end, already past, not a fresh 7 days', async () => {
    // day 0: signed up (stamped). day 3: deleted. day 20: onboards again, the table default gives now + 7 days.
    const stamped = { holler_trial_started_at: iso(-20) };
    const f = fakeAdmin({ meta: stamped, profile: { user_id: 'u1', created_at: iso(0), trial_ends_at: iso(7) } });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('returning');
    expect(f.state.profile!.trial_ends_at).toBe(trialEndFromStart(iso(-20)));
    expect(Date.parse(f.state.profile!.trial_ends_at as string)).toBeLessThan(NOW.getTime());
  });

  it('returns during the original trial: only the remaining days', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-2) }, profile: { user_id: 'u1', created_at: iso(0), trial_ends_at: iso(7) } });
    await applyTrialRules(f.admin, 'u1', NOW);
    expect(f.state.profile!.trial_ends_at).toBe(iso(5));
  });

  it('is idempotent and never extends: a profile already at or before the original end is untouched', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-2) }, profile: { user_id: 'u1', created_at: iso(-2), trial_ends_at: iso(5) } });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('unchanged');
    expect(f.calls).not.toContain('profile.update');
  });

  it('an unparseable stamp is ignored (treated as no stamp)', () => {
    expect(trialStartedAt({ holler_trial_started_at: 'garbage' })).toBeNull();
    expect(trialStartedAt({ holler_trial_started_at: 5 })).toBeNull();
    expect(trialStartedAt(null)).toBeNull();
  });

  it('delete stamps an account that predates the stamp, from its profile created_at, and never overwrites an existing stamp', () => {
    const p = leaveHollerPatch({ products: ['holler'] }, NOW, iso(-30));
    expect(p.holler_trial_started_at).toBe(iso(-30));
    expect(leaveHollerPatch({ products: ['holler'], holler_trial_started_at: iso(-40) }, NOW, iso(-30)).holler_trial_started_at).toBeUndefined();
    expect(leaveHollerPatch({ products: ['holler'] }, NOW).holler_trial_started_at).toBeUndefined();
    // other products' tags and the existing keys are untouched
    expect(leaveHollerPatch({ products: ['clovermap', 'holler'] }, NOW, iso(-1)).products).toEqual(['clovermap']);
  });

  it('full cycle through the same fake: sign up, delete (patch merges into app_metadata), come back', async () => {
    const f = fakeAdmin({});
    await applyTrialRules(f.admin, 'u1', new Date(iso(0)));
    // delete: the shared auth user is kept and the patch is merged in
    Object.assign(f.state.meta, leaveHollerPatch(f.state.meta, new Date(iso(3)), iso(0)));
    expect(f.state.meta.holler_trial_started_at).toBe(iso(0)); // still the original
    // 30 days later: new profile row with the default trial
    f.state.profile = { user_id: 'u1', created_at: iso(30), trial_ends_at: iso(37) };
    await applyTrialRules(f.admin, 'u1', new Date(iso(30)));
    expect(Date.parse(f.state.profile.trial_ends_at as string)).toBeLessThan(Date.parse(iso(30)));
  });

  it('never throws: an admin failure is logged and reported', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeAdmin({ failUpdate: true });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('error');
    const bad: any = { auth: { admin: { getUserById: async () => { throw new Error('down'); } } }, from: () => ({}) };
    expect(await applyTrialRules(bad, 'u1', NOW)).toBe('error');
    spy.mockRestore();
  });
});

describe('backfill rate limit (review P2-5)', () => {
  it('6 per hour per user; the key does not hold the raw user id', () => {
    expect(BACKFILL_RATE).toEqual({ max: 6, windowSeconds: 3600 });
    const l = backfillLimit('11111111-2222-3333-4444-555555555555');
    expect(l.max).toBe(6);
    expect(l.windowSeconds).toBe(3600);
    expect(l.key.startsWith('backfill:user:')).toBe(true);
    expect(l.key).not.toContain('11111111');
  });

  it('runs while allowed and skips once limited: 10 saves in an hour give 6 backfills', async () => {
    let used = 0;
    const hit = vi.fn(async () => (++used <= 6 ? ('allowed' as const) : ('limited' as const)));
    const run = vi.fn(async () => ({ matched: 3, considered: 10 }));
    const outcomes = [];
    for (let i = 0; i < 10; i++) outcomes.push(await backfillWithLimit('u1', { hit, run }));
    expect(run).toHaveBeenCalledTimes(6);
    expect(outcomes.filter((o) => !o.ran).every((o) => !o.ran && o.reason === 'limited')).toBe(true);
    expect(hit).toHaveBeenCalledTimes(10);
  });

  it('a limiter that errors lets the (bounded) backfill run, and a backfill that throws never escapes', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn(async () => ({ matched: 0, considered: 0 }));
    expect((await backfillWithLimit('u1', { hit: async () => 'error', run })).ran).toBe(true);
    expect((await backfillWithLimit('u1', { hit: async () => { throw new Error('rpc'); }, run })).ran).toBe(true);
    const out = await backfillWithLimit('u1', { hit: async () => 'allowed', run: async () => { throw new Error('boom'); } });
    expect(out).toEqual({ ran: false, reason: 'error' });
    spy.mockRestore();
  });
});

describe('settings save does not wait for the backfill (after())', () => {
  beforeEach(() => {
    h.afterCbs.length = 0;
    h.backfill.mockClear();
  });

  it('schedules the backfill in after() when targeting changed, and does not run it before the response', async () => {
    vi.resetModules();
    vi.doMock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
    vi.doMock('next/server', () => ({ after: (cb: () => void) => h.afterCbs.push(cb) }));
    vi.doMock('@/lib/stripe', () => ({ getStripe: () => null, isHollerMetadata: () => false }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
    vi.doMock('@/lib/auth/session', () => ({
      getUser: async () => ({ id: 'u1' }),
      getProfile: async () => ({ categories: ['roofing'], zip: '30303', radius_mi: 25, created_at: iso(-5) }),
    }));
    vi.doMock('@/lib/auth/profile', () => ({ saveProfile: async () => ({ ok: true, message: 'Saved.' }) }));
    vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: h.backfill }));
    const { saveSettings } = await import('../../app/app/settings/actions');
    const fd = new FormData();
    fd.append('categories', 'plumbing');
    fd.append('zip', '30303');
    fd.append('radius', '25');
    const res = await saveSettings({}, fd);
    expect(res).toEqual({ ok: true, message: 'Saved.' });
    expect(h.backfill).not.toHaveBeenCalled(); // the save returned first
    expect(h.afterCbs).toHaveLength(1);
    await h.afterCbs[0]();
    expect(h.backfill).toHaveBeenCalledTimes(1);

    // unchanged targeting: nothing scheduled
    h.afterCbs.length = 0;
    const same = new FormData();
    same.append('categories', 'roofing');
    same.append('zip', '30303');
    same.append('radius', '25');
    await saveSettings({}, same);
    expect(h.afterCbs).toHaveLength(0);
    vi.doUnmock('next/server');
  });
});
