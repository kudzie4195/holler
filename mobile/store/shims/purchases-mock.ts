// Capture build only: stands in for @revenuecat/purchases-capacitor and answers with the four store packages at the owner's list prices,
// read from lib/plan/public-prices.ts (which derives every amount from lib/stripe/plans.ts PRICES_CENTS). SIMULATED store prices: no
// store is contacted, and no amount is typed here.
// LAUNCH STATE: the store products carry NO introductory free trial (STORE-SETUP.md, App Store step 2.5 option (a)), so no package has
// an intro price or a Play free phase, and the eligibility check reports "not eligible". The paywall therefore shows the price and
// "Subscribe to <plan>", never a store "free trial" button. The free days in the iOS store image are the server's account trial
// (no card), which the app states in its own words on Welcome.
import { PUBLIC_PRICES } from '../../../lib/plan/public-prices';
import { platform } from '../../src/lib/platform';

const P = PUBLIC_PRICES.plans;
const PRODUCTS = [
  { id: 'solo_monthly', type: 'MONTHLY', product: P.solo.monthly.storeProductId, price: P.solo.monthly.cents / 100, period: P.solo.monthly.period },
  { id: 'solo_annual', type: 'ANNUAL', product: P.solo.annual.storeProductId, price: P.solo.annual.cents / 100, period: P.solo.annual.period },
  { id: 'pro_monthly', type: 'MONTHLY', product: P.pro.monthly.storeProductId, price: P.pro.monthly.cents / 100, period: P.pro.monthly.period },
  { id: 'pro_annual', type: 'ANNUAL', product: P.pro.annual.storeProductId, price: P.pro.annual.cents / 100, period: P.pro.annual.period },
];

function pkg(p: (typeof PRODUCTS)[number]) {
  const base: Record<string, unknown> = {
    identifier: p.product,
    priceString: P[p.id.startsWith('solo') ? 'solo' : 'pro'][p.type === 'MONTHLY' ? 'monthly' : 'annual'].display,
    price: p.price,
    currencyCode: 'USD',
    subscriptionPeriod: p.period,
  };
  if (platform() === 'android') base.defaultOption = { freePhase: null }; // no free phase on the base plan
  else base.introPrice = null; // no introductory offer on the product
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
  checkTrialOrIntroductoryPriceEligibility: async (o: { productIdentifiers: string[] }) => Object.fromEntries(o.productIdentifiers.map((id) => [id, { status: 1 /* INELIGIBLE */ }])),
  getStorefront: async () => ({ countryCode: 'USA' }),
  addCustomerInfoUpdateListener: async () => 'listener-1',
  removeCustomerInfoUpdateListener: async () => undefined,
  restorePurchases: async () => ({ customerInfo: { entitlements: { active: {} } } }),
  purchasePackage: async () => {
    throw Object.assign(new Error('cancelled'), { userCancelled: true });
  },
};
