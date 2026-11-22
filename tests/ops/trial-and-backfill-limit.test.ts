// Review L3 (delete then re-onboard gives a fresh trial) and P2-5 (repeated saves each trigger a backfill).
// In-memory fakes of the Supabase admin client; values hand written (assumed). Auth user and profile shapes follow lib/auth/session.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTrialRules } from '../../lib/auth/trial';
import { leaveHollerPatch, trialEndFromStart, trialStartedAt } from '../../lib/auth/membership';
import { BACKFILL_RATE, backfillLimit, backfillWithLimit } from '../../lib/signals/backfill-run';
import { TRIAL_DAYS } from '@/lib/auth/membership';

const h = vi.hoisted(() => ({ afterCbs: [] as (() => Promise<void> | void)[], backfill: vi.fn(async () => ({ ran: true as const, result: { matched: 0, considered: 0 } })) }));
const NOW = new Date('2026-11-17T12:00:00Z');
const day = 86_400_000;
const iso = (d: number) => new Date(NOW.getTime() + d * day).toISOString();

function fakeAdmin(init: { meta?: Record<string, unknown>; profile?: Record<string, unknown> | null; failUpdate?: boolean; failSendsDelete?: boolean }) {
  const state = {
    meta: { ...(init.meta ?? {}) } as Record<string, unknown>,
    profile:
      init.profile === undefined
        ? ({ user_id: 'u1', created_at: iso(0), trial_ends_at: iso(TRIAL_DAYS), subscription_status: 'trialing', stripe_subscription_id: null } as Record<string, unknown>)
        : init.profile,
    sends: [] as { user_id: string; kind: string }[],
  };
  const calls: string[] = [];
  // Filters of the last update, so a test can see the paid guard (status trialing, no Stripe subscription, only later).
  const updateFilters: string[] = [];
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
    from: (table: string) => {
      if (table === 'holler_lifecycle_sends') {
        const d: any = {
          filters: {} as Record<string, unknown>,
          delete: () => d,
          eq: (k: string, v: unknown) => ((d.filters[k] = v), d),
          in: (k: string, v: unknown[]) => {
            calls.push('sends.delete');
            if (init.failSendsDelete) return Promise.resolve({ error: { code: 'PGRST205', message: 'missing table' } });
            state.sends = state.sends.filter((r) => !(r.user_id === d.filters.user_id && v.includes(r.kind)));
            return Promise.resolve({ error: null });
          },
        };
        return d;
      }
      const q: any = {
        select: () => q,
        eq: () => q,
        update: (patch: Record<string, unknown>) => {
          calls.push('profile.update');
          updateFilters.length = 0;
          const pending = { patch, ok: true };
          const u: any = {
            eq: (k: string, v: unknown) => {
              updateFilters.push(`${k}=${v}`);
              if (k !== 'user_id' && state.profile && state.profile[k] !== v) pending.ok = false;
              return u;
            },
            is: (k: string, v: unknown) => {
              updateFilters.push(`${k} is ${v}`);
              if (state.profile && state.profile[k] !== v) pending.ok = false;
              return u;
            },
            lt: (k: string, v: string) => {
              updateFilters.push(`${k}<${v}`);
              if (state.profile && !(Date.parse(String(state.profile[k])) < Date.parse(v))) pending.ok = false;
              return u;
            },
            or: (f: string) => {
              updateFilters.push(`or ${f}`);
              const ps = state.profile?.plan_source;
              if (!(ps == null || ps === 'none')) pending.ok = false;
              return u;
            },
            select: () => u,
            then: (res: (v: { error: null; data: { user_id: string }[] }) => void) => {
              const hit = !!state.profile && pending.ok;
              if (hit) Object.assign(state.profile!, pending.patch);
              res({ error: null, data: hit ? [{ user_id: 'u1' }] : [] });
            },
          };
          return u;
        },
        maybeSingle: async () => ({ data: state.profile, error: null }),
      };
      return q;
    },
  };
  return { admin, state, calls, updateFilters };
}

const trialing = (over: Record<string, unknown>) => ({ user_id: 'u1', subscription_status: 'trialing', stripe_subscription_id: null, ...over });

describe('one free trial per person (review L3), 60 days from the first start (round 18)', () => {
  it('first profile with the 0028 default (start + 60): records the trial start and changes nothing else', async () => {
    const f = fakeAdmin({});
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('first');
    expect(f.state.meta.holler_trial_started_at).toBe(iso(0));
    expect(f.state.profile!.trial_ends_at).toBe(iso(TRIAL_DAYS));
    expect(f.calls).not.toContain('profile.update');
  });

  it('first profile BEFORE 0028 (the database default still gives 14 days): the app moves it to start + 60, so the site never promises more than the row holds', async () => {
    const f = fakeAdmin({ profile: trialing({ created_at: iso(0), trial_ends_at: iso(14) }) });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('first');
    expect(f.state.meta.holler_trial_started_at).toBe(iso(0));
    expect(f.state.profile!.trial_ends_at).toBe(iso(60));
    expect(f.updateFilters).toEqual(['user_id=u1', 'subscription_status=trialing', 'stripe_subscription_id is null', `trial_ends_at<${new Date(Date.parse(iso(60)) - 1000).toISOString()}`]);
    expect(f.calls).toContain('sends.delete');
    // Running it again (re-submitted onboarding) changes nothing.
    f.calls.length = 0;
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('unchanged');
    expect(f.calls).toEqual([]);
  });

  it('delete then re-onboard 70 days later: the new profile gets the ORIGINAL trial end, already past, not a fresh trial', async () => {
    // day -70: signed up (stamped). Deleted. Today: onboards again; the table default gives now + 60 days.
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-70) }, profile: trialing({ created_at: iso(0), trial_ends_at: iso(60) }) });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('returning');
    expect(f.state.profile!.trial_ends_at).toBe(trialEndFromStart(iso(-70)));
    expect(Date.parse(f.state.profile!.trial_ends_at as string)).toBeLessThan(NOW.getTime());
  });

  it('returns during the original trial: only the remaining days (60 - 2 = 58)', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-2) }, profile: trialing({ created_at: iso(0), trial_ends_at: iso(TRIAL_DAYS) }) });
    await applyTrialRules(f.admin, 'u1', NOW);
    expect(TRIAL_DAYS).toBe(60);
    expect(f.state.profile!.trial_ends_at).toBe(iso(TRIAL_DAYS - 2));
  });

  it('a returning person cut to stamp + 14 by the pre-0028 trigger gets the remainder of 60 days from the ORIGINAL start', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-20) }, profile: trialing({ created_at: iso(0), trial_ends_at: iso(-6) }) });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('returning');
    expect(f.state.profile!.trial_ends_at).toBe(iso(40));
  });

  it('is idempotent: a profile already at start + 60 is untouched', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-2) }, profile: trialing({ created_at: iso(-2), trial_ends_at: iso(58) }) });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('unchanged');
    expect(f.calls).not.toContain('profile.update');
  });

  it('never lengthens a paid or once-paid row: active, past_due, canceled, or any Stripe subscription id', async () => {
    for (const over of [{ subscription_status: 'active' }, { subscription_status: 'past_due' }, { subscription_status: 'canceled' }, { stripe_subscription_id: 'sub_1' }]) {
      const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-10) }, profile: trialing({ created_at: iso(-10), trial_ends_at: iso(4), ...over }) });
      expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('unchanged');
      expect(f.calls).not.toContain('profile.update');
      expect(f.state.profile!.trial_ends_at).toBe(iso(4));
    }
  });

  it('never moves an end to a date already past (start more than 60 days ago)', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-61) }, profile: trialing({ created_at: iso(-61), trial_ends_at: iso(-47) }) });
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('unchanged');
    expect(f.calls).not.toContain('profile.update');
  });

  it('an extension clears the trial_ending and trial_ended ledger rows only (opt-out and welcome stay); a missing ledger table is not an error', async () => {
    const f = fakeAdmin({ meta: { holler_trial_started_at: iso(-12) }, profile: trialing({ created_at: iso(-12), trial_ends_at: iso(2) }) });
    f.state.sends = [
      { user_id: 'u1', kind: 'welcome' },
      { user_id: 'u1', kind: 'trial_ending' },
      { user_id: 'u1', kind: 'optout' },
      { user_id: 'u2', kind: 'trial_ending' },
    ];
    expect(await applyTrialRules(f.admin, 'u1', NOW)).toBe('returning');
    expect(f.state.profile!.trial_ends_at).toBe(iso(48));
    expect(f.state.sends).toEqual([{ user_id: 'u1', kind: 'welcome' }, { user_id: 'u1', kind: 'optout' }, { user_id: 'u2', kind: 'trial_ending' }]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = fakeAdmin({ meta: { holler_trial_started_at: iso(-12) }, profile: trialing({ created_at: iso(-12), trial_ends_at: iso(2) }), failSendsDelete: true });
    expect(await applyTrialRules(g.admin, 'u1', NOW)).toBe('returning');
    expect(g.state.profile!.trial_ends_at).toBe(iso(48));
    spy.mockRestore();
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

  it('full cycle through the same fake: sign up, delete (patch merges into app_metadata), come back after the 60 days', async () => {
    const f = fakeAdmin({});
    await applyTrialRules(f.admin, 'u1', new Date(iso(0)));
    // delete: the shared auth user is kept and the patch is merged in
    Object.assign(f.state.meta, leaveHollerPatch(f.state.meta, new Date(iso(3)), iso(0)));
    expect(f.state.meta.holler_trial_started_at).toBe(iso(0)); // still the original
    // 70 days later: new profile row with the default trial
    f.state.profile = trialing({ created_at: iso(70), trial_ends_at: iso(130) });
    await applyTrialRules(f.admin, 'u1', new Date(iso(70)));
    expect(Date.parse(f.state.profile.trial_ends_at as string)).toBeLessThan(Date.parse(iso(70)));
  });

  it('never throws: an admin failure is logged and reported', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeAdmin({ failUpdate: true, meta: {} });
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

describe('settings save creating a first profile stamps the trial (verify P2-4)', () => {
  it('records the stamp when there was no profile, and never when one already existed; a failing stamp never breaks the save', async () => {
    const stamped: string[] = [];
    const load = async (before: unknown, boom = false) => {
      vi.resetModules();
      vi.doMock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
      vi.doMock('next/server', () => ({ after: () => {} }));
      vi.doMock('@/lib/stripe', () => ({ getStripe: () => null, isHollerMetadata: () => false }));
      vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ marker: 'admin' }) }));
      vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
      vi.doMock('@/lib/auth/session', () => ({ getUser: async () => ({ id: 'u9' }), getProfile: async () => before }));
      vi.doMock('@/lib/auth/profile', () => ({ saveProfile: async () => ({ ok: true, message: 'Saved.' }) }));
      vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: async () => ({ ran: false, reason: 'limited' }) }));
      vi.doMock('@/lib/auth/trial', () => ({ applyTrialRules: async (_a: unknown, id: string) => { stamped.push(id); if (boom) throw new Error('x'); return 'first'; } }));
      return (await import('../../app/app/settings/actions')).saveSettings;
    };
    const fd = () => { const f = new FormData(); f.append('categories', 'roofing'); f.append('zip', '30303'); f.append('radius', '25'); return f; };
    expect(await (await load(null))({}, fd())).toEqual({ ok: true, message: 'Saved.' });
    expect(stamped).toEqual(['u9']);
    stamped.length = 0;
    await (await load({ categories: ['roofing'], zip: '30303', radius_mi: 25, created_at: iso(-5) }))({}, fd());
    expect(stamped).toEqual([]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await (await load(null, true))({}, fd())).toEqual({ ok: true, message: 'Saved.' });
    spy.mockRestore();
    vi.doUnmock('@/lib/auth/trial');
    vi.doUnmock('next/server');
  });
});

describe('delete account writes the trial stamp before it deletes the profile (final verify P2-11)', () => {
  const run = async (opts: { failStamp?: boolean; meta?: Record<string, unknown> }) => {
    const events: string[] = [];
    const meta: Record<string, unknown> = { products: ['holler'], ...(opts.meta ?? {}) };
    vi.resetModules();
    vi.doMock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
    vi.doMock('next/server', () => ({ after: () => {} }));
    vi.doMock('@/lib/stripe', () => ({ getStripe: () => null, isHollerMetadata: () => false }));
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signOut: async () => ({}) } }) }));
    vi.doMock('@/lib/auth/session', () => ({ getUser: async () => ({ id: 'u1' }), getProfile: async () => ({ created_at: iso(-3) }) }));
    vi.doMock('@/lib/auth/profile', () => ({ saveProfile: async () => ({ ok: true }) }));
    vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: async () => ({ ran: false }) }));
    vi.doMock('@/lib/auth/trial', () => ({ applyTrialRules: async () => 'first' }));
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        from: (table: string) => ({ delete: () => ({ eq: async () => (events.push(`delete:${table}`), { error: null }) }) }),
        auth: {
          admin: {
            getUserById: async () => ({ data: { user: { id: 'u1', app_metadata: meta } }, error: null }),
            updateUserById: async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
              if (opts.failStamp && 'holler_trial_started_at' in attrs.app_metadata && !('products' in attrs.app_metadata)) return { error: { message: 'down' } };
              events.push('update:' + Object.keys(attrs.app_metadata).sort().join('+'));
              Object.assign(meta, attrs.app_metadata);
              return { error: null };
            },
          },
        },
      }),
    }));
    const { deleteAccount } = await import('../../app/app/settings/actions');
    let result: unknown = 'redirected';
    try {
      result = await deleteAccount();
    } catch {
      // redirect('/') throws in this fake: success
    }
    return { events, meta, result };
  };

  it('stamps first (stamp only), deletes matches then profile, then strips the product tag', async () => {
    const { events, meta } = await run({});
    expect(events).toEqual(['update:holler_trial_started_at', 'delete:holler_matches', 'delete:holler_profiles', expect.stringMatching(/^update:holler_email_verified_at\+holler_left_at\+products$/)]);
    expect(meta.holler_trial_started_at).toBe(iso(-3));
  });

  it('if the stamp cannot be written, nothing is deleted and the user sees the error', async () => {
    const { events, result } = await run({ failStamp: true });
    expect(events).toEqual([]);
    expect(result).toEqual({ error: expect.stringContaining("couldn't delete") });
  });

  it('an existing stamp is left alone (no stamp write at all)', async () => {
    const { events, meta } = await run({ meta: { holler_trial_started_at: iso(-40) } });
    expect(events[0]).toBe('delete:holler_matches');
    expect(meta.holler_trial_started_at).toBe(iso(-40));
  });
});
