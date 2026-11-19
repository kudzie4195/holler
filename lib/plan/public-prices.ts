/**
 * THE public price list for the mobile apps (Capacitor iOS and Android) and the App Store / Play listings.
 *
 * Pure and dependency-light on purpose: relative imports only (no '@/' alias, no env, no server code, no Next), so a separate app
 * build can import this file as is. Every amount comes from lib/stripe/plans.ts PRICES_CENTS and every name from lib/plan/limits.ts
 * TIER_NAMES; tests/plan/public-prices.test.ts checks that nothing here is typed by hand.
 *
 * Store identifiers are fixed strings: once a product id exists in App Store Connect or Play Console it cannot be renamed, so they
 * must never be derived from a display name. The internal plan id stays `starter` (database, Stripe metadata); the store-facing
 * plan key and entitlement are `solo`.
 */
import { TRIAL_DAYS } from '../auth/membership';
import { annualMonthsFree, annualSavingLabel, annualSavingsPercent, priceDecimal, priceLabel, PRICES_CENTS, type Plan } from '../stripe/plans';
import { PLAN_LIMITS, TIER_NAMES, type Tier } from './limits';

/** Free trial length in days: the single source (lib/auth/membership.ts), re-exported for the apps. */
export { TRIAL_DAYS };

/** App id (bundle id / application id) of the Holler mobile app. Store product ids are prefixed with it. */
export const APP_ID = 'com.localholler.app';

/** Store entitlements (RevenueCat-style): one per paid plan. `solo` is the internal plan id `starter`. */
export type Entitlement = 'solo' | 'pro';

/** Store product ids, the pattern of the owner's other apps: <app id>.<entitlement>.<monthly|yearly>. Fixed strings, never derived. */
export const STORE_PRODUCT_IDS = {
  solo: { monthly: 'com.localholler.app.solo.monthly', annual: 'com.localholler.app.solo.yearly' },
  pro: { monthly: 'com.localholler.app.pro.monthly', annual: 'com.localholler.app.pro.yearly' },
} as const satisfies Record<Entitlement, Record<Plan, string>>;

export const ENTITLEMENTS: readonly Entitlement[] = ['solo', 'pro'] as const;

/** Internal plan id (holler_profiles.plan, Stripe metadata.tier) for each entitlement, and back. */
export const TIER_FOR_ENTITLEMENT: Record<Entitlement, Tier> = { solo: 'starter', pro: 'pro' };
export const ENTITLEMENT_FOR_TIER: Record<Tier, Entitlement> = { starter: 'solo', pro: 'pro' };

export interface PublicIntervalPrice {
  /** Store product id to create in App Store Connect and Play Console. */
  storeProductId: string;
  /** Amount in US cents. */
  cents: number;
  /** "7.99": for listings and schema.org. */
  decimal: string;
  /** "$7.99". */
  display: string;
  /** "$7.99 a month" / "$79.99 a year". */
  displayLong: string;
  /** "$7.99/mo" / "$79.99/yr". */
  displayShort: string;
  /** ISO 8601 billing period: "P1M" / "P1Y". */
  period: 'P1M' | 'P1Y';
}

export interface PublicPlan {
  entitlement: Entitlement;
  /** Internal plan id used by the web app and the database. */
  tier: Tier;
  /** Display name: "Solo" / "Pro". */
  name: string;
  monthly: PublicIntervalPrice;
  annual: PublicIntervalPrice;
  /** "about 2 months free", computed from the cents (lib/stripe/plans.ts annualSavingLabel). */
  annualSaving: string;
  /** Whole months the yearly price saves, or null when the math does not support "about N months free". */
  annualMonthsFree: number | null;
  /** Whole-percent saving of yearly against 12 monthly payments, computed. */
  annualSavingsPercent: number;
  limits: { serviceAreas: number; trades: number; keywordWatches: number };
}

function interval(tier: Tier, plan: Plan, storeProductId: string): PublicIntervalPrice {
  const display = priceLabel(tier, plan);
  return {
    storeProductId,
    cents: PRICES_CENTS[tier][plan],
    decimal: priceDecimal(tier, plan),
    display,
    displayLong: `${display} ${plan === 'annual' ? 'a year' : 'a month'}`,
    displayShort: `${display}/${plan === 'annual' ? 'yr' : 'mo'}`,
    period: plan === 'annual' ? 'P1Y' : 'P1M',
  };
}

function plan(entitlement: Entitlement): PublicPlan {
  const tier = TIER_FOR_ENTITLEMENT[entitlement];
  const l = PLAN_LIMITS[tier];
  return {
    entitlement,
    tier,
    name: TIER_NAMES[tier],
    monthly: interval(tier, 'monthly', STORE_PRODUCT_IDS[entitlement].monthly),
    annual: interval(tier, 'annual', STORE_PRODUCT_IDS[entitlement].annual),
    annualSaving: annualSavingLabel(tier),
    annualMonthsFree: annualMonthsFree(tier),
    annualSavingsPercent: annualSavingsPercent(tier),
    limits: { serviceAreas: l.areas, trades: l.trades, keywordWatches: l.keywords },
  };
}

export const PUBLIC_PRICES = {
  currency: 'USD',
  /** Free trial length in days. The web trial needs no card. The stores have no introductory offer (mobile/STORE-SETUP.md); if one is added it must match this length. */
  trialDays: TRIAL_DAYS,
  /** ISO 8601 trial period for a store introductory offer, computed from TRIAL_DAYS (P14D today). */
  trialPeriod: `P${TRIAL_DAYS}D`,
  plans: { solo: plan('solo'), pro: plan('pro') } as Record<Entitlement, PublicPlan>,
} as const;

/** Every store product id, in a stable order (solo monthly, solo yearly, pro monthly, pro yearly). */
export const ALL_STORE_PRODUCT_IDS: string[] = ENTITLEMENTS.flatMap((e) => [STORE_PRODUCT_IDS[e].monthly, STORE_PRODUCT_IDS[e].annual]);

/** The entitlement a store product id grants, or null for an unknown id (never guessed). */
export function entitlementForProduct(productId: string): Entitlement | null {
  for (const e of ENTITLEMENTS) if (STORE_PRODUCT_IDS[e].monthly === productId || STORE_PRODUCT_IDS[e].annual === productId) return e;
  return null;
}
