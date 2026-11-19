// Review r2 (store billing) regressions, TypeScript half. The SQL half (holler_apply_store_event, the shadow state, the fallback)
// runs in PGlite in /home/claude/gates/pg/migtest_0020.mjs.
//  F1  a store row with a null or unreadable expiry is never "paid forever"; TRANSFER_TO never copies a product or writes a null expiry
//  F4  a refund (CANCELLATION with cancel_reason CUSTOMER_SUPPORT) is sent as REFUND
//  F9  BILLING_ISSUE carries the later of the expiry and the grace date
//  F7  one paid test (isPaidNow) for access, effectiveTier and the email digest
//  T11 TRANSFER ledger ids carry a SHA-256 of the user id, never the id itself
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAccess, isPaidNow } from '@/lib/auth/access';
import { isStorePlanLive, stripeMayOverwrite, storePlanLapsed } from '@/lib/storebilling/source';
import { planEvent } from '@/lib/storebilling/revenuecat';
import { effectiveTier } from '@/lib/plan/limits';
import { classifyForNotify, decideNotify } from '@/lib/email/notify-logic';
import { fakeDb, UA, UB, type FakeDb } from './fakes';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const TRIAL_OVER = '2026-01-01T00:00:00Z';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('F1: a store plan with no readable expiry is not paid', () => {
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());
  for (const exp of [null, '', 'garbage', '0000-00-00', undefined]) {
    it(`store_expires_at=${JSON.stringify(exp)}: locked, not live, lapsed, Stripe may write over it`, () => {
      const row = { subscription_status: 'active', trial_ends_at: TRIAL_OVER, plan_source: 'apple', store_expires_at: exp as string | null, plan: 'pro' };
      const tenYears = NOW + 10 * 365 * 86_400_000;
      expect(computeAccess(row, tenYears).locked).toBe(true);
      expect(computeAccess(row, NOW).locked).toBe(true);
      expect(isStorePlanLive(row, NOW)).toBe(false);
      expect(storePlanLapsed(row, NOW)).toBe(true);
      expect(isPaidNow(row, NOW)).toBe(false);
      expect(stripeMayOverwrite(row, { status: 'active', tier: 'starter' }, tenYears)).toBe(true);
      expect(effectiveTier(row, NOW)).toBe('starter');
    });
  }
  it('the unreadable expiry is logged once per check while the row says paid', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    isPaidNow({ subscription_status: 'active', plan_source: 'google', store_expires_at: null }, NOW);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/store plan.*expiry/i);
    spy.mockClear();
    isPaidNow({ subscription_status: 'canceled', plan_source: 'google', store_expires_at: null }, NOW);
    expect(spy).not.toHaveBeenCalled();
  });
  it('Stripe rows and pre-0020 rows are untouched by the rule', () => {
    expect(isPaidNow({ subscription_status: 'active' }, NOW)).toBe(true);
    expect(isPaidNow({ subscription_status: 'past_due', plan_source: 'stripe', store_expires_at: null }, NOW)).toBe(true);
    expect(isPaidNow({ subscription_status: 'canceled', plan_source: 'stripe' }, NOW)).toBe(false);
  });
});

describe('F7: one paid rule for the feed, plan limits and the email digest', () => {
  const lapsed = { plan: 'pro', subscription_status: 'active', plan_source: 'apple', store_expires_at: '2026-06-01T00:00:00Z', trial_ends_at: TRIAL_OVER };
  it('reviewer reproduction: active apple row that expired 2026-06-01 is locked, gets Solo limits and no email', () => {
    expect(computeAccess(lapsed, NOW).locked).toBe(true);
    expect(isPaidNow(lapsed, NOW)).toBe(false);
    expect(effectiveTier(lapsed, NOW)).toBe('starter');
    const n = { ...lapsed, alert_email: true, last_notified_at: null, email_verified_at: '2026-01-01T00:00:00Z' };
    expect(decideNotify(n, new Date(NOW))).toEqual({ ok: false, reason: 'not_entitled' });
    expect(classifyForNotify({ ...n, user_id: UA, created_at: '2026-01-01T00:00:00Z' }, new Date(NOW)).action).toBe('skip');
  });
  it('a live store Pro keeps Pro limits and email', () => {
    const live = { ...lapsed, store_expires_at: '2026-12-19T00:00:00Z' };
    expect(effectiveTier(live, NOW)).toBe('pro');
    expect(decideNotify({ ...live, alert_email: true, last_notified_at: null, email_verified_at: '2026-01-01T00:00:00Z' }, new Date(NOW)).ok).toBe(true);
  });
  it('callers that pass only plan and status behave as before', () => {
    expect(effectiveTier({ plan: 'pro', subscription_status: 'active' })).toBe('pro');
    expect(effectiveTier({ plan: 'pro', subscription_status: 'past_due' })).toBe('pro');
    expect(effectiveTier({ plan: 'pro', subscription_status: 'canceled' })).toBe('starter');
    expect(effectiveTier({ plan: 'pro' })).toBe('pro');
  });
});

const ev = (over: Record<string, unknown>) => ({
  api_version: '1.0',
  event: {
    id: 'evt-9',
    type: 'INITIAL_PURCHASE',
    app_user_id: UA,
    product_id: 'com.localholler.app.pro.yearly',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    expiration_at_ms: Date.parse('2027-11-19T00:00:00Z'),
    event_timestamp_ms: Date.parse('2026-11-19T00:00:00Z'),
    ...over,
  },
});

describe('planEvent: refunds, grace dates, transfer ids', () => {
  it('F4: CANCELLATION with cancel_reason CUSTOMER_SUPPORT (a refund) becomes REFUND; other cancellations stay CANCELLATION', () => {
    expect(planEvent(ev({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' })).calls[0].type).toBe('REFUND');
    expect(planEvent(ev({ type: 'CANCELLATION', cancel_reason: 'customer_support' })).calls[0].type).toBe('REFUND');
    for (const r of ['UNSUBSCRIBE', 'BILLING_ERROR', 'DEVELOPER_INITIATED', 'PRICE_INCREASE', 'UNKNOWN', undefined]) {
      expect(planEvent(ev({ type: 'CANCELLATION', cancel_reason: r })).calls[0].type, String(r)).toBe('CANCELLATION');
    }
    expect(planEvent(ev({ type: 'REFUND' })).calls[0].type).toBe('REFUND');
  });
  it('F9: BILLING_ISSUE sends the later of expiration_at_ms and grace_period_expiration_at_ms', () => {
    const exp = Date.parse('2026-11-20T00:00:00Z');
    const grace = Date.parse('2026-12-06T00:00:00Z');
    expect(planEvent(ev({ type: 'BILLING_ISSUE', expiration_at_ms: exp, grace_period_expiration_at_ms: grace })).calls[0].expiresAt).toBe('2026-12-06T00:00:00.000Z');
    expect(planEvent(ev({ type: 'BILLING_ISSUE', expiration_at_ms: grace, grace_period_expiration_at_ms: exp })).calls[0].expiresAt).toBe('2026-12-06T00:00:00.000Z');
    expect(planEvent(ev({ type: 'BILLING_ISSUE', expiration_at_ms: exp, grace_period_expiration_at_ms: null })).calls[0].expiresAt).toBe('2026-11-20T00:00:00.000Z');
    // other types ignore the grace field
    expect(planEvent(ev({ type: 'RENEWAL', expiration_at_ms: exp, grace_period_expiration_at_ms: grace })).calls[0].expiresAt).toBe('2026-11-20T00:00:00.000Z');
  });
  it('T11: TRANSFER ids carry a SHA-256 of the user id, never the raw id', () => {
    const p = planEvent(ev({ type: 'TRANSFER', app_user_id: undefined, product_id: undefined, expiration_at_ms: undefined, transferred_from: [UA], transferred_to: [UB.toUpperCase()] }));
    // Order changed in round 7 fix-g2: TRANSFER_TO first (it names the old owners), then TRANSFER_FROM.
    expect(p.calls.map((c) => [c.type, c.userId, c.eventId])).toEqual([
      ['TRANSFER_TO', UB, `evt-9:to:${sha(UB)}`],
      ['TRANSFER_FROM', UA, `evt-9:from:${sha(UA)}`],
    ]);
    for (const c of p.calls) {
      expect(c.eventId).not.toContain(UA);
      expect(c.eventId).not.toContain(UB);
      expect(c.eventId.toLowerCase()).not.toContain(UB.toLowerCase());
    }
  });
});

describe('POST /api/revenuecat/webhook: TRANSFER (F1)', () => {
  let db: FakeDb;
  const SECRET = 'rc-webhook-secret-0123456789abcdef';
  beforeEach(() => {
    vi.resetModules();
    // The old owner's row still names a product (revoke never cleared it): it must not be copied.
    db = fakeDb(
      (q) => (q.table === 'holler_profiles' ? { data: [{ store_product_id: 'com.localholler.app.pro.yearly', plan_source: 'apple' }] } : { data: null }),
      () => ({ data: 'recorded' }),
    );
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('reviewer reproduction: real payload with no product and no expiry; nothing is copied from the old owner and no profile is read', async () => {
    const { POST } = await import('../../app/api/revenuecat/webhook/route');
    const body = { api_version: '1.0', event: { id: 'evt-t', type: 'TRANSFER', store: 'APP_STORE', environment: 'PRODUCTION', transferred_from: [UA], transferred_to: [UB], event_timestamp_ms: NOW } };
    const res = await POST(new Request('https://localholler.test/api/revenuecat/webhook', { method: 'POST', headers: { authorization: SECRET }, body: JSON.stringify(body) }));
    expect(res.status).toBe(200);
    // Order changed in round 7 fix-g2: TRANSFER_TO first, naming the old owner; still no product and no expiry from the route.
    expect(db.rpcs.map((r) => [r.args.p_type, r.args.p_user_id, r.args.p_product_id, r.args.p_expires_at, r.args.p_from_user_ids])).toEqual([
      ['TRANSFER_TO', UB, null, null, [UA]],
      ['TRANSFER_FROM', UA, null, null, null],
    ]);
    expect(db.log.filter((q) => q.table === 'holler_profiles')).toEqual([]);
  });
});
