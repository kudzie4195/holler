// Onboarding, profile edits and account deletion for the app: same library functions as the web, same order, own-client writes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { mapFieldErrors, parseProfileInput, targetingChanged, toFormData } from '@/lib/mobile/profile';
import { fakeDb, profileRow, rateRpc, req, tok, UA, UB } from './fakes';
import { install, world, type World } from './harness';

const TA = tok('a');
let w: World;
let steps: string[];
let saveCalls: { userId: string; fd: FormData; opts: Record<string, unknown> }[];
let saveResult: Record<string, unknown>;

function mocks(opts: { marker: boolean }) {
  vi.doMock('@/lib/auth/profile', () => ({
    // A real module without the export reads as undefined; vitest mocks throw on a missing key, so it is listed as undefined.
    SAVE_PROFILE_ACCEPTS_DB: opts.marker ? true : undefined,
    saveProfile: async (userId: string, fd: FormData, o: Record<string, unknown>) => {
      steps.push('saveProfile');
      saveCalls.push({ userId, fd, opts: o });
      if (saveResult.ok && !w.profiles[userId]) w.profiles[userId] = profileRow(userId, { business_name: String(fd.get('business_name')) });
      return saveResult;
    },
  }));
  vi.doMock('@/lib/auth/trial', () => ({ repairShortTrial: async () => null, applyTrialRules: async () => (steps.push('applyTrialRules'), 'first') }));
  vi.doMock('@/lib/analytics/request', () => ({ recordSignup: async () => void steps.push('recordSignup') }));
  vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: async () => (steps.push('backfill'), { ran: true }) }));
  vi.doMock('@/lib/auth/verification', () => ({
    applyPendingVerification: async () => void steps.push('applyPendingVerification'),
    sendVerifyEmail: async () => (steps.push('sendVerifyEmail'), true),
  }));
  vi.doMock('@/lib/mobile/later', () => ({ later: (fn: () => Promise<unknown>) => (steps.push('later'), void fn()) }));
}

beforeEach(() => {
  steps = [];
  saveCalls = [];
  saveResult = { ok: true, message: 'Saved.' };
  w = world({ users: { [TA]: { id: UA, email: 'a@x.test', app_metadata: {} } } });
  w.admin = fakeDb(() => ({ data: null }), rateRpc(w.rate), {
    admin: {
      updateUserById: async (id: string, attrs: unknown) => (steps.push(`tag:${id}:${JSON.stringify(attrs)}`), { error: null }),
    },
  });
  install(w);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const onboard = async (body: unknown, token: string | null = TA) =>
  (await import('../../app/api/m/onboarding/route')).POST(req('/api/m/onboarding', { method: 'POST', token, body }));
const patch = async (body: unknown, token: string | null = TA) =>
  (await import('../../app/api/m/profile/route')).PATCH(req('/api/m/profile', { method: 'PATCH', token, body }));

describe('verify-v3 P1: the confirm-only message for a returning member', () => {
  it('says nothing about a trial, has the confirm link, the footer and no dashes', async () => {
    const { renderConfirmEmailOnly } = await import('@/lib/mobile/verify-email');
    const m = renderConfirmEmailOnly({ verifyUrl: 'https://localholler.test/api/auth/verify?t=abc', appUrl: 'https://localholler.test/app' });
    for (const part of [m.subject, m.html, m.text]) {
      expect(part.toLowerCase()).not.toContain('trial');
      expect(part.toLowerCase()).not.toContain('free');
      expect(part).not.toMatch(/[\u2013\u2014]/);
    }
    expect(m.html).toContain('https://localholler.test/api/auth/verify?t=abc');
    expect(m.text).toContain('https://localholler.test/api/auth/verify?t=abc');
    expect(m.text).toContain('7 days');
  });
});

describe('input parsing (types only; rules are saveProfile)', () => {
  it('onboarding requires the four fields; radius defaults to 25', () => {
    expect(parseProfileInput({}, 'onboarding')).toEqual({ ok: false, fieldErrors: { businessName: 'Enter your business name.', trades: 'Pick at least one thing you do.', zip: 'Enter a 5-digit ZIP code.' } });
    const ok = parseProfileInput({ businessName: 'Ace', trades: ['roofing'], zip: '30080' }, 'onboarding');
    expect(ok).toEqual({ ok: true, input: { businessName: 'Ace', trades: ['roofing'], zip: '30080', radiusMi: 25 } });
  });
  it('wrong types are field errors', () => {
    const r = parseProfileInput({ businessName: 5, trades: 'roofing', zip: 30080, radiusMi: '25', extraZips: [1], keywords: 'x' }, 'onboarding');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(['businessName', 'extraZips', 'keywords', 'radiusMi', 'trades', 'zip']);
  });
  it('PATCH: fields left out keep saved values; Solo never re-sends saved Pro extras', () => {
    const saved = { business_name: 'Ace', categories: ['roofing', 'hvac'], zip: '30080', radius_mi: 40, extra_areas: [{ zip: '30060', city: 'Marietta', state: 'GA', lat: 1, lon: 2 }], keywords: ['metal roof'] };
    const pro = toFormData({ radiusMi: 30 }, saved, 'pro');
    expect([pro.get('business_name'), pro.getAll('categories'), pro.get('zip'), pro.get('radius'), pro.getAll('extra_zip'), pro.getAll('keyword')]).toEqual(['Ace', ['roofing', 'hvac'], '30080', '30', ['30060'], ['metal roof']]);
    const solo = toFormData({ radiusMi: 30 }, saved, 'starter');
    expect(solo.has('extra_zip')).toBe(false);
    expect(solo.has('keyword')).toBe(false);
    const cleared = toFormData({ extraZips: [], keywords: [] }, saved, 'pro');
    expect(cleared.getAll('extra_zip')).toEqual(['']);
    expect(targetingChanged(saved, cleared)).toBe(true);
    expect(targetingChanged(saved, toFormData({ businessName: 'New name' }, saved, 'pro'))).toBe(false);
    expect(targetingChanged(saved, toFormData({ zip: '30060' }, saved, 'pro'))).toBe(true);
  });
  it('saveProfile field errors map to app field names', () => {
    expect(mapFieldErrors({ business_name: 'a', categories: 'b', zip: 'c', radius: 'd', extra_zips: 'e', keywords: 'f' })).toEqual({ businessName: 'a', trades: 'b', zip: 'c', radiusMi: 'd', extraZips: 'e', keywords: 'f' });
  });
});

describe('POST /api/m/onboarding', () => {
  const body = { businessName: 'Ace Roofing', trades: ['roofing'], zip: '30080', radiusMi: 25 };
  it('a non-integer radius is a 400 with a fixed message, never the validator text', async () => {
    mocks({ marker: true });
    const res = await onboard({ ...body, radiusMi: 25.5 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid', message: 'Fix the highlighted fields and try again.', fieldErrors: { radiusMi: 'Pick a whole number of miles.' } });
    expect(steps).toEqual([]);
  });
  it('raw validator text from saveProfile is replaced with the field wording', async () => {
    mocks({ marker: true });
    saveResult = { error: 'Invalid input', fieldErrors: { radius: 'Invalid input: expected int, received number', zip: 'Too small: expected string to have >=5 characters' } };
    const b = await (await onboard(body)).json();
    expect(b.message).toBe('Fix the highlighted fields and try again.');
    expect(b.fieldErrors).toEqual({ radiusMi: 'Pick a whole number of miles between 5 and 100.', zip: 'Enter a 5-digit ZIP code.' });
    expect(JSON.stringify(b)).not.toMatch(/expected|received|Invalid input|Too small/);
  });
  it('before the saveProfile integration patch: 503, nothing written through the wrong client', async () => {
    mocks({ marker: false });
    const res = await onboard(body);
    expect(res.status).toBe(503);
    expect(steps).toEqual([]);
  });
  it("runs the web's steps in the web's order, with the member's own client, then answers /me", async () => {
    mocks({ marker: true });
    const res = await onboard(body);
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(steps[0]).toBe('saveProfile');
    expect(steps.filter((s) => !s.startsWith('tag:'))).toEqual(['saveProfile', 'applyTrialRules', 'recordSignup', 'backfill', 'applyPendingVerification']);
    expect(saveCalls[0].userId).toBe(UA);
    expect(saveCalls[0].opts.db).toBe(w.members[UA]);
    expect(saveCalls[0].fd.get('business_name')).toBe('Ace Roofing');
    expect(saveCalls[0].fd.getAll('categories')).toEqual(['roofing']);
    expect(steps.find((s) => s.startsWith('tag:'))).toContain('"products":["holler"]');
    expect(b).toMatchObject({ ok: true, needsOnboarding: false, profile: { businessName: 'Ace Roofing' } });
  });
  // Round 7 review r4 (same bug as web onboarding): a member who deleted the profile and came back already has the one-trial stamp,
  // so finishing onboarding again is not a new signup. The stamp is read BEFORE applyTrialRules writes anything.
  it('a returning member (trial stamp already set) is not counted as a new signup', async () => {
    mocks({ marker: true });
    vi.doMock('@/lib/auth/trial', () => ({ repairShortTrial: async () => null, applyTrialRules: async () => (steps.push('applyTrialRules'), 'unchanged') }));
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        auth: { admin: { getUserById: async () => (steps.push('priorTrial'), { data: { user: { id: UA, app_metadata: { holler_trial_started_at: '2026-10-01T00:00:00Z' } } }, error: null }) } },
      }),
    }));
    const res = await onboard(body);
    expect(res.status).toBe(200);
    expect(steps.filter((s) => !s.startsWith('tag:'))).toEqual(['saveProfile', 'priorTrial', 'applyTrialRules', 'backfill', 'applyPendingVerification']);
  });
  it('a first profile (no stamp yet) is counted once; a failed stamp read falls back to the trial outcome', async () => {
    mocks({ marker: true });
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({ auth: { admin: { getUserById: async () => ({ data: { user: { id: UA, app_metadata: {} } }, error: null }) } } }),
    }));
    await onboard(body);
    expect(steps.filter((s) => s === 'recordSignup')).toHaveLength(1);
    vi.resetModules();
    steps = [];
    mocks({ marker: true });
    vi.doMock('@/lib/auth/trial', () => ({ repairShortTrial: async () => null, applyTrialRules: async () => (steps.push('applyTrialRules'), 'returning') }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ auth: { admin: { getUserById: async () => ({ data: null, error: { message: 'down' } }) } } }) }));
    install(w);
    await onboard(body);
    expect(steps).not.toContain('recordSignup');
  });
  it('validation errors come back as 400 with app field names and the web wording', async () => {
    mocks({ marker: true });
    saveResult = { error: 'Fix the highlighted fields and try again.', fieldErrors: { zip: "We couldn't find that ZIP code. Check it and try again." } };
    const res = await onboard({ ...body, zip: '00000' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid', message: 'Fix the highlighted fields and try again.', fieldErrors: { zip: "We couldn't find that ZIP code. Check it and try again." } });
    expect(steps).toEqual(['saveProfile']);
  });
  it('a first-time app account without a confirmed email gets the welcome and confirm email', async () => {
    mocks({ marker: true });
    w.profiles = {};
    const orig = profileRow(UA, { email_verified_at: null });
    const save = saveCalls;
    saveResult = { ok: true };
    vi.doMock('@/lib/auth/profile', () => ({
      SAVE_PROFILE_ACCEPTS_DB: true,
      saveProfile: async (userId: string, fd: FormData, o: Record<string, unknown>) => (steps.push('saveProfile'), save.push({ userId, fd, opts: o }), (w.profiles[userId] = orig), { ok: true }),
    }));
    await onboard(body);
    expect(steps).toContain('sendVerifyEmail');
  });
  it('signed out is 401; non-JSON is 415', async () => {
    mocks({ marker: true });
    expect((await onboard(body, null)).status).toBe(401);
    const res = await (await import('../../app/api/m/onboarding/route')).POST(req('/api/m/onboarding', { method: 'POST', token: TA, body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(res.status).toBe(415);
  });
});

describe('PATCH /api/m/profile', () => {
  beforeEach(() => {
    w.profiles[UA] = profileRow(UA);
  });
  it('saves through saveProfile with the member client and alertEmail; backfill after the response when targeting changed', async () => {
    mocks({ marker: true });
    const res = await patch({ zip: '30060', alertEmail: false });
    expect(res.status).toBe(200);
    expect(saveCalls[0].opts).toMatchObject({ db: w.members[UA], alertEmail: false });
    expect(saveCalls[0].fd.get('business_name')).toBe('Ace Roofing'); // kept
    expect(steps).toEqual(['saveProfile', 'later', 'backfill']);
  });
  it('pushAlerts alone: written with the member own client, no saveProfile', async () => {
    mocks({ marker: true });
    const res = await patch({ pushAlerts: false });
    expect(res.status).toBe(200);
    expect(steps).toEqual([]);
    const up = w.members[UA].log.find((q) => q.table === 'holler_profiles' && q.op === 'update')!;
    expect(up.payload).toEqual({ push_alerts: false });
    expect(up.eqOf('user_id')).toBe(UA);
    expect((await res.json()).profile.pushAlerts).toBe(false);
  });
  it('a body naming another user never reaches another row (the id comes from the token)', async () => {
    mocks({ marker: true });
    w.profiles[UB] = profileRow(UB);
    await patch({ pushAlerts: false, user_id: UB, userId: UB });
    expect(w.profiles[UB].push_alerts).toBe(true);
    expect(saveCalls).toEqual([]);
  });
  it('allowed while locked (same as web Settings)', async () => {
    mocks({ marker: true });
    w.profiles[UA] = profileRow(UA, { trial_ends_at: '2026-01-01T00:00:00Z' });
    expect((await patch({ businessName: 'Ace Two' })).status).toBe(200);
  });
  it('no profile: 409', async () => {
    mocks({ marker: true });
    delete w.profiles[UA];
    expect((await patch({ pushAlerts: true })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------------------------------------------------------------
describe('deleteHollerAccount and POST /api/m/account/delete', () => {
  let events: string[];
  let meta: Record<string, unknown>;
  let stripe: unknown;
  beforeEach(() => {
    events = [];
    meta = { products: ['holler', 'durobay'] };
    stripe = null;
    w.profiles[UA] = profileRow(UA, { created_at: '2026-11-01T00:00:00Z' });
    w.admin = fakeDb(
      (q) => {
        if (q.op === 'delete') events.push(`delete:${q.table}:${String(q.eqOf('user_id'))}`);
        return { data: null };
      },
      undefined,
      {
        admin: {
          getUserById: async () => ({ data: { user: { id: UA, app_metadata: meta } }, error: null }),
          updateUserById: async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
            events.push('update:' + Object.keys(attrs.app_metadata).sort().join('+'));
            Object.assign(meta, attrs.app_metadata);
            return { error: null };
          },
        },
      },
    );
    install(w);
    vi.doMock('@/lib/stripe', () => ({ getStripe: () => stripe }));
  });
  const del = async (body: unknown, token: string | null = TA) =>
    (await import('../../app/api/m/account/delete/route')).POST(req('/api/m/account/delete', { method: 'POST', token, body }));

  it('requires { confirm: "DELETE" } exactly', async () => {
    for (const b of [{}, { confirm: 'delete' }, { confirm: 'DELETE ' }, { confirm: true }]) {
      const res = await del(b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect((await res.json()).error).toBe('confirm_required');
    }
    expect(events).toEqual([]);
  });
  it('the web deletion: stamp first, matches, profile (triggers take push tokens), untag; other products kept; sign out', async () => {
    const res = await del({ confirm: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signOut: true, storeSubscription: null });
    expect(events).toEqual([
      'update:holler_trial_started_at',
      `delete:holler_matches:${UA}`,
      `delete:holler_profiles:${UA}`,
      'update:holler_email_verified_at+holler_left_at+products',
    ]);
    expect(meta.products).toEqual(['durobay']);
    expect(meta.holler_trial_started_at).toBe('2026-11-01T00:00:00Z');
  });
  it('reachable when locked and without a profile', async () => {
    w.profiles[UA] = profileRow(UA, { trial_ends_at: '2026-01-01T00:00:00Z' });
    expect((await del({ confirm: 'DELETE' })).status).toBe(200);
    delete w.profiles[UA];
    events = [];
    expect((await del({ confirm: 'DELETE' })).status).toBe(200);
    expect(events).toContain(`delete:holler_profiles:${UA}`);
  });
  it('a live App Store plan is reported so the app can say where to cancel it', async () => {
    w.profiles[UA] = profileRow(UA, { subscription_status: 'active', plan_source: 'apple', store_expires_at: new Date(Date.now() + 9e8).toISOString() });
    const b = await (await del({ confirm: 'DELETE' })).json();
    expect(b.storeSubscription).toEqual({ store: 'apple', manageUrl: 'https://apps.apple.com/account/subscriptions' });
  });
  it('verify-v2 P2 (decision 7): a double payer whose live plan is Stripe is told about the App Store plan waiting in the billing shadow', async () => {
    w.profiles[UA] = profileRow(UA, { subscription_status: 'active', plan: 'starter', plan_source: 'stripe', stripe_subscription_id: null });
    const reads: string[] = [];
    const prev = w.admin!;
    const shadow = { store: 'apple', store_expires_at: new Date(Date.now() + 300 * 864e5).toISOString() };
    w.admin = fakeDb(
      (q) => {
        if (q.op === 'delete') events.push(`delete:${q.table}:${String(q.eqOf('user_id'))}`);
        if (q.table === 'holler_billing_shadow') {
          reads.push(`${q.op}:${events.length}`);
          return { data: events.some((e) => e.startsWith('delete:holler_profiles')) ? null : shadow };
        }
        return { data: null };
      },
      undefined,
      { admin: (prev as unknown as { auth: { admin: unknown } }).auth.admin },
    );
    install(w);
    const b = await (await del({ confirm: 'DELETE' })).json();
    expect(b.storeSubscription).toEqual({ store: 'apple', manageUrl: 'https://apps.apple.com/account/subscriptions' });
    expect(reads).toEqual(['select:0']); // read before anything was deleted
  });
  it('decision 7: a shadow store plan that already ended, or a shadow read that fails (0020 not applied), reports nothing and still deletes', async () => {
    for (const answer of [{ data: { store: 'google', store_expires_at: new Date(Date.now() - 1000).toISOString() } }, { data: null, error: { code: '42P01', message: 'relation does not exist' } }]) {
      events = [];
      w.profiles[UA] = profileRow(UA, { subscription_status: 'active', plan_source: 'stripe' });
      const prev = w.admin!;
      w.admin = fakeDb(
        (q) => {
          if (q.op === 'delete') events.push(`delete:${q.table}:${String(q.eqOf('user_id'))}`);
          return q.table === 'holler_billing_shadow' ? answer : { data: null };
        },
        undefined,
        { admin: (prev as unknown as { auth: { admin: unknown } }).auth.admin },
      );
      install(w);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await del({ confirm: 'DELETE' });
      expect(res.status).toBe(200);
      expect((await res.json()).storeSubscription).toBeNull();
      expect(events).toContain(`delete:holler_profiles:${UA}`);
    }
  });
  it('cancels only Holler Stripe subscriptions; a failed cancel deletes nothing (409)', async () => {
    const canceled: string[] = [];
    w.profiles[UA] = profileRow(UA, { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_h' });
    stripe = {
      subscriptions: {
        list: async () => ({ data: [{ id: 'sub_h', status: 'active', metadata: { app: 'holler' } }, { id: 'sub_other', status: 'active', metadata: { app: 'durobay' } }] }),
        retrieve: async () => ({ id: 'sub_h', status: 'active', metadata: { app: 'holler' } }),
        cancel: async (id: string) => void canceled.push(id),
      },
    };
    expect((await del({ confirm: 'DELETE' })).status).toBe(200);
    expect(canceled).toEqual(['sub_h']);
    events = [];
    (stripe as { subscriptions: { cancel: unknown } }).subscriptions.cancel = async () => {
      throw Object.assign(new Error('card'), { code: 'api_error' });
    };
    w.profiles[UA] = profileRow(UA, { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_h' });
    const res = await del({ confirm: 'DELETE' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('billing_cancel_failed');
    expect(events).toEqual([]);
  });
  it('the user id comes from the token, never the body; signed out is 401', async () => {
    await del({ confirm: 'DELETE', userId: UB, user_id: UB });
    expect(events.every((e) => !e.includes(UB))).toBe(true);
    expect((await del({ confirm: 'DELETE' }, null)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Round 7 review fixes (fix-f): welcome email abuse through delete and onboard again, route limits, the Holler tag on a shared account
// ---------------------------------------------------------------------------------------------------------------------------------
describe('onboarding email and tag on the shared project', () => {
  const body = { businessName: 'Ace Roofing', trades: ['roofing'], zip: '30080', radiusMi: 25 };
  let emails: string[];
  /** Plain confirm-only messages (no trial wording), sent to a returning member (verify-v3 P1). */
  let confirms: string[];
  let authCalls: string[];

  /** Stateful world: app_metadata is shared by the Auth server (getUser) and the admin API, deletion really removes the profile. */
  function stateful(meta: Record<string, unknown>, email = 'victim@x.test') {
    emails = [];
    confirms = [];
    authCalls = [];
    w.users[TA] = { id: UA, email, app_metadata: meta };
    const user = w.users[TA];
    const authAdmin = {
      getUserById: async () => (authCalls.push('getUserById'), { data: { user: { id: UA, email, app_metadata: user.app_metadata } }, error: null }),
      updateUserById: async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
        authCalls.push('updateUserById');
        user.app_metadata = { ...user.app_metadata, ...attrs.app_metadata };
        return { error: null };
      },
    };
    // Any other Auth admin method (invite, generateLink, createUser, ...) would send or prepare a Supabase email: record it.
    const auth = { admin: new Proxy(authAdmin, { get: (t, k: string) => (k in t ? t[k as keyof typeof t] : (authCalls.push(`UNEXPECTED:${k}`), async () => ({ error: null }))) }) };
    w.admin = fakeDb(
      (q) => {
        if (q.table === 'holler_profiles' && q.op === 'delete') delete w.profiles[String(q.eqOf('user_id'))];
        return { data: null };
      },
      rateRpc(w.rate),
      new Proxy(auth, { get: (t, k: string) => (k in t ? t[k as keyof typeof t] : (authCalls.push(`UNEXPECTED:auth.${k}`), undefined)) }),
    );
    install(w);
    mocks({ marker: true });
    vi.doMock('@/lib/auth/profile', () => ({
      SAVE_PROFILE_ACCEPTS_DB: true,
      saveProfile: async (userId: string) => ((w.profiles[userId] ??= profileRow(userId, { email_verified_at: null })), { ok: true }),
    }));
    vi.doMock('@/lib/auth/verification', () => ({
      applyPendingVerification: async () => undefined,
      sendVerifyEmail: async (_id: string, to: string) => (emails.push(to), true),
    }));
    vi.doMock('@/lib/mobile/verify-email', () => ({ sendConfirmOnlyEmail: async (_id: string, to: string) => (confirms.push(to), true) }));
    // priorTrial (lib/analytics/signup.ts) reads the one-trial stamp with the service-role client: the same stateful Auth as above.
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => w.admin }));
    vi.doMock('@/lib/stripe', () => ({ getStripe: () => null }));
  }
  const del = async () => (await import('../../app/api/m/account/delete/route')).POST(req('/api/m/account/delete', { method: 'POST', token: TA, body: { confirm: 'DELETE' } }));

  it('reviewer repro: 25 cycles of onboard then delete send at most 3 emails in total (the web limit), and the routes are limited', async () => {
    stateful({});
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await onboard(body)).status);
      statuses.push((await del()).status);
    }
    // Changed in round 7 fix-g2 (verify-v3 P1): only the first onboarding gets the welcome that promises a trial; the returning
    // onboardings get the plain confirm message. Still 3 in total, under the same limiter.
    expect(emails).toEqual(['victim@x.test']);
    expect(confirms).toEqual(['victim@x.test', 'victim@x.test']);
    expect(statuses).toContain(429);
    expect(statuses.filter((x) => x === 200).length).toBeLessThanOrEqual(15); // onboarding 10 an hour, delete 5 an hour
    // The limiter keys are hashes: no raw address or id in them.
    expect([...w.rate.keys()].some((k) => k.includes('victim@x.test') || k.includes(UA))).toBe(false);
  });

  it('verify-v3 P1 reviewer repro: onboard, delete, onboard again -> the second email has no trial promise (confirm only)', async () => {
    stateful({});
    expect((await onboard(body)).status).toBe(200);
    expect((await del()).status).toBe(200);
    expect(w.users[TA].app_metadata?.holler_trial_started_at).toBeTruthy();
    expect((await onboard(body)).status).toBe(200);
    expect(emails).toEqual(['victim@x.test']); // the welcome with the trial sentence: first onboarding only
    expect(confirms).toEqual(['victim@x.test']); // plain confirm for the returning member
  });
  it('verify-v3 P1: a returning member whose address is already confirmed gets no email at all', async () => {
    stateful({ holler_trial_started_at: '2026-10-01T00:00:00Z', holler_email_verified_at: '2026-10-02T00:00:00Z' });
    expect((await onboard(body)).status).toBe(200);
    expect(emails).toEqual([]);
    expect(confirms).toEqual([]);
  });
  it('verify-v3 P1: a stamp that cannot be read and a trial that did not start fresh is treated as returning (no trial promise)', async () => {
    stateful({});
    vi.doMock('@/lib/auth/trial', () => ({ repairShortTrial: async () => null, applyTrialRules: async () => 'unchanged' }));
    vi.doMock('@/lib/analytics/signup', async (orig) => ({ ...(await orig<typeof import('../../lib/analytics/signup')>()), priorTrial: async () => 'unknown' }));
    try {
      expect((await onboard(body)).status).toBe(200);
      expect(emails).toEqual([]);
      expect(confirms).toEqual(['victim@x.test']);
    } finally {
      vi.doUnmock('@/lib/analytics/signup'); // doMock outlives resetModules: keep it out of the tests below
    }
  });
  it('the address is limited too: three different sign-ins for one address get 3 emails in total', async () => {
    stateful({}, 'same@x.test');
    await onboard(body);
    for (const id of ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555']) {
      w.users[TA] = { id, email: 'same@x.test', app_metadata: {} };
      await onboard(body);
    }
    expect(emails).toHaveLength(3);
  });

  it('a limiter that cannot run sends no welcome email (fail closed for email only); onboarding still succeeds', async () => {
    stateful({});
    w.admin!.rpc = async () => ({ data: null, error: { message: 'down' } });
    expect((await onboard(body)).status).toBe(200);
    expect(emails).toEqual([]);
  });

  it("another product's account with no Holler tag: tagged exactly like web signup (products gains 'holler', others kept), no Supabase email", async () => {
    stateful({ products: ['durobay'], provider: 'email' });
    const res = await onboard(body);
    expect(res.status).toBe(200);
    expect(w.users[TA].app_metadata).toMatchObject({ products: ['durobay', 'holler'], holler_left_at: null, provider: 'email' });
    expect(authCalls.filter((c) => c.startsWith('UNEXPECTED'))).toEqual([]);
    // Changed in round 7 fix-g2: the stamp read (priorTrial, getUserById, sends nothing) now runs against this same fake Auth.
    expect(authCalls).toEqual(['getUserById', 'updateUserById']);
    expect(emails).toEqual(['victim@x.test']); // Holler's own welcome email, once
  });

  it('a brand-new app account (Apple or Google, no tags) gets products ["holler"], as web signup sets', async () => {
    stateful({ provider: 'apple', providers: ['apple'] });
    await onboard(body);
    expect(w.users[TA].app_metadata?.products).toEqual(['holler']);
  });
});
