import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _setPluginForTests,
  configurePurchases,
  currentStoreState,
  freeTrialOf,
  getPackages,
  isPurchasesReady,
  logOutPurchases,
  onStoreChange,
  purchase,
  restorePurchases,
  storeAvailable,
  PurchaseError,
  PurchasePendingError,
  ensurePurchases,
  IDENTITY_MESSAGE,
  restoreMessage,
  RESTORE_NONE_MESSAGE,
  RESTORE_OTHER_ACCOUNT_MESSAGE,
  RESTORED_MESSAGE,
} from '../src/purchases/purchases';
import { effectiveAccess } from '../src/purchases/plan';
import { pollMeUntilPaid } from '../src/state/member';
import type { MeResponse } from '../src/contract';
import { capacitorProxy, settlesWithin } from './helpers';

const product = (id: string, priceString: string, extra: Record<string, unknown> = {}) => ({ identifier: id, priceString, price: 7.99, currencyCode: 'USD', ...extra });
const pkg = (id: string, type: string, p: ReturnType<typeof product>) => ({ identifier: id, packageType: type, product: p });

function iosOfferings() {
  const freeTwoWeeks = { introPrice: { price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 2, cycles: 1 } };
  const available = [
    pkg('$rc_monthly_solo', 'CUSTOM', product('com.localholler.app.solo.monthly', '$7.99', { subscriptionPeriod: 'P1M', ...freeTwoWeeks })),
    pkg('$rc_annual_solo', 'ANNUAL', product('com.localholler.app.solo.yearly', '$79.99', freeTwoWeeks)),
    pkg('$rc_monthly', 'MONTHLY', product('com.localholler.app.pro.monthly', '$13.99', freeTwoWeeks)),
    pkg('$rc_annual', 'ANNUAL', product('com.localholler.app.pro.yearly', '$139.99', freeTwoWeeks)),
    pkg('lifetime', 'LIFETIME', product('com.localholler.app.lifetime', '$999.99')),
  ];
  return { all: { default: { identifier: 'default', availablePackages: available } }, current: null };
}

function activeInfo(entitlement: string | null, managementURL: string | null = 'https://apps.apple.com/account/subscriptions') {
  return { entitlements: { active: entitlement ? { [entitlement]: { identifier: entitlement, isActive: true } } : {} }, managementURL };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
  const calls: Array<[string, unknown]> = [];
  // RevenueCat's own idea of the current app user id.
  let rcUser: string | null = null;
  const rec =
    (name: string, result: unknown) =>
    async (arg?: unknown) => {
      calls.push([name, arg]);
      return typeof result === 'function' ? (result as (a: unknown) => unknown)(arg) : result;
    };
  const impl: Record<string, unknown> = {
    setLogLevel: rec('setLogLevel', undefined),
    configure: rec('configure', (a: { appUserID: string }) => {
      rcUser = a.appUserID;
    }),
    logIn: rec('logIn', (a: { appUserID: string }) => {
      rcUser = a.appUserID;
      return { customerInfo: activeInfo(null), created: false };
    }),
    logOut: rec('logOut', () => {
      rcUser = '$RCAnonymousID:x';
      return { customerInfo: activeInfo(null) };
    }),
    getAppUserID: async () => ({ appUserID: rcUser }),
    getOfferings: rec('getOfferings', iosOfferings()),
    checkTrialOrIntroductoryPriceEligibility: rec('checkTrialOrIntroductoryPriceEligibility', {
      'com.localholler.app.solo.monthly': { status: 2 },
      'com.localholler.app.solo.yearly': { status: 2 },
      'com.localholler.app.pro.monthly': { status: 1 },
      'com.localholler.app.pro.yearly': { status: 0 },
    }),
    purchasePackage: rec('purchasePackage', { productIdentifier: 'com.localholler.app.solo.monthly', customerInfo: activeInfo('solo') }),
    restorePurchases: rec('restorePurchases', { customerInfo: activeInfo('pro') }),
    getCustomerInfo: rec('getCustomerInfo', { customerInfo: activeInfo(null) }),
    addCustomerInfoUpdateListener: rec('addCustomerInfoUpdateListener', 'listener-1'),
    removeCustomerInfoUpdateListener: rec('removeCustomerInfoUpdateListener', { wasRemoved: true }),
    ...overrides,
  };
  const Purchases = capacitorProxy(impl);
  return { mod: { Purchases, LOG_LEVEL: { DEBUG: 'DEBUG', ERROR: 'ERROR' }, PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' } }, calls };
}

afterEach(() => _setPluginForTests(null));

describe('purchases wrapper on the web (no plugin)', () => {
  it('is inert and never throws', async () => {
    expect(storeAvailable()).toBe(false);
    expect(await configurePurchases('user-1')).toBe(false);
    expect(await getPackages()).toEqual([]);
    expect(await currentStoreState()).toBeNull();
    expect(await onStoreChange(() => undefined)).toBeNull();
    await expect(purchase('x', 'user-1')).rejects.toBeInstanceOf(PurchaseError);
  });
});

describe('purchases wrapper against a Capacitor-shaped plugin', () => {
  it('configures once with the Supabase user id, then logIn for a different member, logOut on sign-out', async () => {
    const { mod, calls } = makePlugin();
    _setPluginForTests(mod, { apiKey: 'appl_public' });
    expect(await settlesWithin(configurePurchases('user-1'))).toBe(true);
    expect(await configurePurchases('user-1')).toBe(true);
    expect(calls.filter(([n]) => n === 'configure')).toEqual([['configure', { apiKey: 'appl_public', appUserID: 'user-1' }]]);
    await settlesWithin(logOutPurchases());
    expect(isPurchasesReady()).toBe(false);
    expect(calls.some(([n]) => n === 'logOut')).toBe(true);
    expect(await settlesWithin(configurePurchases('user-2'))).toBe(true);
    expect(calls.filter(([n]) => n === 'configure')).toHaveLength(1);
    expect(calls.find(([n]) => n === 'logIn')?.[1]).toEqual({ appUserID: 'user-2' });
  });

  it('reads { all, current } itself, keeps the four plan packages, and promises a trial only when eligible', async () => {
    const { mod } = makePlugin();
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    const rows = await settlesWithin(getPackages());
    expect(rows.map((r) => [r.entitlement, r.period, r.priceString])).toEqual([
      ['solo', 'monthly', '$7.99'],
      ['solo', 'yearly', '$79.99'],
      ['pro', 'monthly', '$13.99'],
      ['pro', 'yearly', '$139.99'],
    ]);
    expect(rows[0].trial).toEqual({ days: 14, source: 'appstore' });
    expect(rows[1].trial).toEqual({ days: 14, source: 'appstore' });
    expect(rows[2].trial).toBeNull(); // INELIGIBLE (1)
    expect(rows[3].trial).toBeNull(); // UNKNOWN (0)
  });

  it('falls back to `current` and handles Play ids with a :basePlanId suffix', async () => {
    const play = {
      all: {},
      current: {
        identifier: 'default',
        availablePackages: [
          pkg('$rc_monthly', 'MONTHLY', product('com.localholler.app.pro.monthly:monthly', '$13.99', { defaultOption: { freePhase: { billingPeriod: { unit: 'DAY', value: 14, iso8601: 'P14D' } } } })),
          pkg('$rc_annual', 'ANNUAL', product('com.localholler.app.pro.yearly:yearly', '$139.99', { defaultOption: { freePhase: null } })),
        ],
      },
    };
    const { mod, calls } = makePlugin({ getOfferings: async () => play });
    _setPluginForTests(mod, { platform: 'android', apiKey: 'goog_public' });
    await configurePurchases('user-1');
    const rows = await getPackages();
    expect(rows.map((r) => [r.entitlement, r.period, r.productId])).toEqual([
      ['pro', 'monthly', 'com.localholler.app.pro.monthly:monthly'],
      ['pro', 'yearly', 'com.localholler.app.pro.yearly:yearly'],
    ]);
    expect(rows[0].trial).toEqual({ days: 14, source: 'play' });
    expect(rows[1].trial).toBeNull();
    // Play trials are eligibility-checked by Play itself; no iOS eligibility call is made.
    expect(calls.some(([n]) => n === 'checkTrialOrIntroductoryPriceEligibility')).toBe(false);
  });

  it('a purchase returns the new entitlement', async () => {
    const { mod, calls } = makePlugin();
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    await getPackages();
    const state = await settlesWithin(purchase('$rc_monthly_solo', 'user-1'));
    expect(state).toEqual({ entitlement: 'solo', managementUrl: 'https://apps.apple.com/account/subscriptions' });
    const bought = calls.find(([n]) => n === 'purchasePackage')?.[1] as { aPackage: { identifier: string } };
    expect(bought.aPackage.identifier).toBe('$rc_monthly_solo');
  });

  it('a cancelled purchase (code "1") resolves null, any other failure throws a plain message', async () => {
    const cancel = Object.assign(new Error('Purchase was cancelled.'), { code: '1' });
    const { mod } = makePlugin({ purchasePackage: async () => Promise.reject(cancel) });
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    expect(await purchase('$rc_annual', 'user-1')).toBeNull();

    const broken = makePlugin({ purchasePackage: async () => Promise.reject(Object.assign(new Error('store down'), { code: '2' })) });
    _setPluginForTests(broken.mod);
    await configurePurchases('user-1');
    await expect(purchase('$rc_annual', 'user-1')).rejects.toBeInstanceOf(PurchaseError);
  });

  it('restore returns what the store owns; a store failure throws', async () => {
    // Changed in review v2 B1: the answer is now RevenueCat's customer info for this member after the
    // restore, so the fake's getCustomerInfo agrees with what restore found, as the real SDK does.
    const { mod } = makePlugin({ getCustomerInfo: async () => ({ customerInfo: activeInfo('pro') }) });
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    expect(await restorePurchases('user-1')).toMatchObject({ kind: 'restored', entitlement: 'pro' });
    const bad = makePlugin({ restorePurchases: async () => Promise.reject(new Error('x')) });
    _setPluginForTests(bad.mod);
    await configurePurchases('user-1');
    await expect(restorePurchases('user-1')).rejects.toBeInstanceOf(PurchaseError);
  });

  it('a store that never answers a background read times out instead of hanging', async () => {
    const never = () => new Promise(() => undefined);
    const { mod } = makePlugin({ getOfferings: never, getCustomerInfo: never });
    _setPluginForTests(mod, { readTimeoutMs: 30 });
    await configurePurchases('user-1');
    expect(await settlesWithin(getPackages(), 500)).toEqual([]);
    expect(await settlesWithin(currentStoreState(), 500)).toBeNull();
  });

  it('a failed configure leaves the wrapper inert', async () => {
    const { mod } = makePlugin({ configure: async () => Promise.reject(new Error('bad key')) });
    _setPluginForTests(mod);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await configurePurchases('user-1')).toBe(false);
    expect(await getPackages()).toEqual([]);
  });

  it('the store listener reports entitlements and unsubscribes by id', async () => {
    let fire: ((info: unknown) => void) | null = null;
    const { mod, calls } = makePlugin({
      addCustomerInfoUpdateListener: async (cb: (info: unknown) => void) => {
        fire = cb;
        return 'listener-9';
      },
    });
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    const seen: unknown[] = [];
    const off = await settlesWithin(onStoreChange((s) => seen.push(s)));
    fire!(activeInfo('pro', null));
    expect(seen).toEqual([{ entitlement: 'pro', managementUrl: null }]);
    off!();
    await Promise.resolve();
    expect(calls.find(([n]) => n === 'removeCustomerInfoUpdateListener')?.[1]).toEqual({ listenerToRemove: 'listener-9' });
  });
});

describe('purchase identity (review r6 P1)', () => {
  it('a failed logIn for member B never lets B buy as member A', async () => {
    const { mod, calls } = makePlugin({
      logIn: async () => Promise.reject(new Error('network')),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    _setPluginForTests(mod);
    expect(await configurePurchases('A')).toBe(true);
    expect(await configurePurchases('B')).toBe(false);
    expect(isPurchasesReady()).toBe(false);
    expect(await getPackages('B')).toEqual([]);
    expect(await getPackages()).toEqual([]);
    expect(await ensurePurchases('B')).toBe(false);
    await expect(purchase('$rc_monthly_solo', 'B')).rejects.toThrow(IDENTITY_MESSAGE);
    await expect(restorePurchases('B')).rejects.toThrow(IDENTITY_MESSAGE);
    expect(calls.some(([n]) => n === 'purchasePackage' || n === 'restorePurchases')).toBe(false);
  });

  it('blocks when RevenueCat reports a different app user id than the signed-in member', async () => {
    const { mod, calls } = makePlugin({ getAppUserID: async () => ({ appUserID: 'someone-else' }) });
    _setPluginForTests(mod);
    expect(await configurePurchases('user-1')).toBe(true);
    expect(await ensurePurchases('user-1')).toBe(false);
    await expect(purchase('$rc_monthly_solo', 'user-1')).rejects.toThrow(IDENTITY_MESSAGE);
    expect(calls.some(([n]) => n === 'purchasePackage')).toBe(false);
  });

  it('packages loaded for one member are not sold to another', async () => {
    const { mod } = makePlugin();
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    expect((await getPackages('user-1')).length).toBe(4);
    expect(await getPackages('user-2')).toEqual([]);
  });
});

describe('pending purchase and restore deadline (review r6 P2)', () => {
  it('a pending payment (code "20") says pending, never "not charged", and unlocks nothing', async () => {
    const pending = Object.assign(new Error('The payment is pending.'), { code: '20', readableErrorCode: 'PAYMENT_PENDING_ERROR' });
    const { mod } = makePlugin({ purchasePackage: async () => Promise.reject(pending) });
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    const err = await purchase('$rc_annual', 'user-1').catch((e) => e);
    expect(err).toBeInstanceOf(PurchasePendingError);
    expect(String(err.message)).toMatch(/pending/i);
    expect(String(err.message)).not.toMatch(/not charged/i);
  });

  it('a generic failure makes no claim about charging', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { mod } = makePlugin({ purchasePackage: async () => Promise.reject(Object.assign(new Error('x'), { code: '2' })) });
    _setPluginForTests(mod);
    await configurePurchases('user-1');
    const err = await purchase('$rc_annual', 'user-1').catch((e) => e);
    expect(err).toBeInstanceOf(PurchaseError);
    expect(String(err.message)).not.toMatch(/not charged/i);
  });

  it('a restore the store never answers fails with a plain message instead of hanging', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { mod } = makePlugin({ restorePurchases: () => new Promise(() => undefined) });
    _setPluginForTests(mod, { restoreTimeoutMs: 30 });
    await configurePurchases('user-1');
    await expect(settlesWithin(restorePurchases('user-1'), 500)).rejects.toThrow('We could not reach the store. Try again.');
  });
});

describe('freeTrialOf', () => {
  it('ignores a paid intro price', () => {
    expect(freeTrialOf({ introPrice: { price: 0.99, periodUnit: 'MONTH', periodNumberOfUnits: 1, cycles: 1 } })).toBeNull();
  });
  it('reads days and weeks', () => {
    expect(freeTrialOf({ introPrice: { price: 0, periodUnit: 'DAY', periodNumberOfUnits: 14, cycles: 1 } })).toEqual({ days: 14, source: 'appstore' });
    expect(freeTrialOf({ defaultOption: { freePhase: { billingPeriod: { unit: 'WEEK', value: 2 } } } })).toEqual({ days: 14, source: 'play' });
    expect(freeTrialOf(null)).toBeNull();
  });
});

// Review v2 B1: Restore purchases on a second account. "Your subscription is restored" only when
// RevenueCat's customer info for the signed-in member shows an active Holler entitlement.
describe('restore on a second account (review v2 B1)', () => {
  /** A store whose purchase is owned by `owner`; RevenueCat customer info is per app user id. */
  function storeOwnedBy(owner: string, behaviour: 'transfer' | 'keep-original-error' | 'keep-original-silent') {
    const entitlementsByUser = new Map<string, string | null>([[owner, 'pro']]);
    let rcUser: string | null = null;
    const infoFor = (u: string | null) => activeInfo(u ? (entitlementsByUser.get(u) ?? null) : null);
    return makePlugin({
      configure: async (a: { appUserID: string }) => void (rcUser = a.appUserID),
      logIn: async (a: { appUserID: string }) => {
        rcUser = a.appUserID;
        return { customerInfo: infoFor(rcUser), created: false };
      },
      getAppUserID: async () => ({ appUserID: rcUser }),
      restorePurchases: async () => {
        if (behaviour === 'keep-original-error' && rcUser !== owner) {
          throw Object.assign(new Error('This receipt is already in use by another subscriber.'), { code: '7', readableErrorCode: 'RECEIPT_ALREADY_IN_USE_ERROR' });
        }
        if (behaviour === 'transfer' && rcUser) {
          entitlementsByUser.set(owner, null);
          entitlementsByUser.set(rcUser, 'pro');
        }
        // Keep-original-silent: the restore succeeds but the current user gets nothing. The restore's
        // own answer is the ORIGINAL owner's, as a wrongly read answer would look.
        return { customerInfo: behaviour === 'keep-original-silent' ? infoFor(owner) : infoFor(rcUser) };
      },
      getCustomerInfo: async () => ({ customerInfo: infoFor(rcUser) }),
    });
  }

  it('the purchase belongs to another Holler account: says so plainly, never "restored"', async () => {
    const { mod } = storeOwnedBy('member-A', 'keep-original-error');
    _setPluginForTests(mod);
    const r = await restorePurchases('member-E');
    expect(r).toEqual({ kind: 'other-account' });
    expect(restoreMessage(r)).toEqual({ tone: 'warn', text: RESTORE_OTHER_ACCOUNT_MESSAGE });
    expect(RESTORE_OTHER_ACCOUNT_MESSAGE).toBe('This purchase is linked to another Holler account. Sign in to that account, or contact support.');
  });

  it('nothing active for this member after the restore: "No active Holler subscription was found"', async () => {
    const { mod } = storeOwnedBy('member-A', 'keep-original-silent');
    _setPluginForTests(mod);
    const r = await restorePurchases('member-E');
    expect(r).toEqual({ kind: 'none' });
    expect(restoreMessage(r).text).toBe('No active Holler subscription was found for this Apple or Google account.');
    expect(restoreMessage(r).text).toBe(RESTORE_NONE_MESSAGE);
  });

  it('restored only when the current member\'s customer info shows the entitlement', async () => {
    const { mod } = storeOwnedBy('member-A', 'transfer');
    _setPluginForTests(mod);
    const r = await restorePurchases('member-E');
    expect(r).toMatchObject({ kind: 'restored', entitlement: 'pro' });
    expect(restoreMessage(r)).toEqual({ tone: 'success', text: RESTORED_MESSAGE });
  });

  it('RevenueCat pointed at someone else after the restore: identity error, not "restored"', async () => {
    let rc = 'member-E';
    const { mod } = makePlugin({
      configure: async () => undefined,
      getAppUserID: async () => ({ appUserID: rc }),
      restorePurchases: async () => {
        rc = 'member-A';
        return { customerInfo: activeInfo('pro') };
      },
      getCustomerInfo: async () => ({ customerInfo: activeInfo('pro') }),
    });
    _setPluginForTests(mod);
    await expect(restorePurchases('member-E')).rejects.toThrow(IDENTITY_MESSAGE);
  });

  it('after a restore the server never confirms: polling ends quietly and the UI stays unlocked from the store', async () => {
    const locked = { needsOnboarding: false, access: { state: 'locked', tier: 'starter' } } as unknown as MeResponse;
    const me = vi.fn(async () => locked);
    const seen: MeResponse[] = [];
    const outcome = await settlesWithin(pollMeUntilPaid(me, (m) => seen.push(m), [1000, 2000, 4000, 8000], async () => undefined));
    expect(outcome).toBe('unconfirmed');
    expect(me).toHaveBeenCalledTimes(4);
    expect(seen).toHaveLength(4);
    expect(effectiveAccess(locked.access, 'pro')).toEqual({ state: 'paid', tier: 'pro', fromStore: true });
    // A failing /api/m/me is swallowed too.
    expect(await pollMeUntilPaid(async () => Promise.reject(new Error('down')), () => undefined, [1, 1], async () => undefined)).toBe('unconfirmed');
  });

  it('polling stops as soon as the server says paid', async () => {
    const paid = { needsOnboarding: false, access: { state: 'paid', tier: 'pro' } } as unknown as MeResponse;
    const me = vi.fn(async () => paid);
    expect(await pollMeUntilPaid(me, () => undefined, [1, 1, 1], async () => undefined)).toBe('confirmed');
    expect(me).toHaveBeenCalledTimes(1);
  });
});
