import { describe, expect, it } from 'vitest';
import type { AccessDto, MeResponse, PlanDto } from '../src/contract';
import { paywallView, periodLabel } from '../src/purchases/paywall';
import type { StorePackage } from '../src/purchases/purchases';

const limits = { serviceAreas: 1, extraZips: 0, trades: 5, keywordWatches: 0 };
const plans = {
  solo: { entitlement: 'solo', tier: 'starter', name: 'Solo', limits } as unknown as PlanDto,
  pro: { entitlement: 'pro', tier: 'pro', name: 'Pro', limits: { serviceAreas: 3, extraZips: 2, trades: 15, keywordWatches: 5 } } as unknown as PlanDto,
};

function access(over: Partial<AccessDto>): AccessDto {
  return {
    state: 'trial',
    tier: 'starter',
    tierName: 'Solo',
    subscriptionStatus: 'trialing',
    trialEndsAt: '2026-12-03T00:00:00Z',
    trialDaysLeft: 14,
    billingSource: 'none',
    storeProductId: null,
    storeExpiresAt: null,
    mayBuyInStore: true,
    manageUrl: null,
    ...over,
  };
}

function me(a: AccessDto | null): MeResponse {
  return { ok: true, user: { id: 'u', email: null }, needsOnboarding: false, profile: null, access: a, limits };
}

const pk = (entitlement: 'solo' | 'pro', period: 'monthly' | 'yearly', priceString: string, trialDays: number | null = null): StorePackage => ({
  id: `${entitlement}-${period}`,
  entitlement,
  period,
  productId: `com.localholler.app.${entitlement}.${period}`,
  priceString,
  price: null,
  currencyCode: 'USD',
  trial: trialDays ? { days: trialDays, source: 'appstore' } : null,
});

const four = [pk('solo', 'monthly', '$7.99', 14), pk('solo', 'yearly', '$79.99', 14), pk('pro', 'monthly', '$13.99'), pk('pro', 'yearly', '$139.99')];

describe('paywall states', () => {
  it('loading while the store has not answered', () => {
    expect(paywallView({ me: me(access({})), plans, storeAvailable: true, packages: null, storeEntitlement: null })).toEqual({ kind: 'loading' });
  });

  it('offers both plans with store prices; a trial only where the store said eligible', () => {
    const v = paywallView({ me: me(access({})), plans, storeAvailable: true, packages: four, storeEntitlement: null });
    expect(v.kind).toBe('offer');
    if (v.kind !== 'offer') return;
    expect(v.plans.map((p) => [p.name, p.monthly?.priceString, p.yearly?.priceString, p.trialDays])).toEqual([
      ['Solo', '$7.99', '$79.99', 14],
      ['Pro', '$13.99', '$139.99', null],
    ]);
    expect(periodLabel(v.plans[0].yearly!)).toBe('$79.99 a year');
    expect(periodLabel(v.plans[1].monthly!)).toBe('$13.99 a month');
  });

  it('a website (Stripe) plan shows that instead of purchase buttons', () => {
    const a = access({ state: 'paid', billingSource: 'stripe', mayBuyInStore: false, tierName: 'Pro', tier: 'pro', manageUrl: 'https://localholler.com/app/settings' });
    expect(paywallView({ me: me(a), plans, storeAvailable: true, packages: four, storeEntitlement: null })).toEqual({
      kind: 'managed-on-web',
      tierName: 'Pro',
      manageUrl: 'https://localholler.com/app/settings',
    });
    // mayBuyInStore false alone is enough (for example a past_due web plan)
    expect(paywallView({ me: me(access({ mayBuyInStore: false })), plans, storeAvailable: true, packages: four, storeEntitlement: null }).kind).toBe('managed-on-web');
  });

  it('a store purchase shows as subscribed before the server knows', () => {
    const v = paywallView({ me: me(access({ state: 'locked' })), plans, storeAvailable: true, packages: four, storeEntitlement: 'solo' });
    expect(v).toMatchObject({ kind: 'subscribed', tierName: 'Solo', fromStore: true });
    if (v.kind === 'subscribed') expect(v.upgrade?.name).toBe('Pro');
  });

  it('Pro through the store has nothing to upgrade to', () => {
    const v = paywallView({ me: me(access({ state: 'paid', tier: 'pro', billingSource: 'apple' })), plans, storeAvailable: true, packages: four, storeEntitlement: 'pro' });
    expect(v).toEqual({ kind: 'subscribed', tierName: 'Pro', fromStore: false, upgrade: null });
  });

  it('an empty store answer is an error state, not a blank screen', () => {
    expect(paywallView({ me: me(access({})), plans, storeAvailable: true, packages: [], storeEntitlement: null })).toEqual({ kind: 'error' });
  });

  it('a build that cannot sell says so', () => {
    expect(paywallView({ me: me(access({})), plans, storeAvailable: false, packages: null, storeEntitlement: null })).toEqual({ kind: 'unavailable' });
  });

  it('falls back to plan names when config has not loaded', () => {
    const v = paywallView({ me: me(access({})), plans: null, storeAvailable: true, packages: [pk('pro', 'yearly', '$139.99')], storeEntitlement: null });
    expect(v.kind === 'offer' && v.plans.map((p) => [p.name, p.monthly, p.limits])).toEqual([['Pro', null, null]]);
  });
});
