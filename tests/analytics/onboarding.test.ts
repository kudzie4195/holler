// completeOnboarding: a returning member (profile deleted, then back) is not a new signup or trial start (review r4).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const USER = '0b1f4a3e-8d1c-4d0e-9a55-2f6c1d2e3a4b';
const s = vi.hoisted(() => ({
  stamp: null as string | null,
  readError: false,
  trialOutcome: 'first' as string,
  recorded: [] as string[],
  order: [] as string[],
}));

vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }); } }));
vi.mock('@/lib/auth/session', () => ({ getUser: async () => ({ id: USER, email: 'a@x.test' }) }));
vi.mock('@/lib/auth/profile', () => ({ saveProfile: async () => ({ ok: true }) }));
vi.mock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: async () => undefined }));
vi.mock('@/lib/auth/verification', () => ({ applyPendingVerification: async () => undefined }));
vi.mock('@/lib/auth/trial', () => ({
  applyTrialRules: async () => {
    s.order.push('applyTrialRules');
    return s.trialOutcome;
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: async () => {
          s.order.push('readStamp');
          return s.readError
            ? { data: { user: null }, error: { message: 'down' } }
            : { data: { user: { id: USER, app_metadata: s.stamp ? { holler_trial_started_at: s.stamp } : {} } }, error: null };
        },
      },
    },
  }),
}));
vi.mock('@/lib/analytics/request', async () => {
  const real = await vi.importActual<typeof import('@/lib/analytics/request')>('@/lib/analytics/request');
  return { ...real, recordSignup: async (id: string) => void s.recorded.push(id) };
});

afterEach(() => {
  s.stamp = null;
  s.readError = false;
  s.trialOutcome = 'first';
  s.recorded = [];
  s.order = [];
});

async function run() {
  const { completeOnboarding } = await import('@/app/onboarding/actions');
  await completeOnboarding({} as never, new FormData()).catch((e: { to?: string }) => {
    if (!e.to) throw e;
  });
}

describe('completeOnboarding: signup and trial_start only for a first profile', () => {
  it('a first profile records signup', async () => {
    await run();
    expect(s.recorded).toEqual([USER]);
  });
  it('review r4 repro: a returning member (stamp already there, trigger already cut the trial, so applyTrialRules says unchanged) is not counted', async () => {
    s.stamp = '2026-09-01T00:00:00.000Z';
    s.trialOutcome = 'unchanged';
    await run();
    expect(s.recorded).toEqual([]);
    expect(s.order.indexOf('readStamp')).toBeLessThan(s.order.indexOf('applyTrialRules'));
  });
  it('a re-submitted form (stamp from the first save) adds nothing', async () => {
    s.stamp = new Date().toISOString();
    s.trialOutcome = 'unchanged';
    await run();
    expect(s.recorded).toEqual([]);
  });
  it('trial rules failing on a first profile (no stamp before) still records it', async () => {
    s.trialOutcome = 'error';
    await run();
    expect(s.recorded).toEqual([USER]);
  });
  it('the stamp read failing falls back to the trial outcome: first records, anything else does not', async () => {
    s.readError = true;
    await run();
    expect(s.recorded).toEqual([USER]);
    s.recorded = [];
    s.trialOutcome = 'unchanged';
    await run();
    expect(s.recorded).toEqual([]);
  });
});

describe('shouldRecordSignup', () => {
  it('the table', async () => {
    const { shouldRecordSignup } = await import('@/lib/analytics/signup');
    expect(shouldRecordSignup('none', 'first')).toBe(true);
    expect(shouldRecordSignup('none', 'error')).toBe(true);
    expect(shouldRecordSignup('none', 'unchanged')).toBe(true);
    expect(shouldRecordSignup('stamped', 'first')).toBe(false);
    expect(shouldRecordSignup('stamped', 'unchanged')).toBe(false);
    expect(shouldRecordSignup('stamped', 'returning')).toBe(false);
    expect(shouldRecordSignup('unknown', 'first')).toBe(true);
    expect(shouldRecordSignup('unknown', 'unchanged')).toBe(false);
    expect(shouldRecordSignup('unknown', 'error')).toBe(false);
  });
});
