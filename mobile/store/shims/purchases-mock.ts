// Capture build only: stands in for @revenuecat/purchases-capacitor and answers with the four store packages at the owner's list prices
// (Solo $7.99 / $79.99, Pro $13.99 / $139.99, 14-day free trial). These are SIMULATED store prices; no store is contacted.
import { platform } from '../../src/lib/platform';

const PRODUCTS = [
  { id: 'solo_monthly', type: 'MONTHLY', product: 'com.localholler.app.solo.monthly', price: 7.99, period: 'P1M' },
  { id: 'solo_annual', type: 'ANNUAL', product: 'com.localholler.app.solo.yearly', price: 79.99, period: 'P1Y' },
  { id: 'pro_monthly', type: 'MONTHLY', product: 'com.localholler.app.pro.monthly', price: 13.99, period: 'P1M' },
  { id: 'pro_annual', type: 'ANNUAL', product: 'com.localholler.app.pro.yearly', price: 139.99, period: 'P1Y' },
];

function pkg(p: (typeof PRODUCTS)[number]) {
  const base: Record<string, unknown> = {
    identifier: p.product,
    priceString: `$${p.price.toFixed(2)}`,
    price: p.price,
    currencyCode: 'USD',
    subscriptionPeriod: p.period,
  };
  if (platform() === 'android') base.defaultOption = { freePhase: { billingPeriod: { unit: 'DAY', value: 14 } } };
  else base.introPrice = { price: 0, periodUnit: 'DAY', periodNumberOfUnits: 14, cycles: 1 };
  return { identifier: p.id, packageType: p.type, product: base };
}

const offering = { identifier: 'default', availablePackages: PRODUCTS.map(pkg) };

export const LOG_LEVEL = { DEBUG: 'DEBUG', ERROR: 'ERROR' };
export const PURCHASES_ERROR_CODE = { PURCHASE_CANCELLED_ERROR: '1' };
export const Purchases = {
  setLogLevel: async () => undefined,
  configure: async () => undefined,
  logIn: async () => ({}),
  logOut: async () => ({}),
  getOfferings: async () => ({ all: { default: offering }, current: offering }),
  getCustomerInfo: async () => ({ customerInfo: { entitlements: { active: {} }, managementURL: null } }),
  checkTrialOrIntroductoryPriceEligibility: async (o: { productIdentifiers: string[] }) => Object.fromEntries(o.productIdentifiers.map((id) => [id, { status: 2 }])),
  getStorefront: async () => ({ countryCode: 'USA' }),
  addCustomerInfoUpdateListener: async () => 'listener-1',
  removeCustomerInfoUpdateListener: async () => undefined,
  restorePurchases: async () => ({ customerInfo: { entitlements: { active: {} } } }),
  purchasePackage: async () => {
    throw Object.assign(new Error('cancelled'), { userCancelled: true });
  },
};
