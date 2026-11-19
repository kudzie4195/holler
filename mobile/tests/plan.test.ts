import { describe, expect, it } from 'vitest';
import { STORE_PRODUCTS } from '../src/contract';
import { activeEntitlement, effectiveAccess, entitlementFor, productIdToEntitlement, productIdToPeriod } from '../src/purchases/plan';

describe('product id to plan', () => {
  it('maps every product in the contract', () => {
    expect(productIdToEntitlement(STORE_PRODUCTS.solo.monthly)).toBe('solo');
    expect(productIdToEntitlement(STORE_PRODUCTS.solo.yearly)).toBe('solo');
    expect(productIdToEntitlement(STORE_PRODUCTS.pro.monthly)).toBe('pro');
    expect(productIdToEntitlement(STORE_PRODUCTS.pro.yearly)).toBe('pro');
    expect(productIdToPeriod(STORE_PRODUCTS.pro.yearly)).toBe('yearly');
    expect(productIdToPeriod(STORE_PRODUCTS.solo.monthly)).toBe('monthly');
  });
  it('strips the Google Play :basePlanId suffix', () => {
    expect(productIdToEntitlement('com.localholler.app.pro.monthly:monthly')).toBe('pro');
    expect(productIdToEntitlement('com.localholler.app.solo.yearly:annual-base')).toBe('solo');
    expect(productIdToPeriod('com.localholler.app.solo.yearly:p1y')).toBe('yearly');
    expect(productIdToEntitlement('COM.LOCALHOLLER.APP.PRO.YEARLY:YEARLY')).toBe('pro');
  });
  it('matches a dotted segment, not a substring', () => {
    expect(productIdToEntitlement('com.example.solotrip.monthly')).toBeNull();
    expect(productIdToEntitlement('com.example.products.monthly')).toBeNull();
    expect(productIdToEntitlement('')).toBeNull();
    expect(productIdToEntitlement(undefined)).toBeNull();
    expect(productIdToEntitlement(':pro.')).toBeNull();
  });
  it('counts only ids that start with com.localholler.app. (review r6 P2)', () => {
    expect(productIdToEntitlement('com.other.app.pro.monthly')).toBeNull();
    expect(productIdToEntitlement('x.solo')).toBeNull();
    expect(productIdToEntitlement('pro')).toBeNull();
    expect(productIdToEntitlement('com.localholler.app.extra.pro.monthly')).toBeNull();
    expect(productIdToEntitlement('com.localholler.apppro.monthly')).toBeNull();
    expect(productIdToEntitlement('com.localholler.app.pro.monthly')).toBe('pro');
  });
  it('a stale store entitlement from another account never unlocks this one (review r6 P1)', () => {
    const fromA = { userId: 'A', entitlement: 'pro' as const };
    expect(entitlementFor(fromA, 'B')).toBeNull();
    expect(effectiveAccess({ state: 'locked', tier: 'starter' }, entitlementFor(fromA, 'B'))).toEqual({ state: 'locked', tier: 'starter', fromStore: false });
    expect(entitlementFor(fromA, null)).toBeNull();
    expect(entitlementFor(fromA, 'A')).toBe('pro');
  });
});

describe('entitlements', () => {
  it('pro wins over solo; inactive and garbage give null', () => {
    expect(activeEntitlement({ entitlements: { active: { solo: { isActive: true }, pro: { isActive: true } } } })).toBe('pro');
    expect(activeEntitlement({ entitlements: { active: { solo: { isActive: false } } } })).toBeNull();
    expect(activeEntitlement({ entitlements: { active: { gold: { isActive: true } } } })).toBeNull();
    expect(activeEntitlement(null)).toBeNull();
  });
});

describe('effective access = max(server plan, store entitlement)', () => {
  it('the store unlocks before the webhook lands', () => {
    expect(effectiveAccess({ state: 'locked', tier: 'starter' }, 'solo')).toEqual({ state: 'paid', tier: 'starter', fromStore: true });
    expect(effectiveAccess({ state: 'trial', tier: 'starter' }, 'pro')).toEqual({ state: 'paid', tier: 'pro', fromStore: true });
  });
  it('never downgrades a better server plan', () => {
    expect(effectiveAccess({ state: 'paid', tier: 'pro' }, 'solo')).toEqual({ state: 'paid', tier: 'pro', fromStore: false });
    expect(effectiveAccess({ state: 'paid', tier: 'starter' }, 'pro')).toEqual({ state: 'paid', tier: 'pro', fromStore: true });
  });
  it('without a store entitlement the server decides; nothing known is locked', () => {
    expect(effectiveAccess({ state: 'trial', tier: 'starter' }, null)).toEqual({ state: 'trial', tier: 'starter', fromStore: false });
    expect(effectiveAccess(null, null)).toEqual({ state: 'locked', tier: 'starter', fromStore: false });
  });
});
