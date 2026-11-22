// lib/plan/public-prices.ts: the one price module the mobile apps and the store listings read. Values must come from the web price
// table (no second copy to drift), store ids are fixed strings, and the module must import nothing that needs the Next app
// (no '@/' alias, no env, no server-only), so a separate Capacitor build can import it as is.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_STORE_PRODUCT_IDS,
  APP_ID,
  ENTITLEMENT_FOR_TIER,
  ENTITLEMENTS,
  PUBLIC_PRICES,
  STORE_PRODUCT_IDS,
  TIER_FOR_ENTITLEMENT,
  TRIAL_DAYS,
  entitlementForProduct,
} from '@/lib/plan/public-prices';
import { TRIAL_DAYS as MEMBERSHIP_TRIAL_DAYS } from '@/lib/auth/membership';
import { PLAN_LIMITS, TIER_NAMES } from '@/lib/plan/limits';
import { PRICES_CENTS, annualSavingLabel, priceLabel } from '@/lib/stripe/plans';

describe('public prices for the apps and stores', () => {
  it('app id, store product ids and entitlements are the fixed strings the owner chose', () => {
    expect(APP_ID).toBe('com.localholler.app');
    expect(STORE_PRODUCT_IDS).toEqual({
      solo: { monthly: 'com.localholler.app.solo.monthly', annual: 'com.localholler.app.solo.yearly' },
      pro: { monthly: 'com.localholler.app.pro.monthly', annual: 'com.localholler.app.pro.yearly' },
    });
    expect(ALL_STORE_PRODUCT_IDS).toEqual([
      'com.localholler.app.solo.monthly',
      'com.localholler.app.solo.yearly',
      'com.localholler.app.pro.monthly',
      'com.localholler.app.pro.yearly',
    ]);
    for (const id of ALL_STORE_PRODUCT_IDS) expect(id.startsWith(`${APP_ID}.`)).toBe(true);
    expect(ENTITLEMENTS).toEqual(['solo', 'pro']);
    expect(TIER_FOR_ENTITLEMENT).toEqual({ solo: 'starter', pro: 'pro' });
    expect(ENTITLEMENT_FOR_TIER).toEqual({ starter: 'solo', pro: 'pro' });
  });

  it('entitlementForProduct maps every id and never guesses an unknown one', () => {
    expect(entitlementForProduct('com.localholler.app.solo.yearly')).toBe('solo');
    expect(entitlementForProduct('com.localholler.app.pro.monthly')).toBe('pro');
    for (const bad of ['', 'holler_solo_monthly', 'com.localholler.app.gold.monthly', 'com.localholler.app.pro']) expect(entitlementForProduct(bad)).toBeNull();
  });

  it('the trial is 14 days, the same constant the web app uses', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_DAYS).toBe(MEMBERSHIP_TRIAL_DAYS);
    expect(PUBLIC_PRICES.trialDays).toBe(14);
    expect(PUBLIC_PRICES.trialPeriod).toBe('P14D');
  });

  it('display strings and amounts', () => {
    const { solo, pro } = PUBLIC_PRICES.plans;
    expect([solo.name, pro.name]).toEqual(['Solo', 'Pro']);
    expect([solo.monthly.display, solo.annual.display, pro.monthly.display, pro.annual.display]).toEqual(['$7.99', '$79.99', '$13.99', '$139.99']);
    expect([solo.monthly.displayLong, solo.annual.displayLong]).toEqual(['$7.99 a month', '$79.99 a year']);
    expect([pro.monthly.displayShort, pro.annual.displayShort]).toEqual(['$13.99/mo', '$139.99/yr']);
    expect([solo.monthly.cents, solo.annual.cents, pro.monthly.cents, pro.annual.cents]).toEqual([799, 7999, 1399, 13999]);
    expect([solo.monthly.decimal, pro.annual.decimal]).toEqual(['7.99', '139.99']);
    expect([solo.monthly.period, solo.annual.period]).toEqual(['P1M', 'P1Y']);
    expect([solo.annualSaving, pro.annualSaving]).toEqual(['save 16%', 'save 16%']);
    expect([solo.annualSavingsPercent, pro.annualSavingsPercent]).toEqual([16, 16]);
    expect(PUBLIC_PRICES.currency).toBe('USD');
  });

  it('every value is derived from the web tables (no second copy)', () => {
    for (const e of ENTITLEMENTS) {
      const p = PUBLIC_PRICES.plans[e];
      const tier = TIER_FOR_ENTITLEMENT[e];
      expect(p.tier).toBe(tier);
      expect(p.name).toBe(TIER_NAMES[tier]);
      expect(p.monthly.cents).toBe(PRICES_CENTS[tier].monthly);
      expect(p.annual.cents).toBe(PRICES_CENTS[tier].annual);
      expect(p.monthly.display).toBe(priceLabel(tier, 'monthly'));
      expect(p.annual.display).toBe(priceLabel(tier, 'annual'));
      expect(p.annualSaving).toBe(annualSavingLabel(tier));
      expect(p.limits).toEqual({ serviceAreas: PLAN_LIMITS[tier].areas, trades: PLAN_LIMITS[tier].trades, keywordWatches: PLAN_LIMITS[tier].keywords });
      expect(p.monthly.storeProductId).toBe(STORE_PRODUCT_IDS[e].monthly);
      expect(p.annual.storeProductId).toBe(STORE_PRODUCT_IDS[e].annual);
    }
  });

  it('imports nothing an app build cannot load: relative paths only, no env, no server code, no Next, all the way down', () => {
    const root = path.resolve(__dirname, '../..');
    const seen = new Set<string>();
    const walk = (rel: string) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/from '@\/|from "@\/|process\.env|server-only|from 'next|from "next|lib\/env/);
      for (const m of src.matchAll(/^(?:import|export)[^'"]*from\s+'(\.[^']+)'/gm)) {
        const next = path.normalize(path.join(path.dirname(rel), m[1] + '.ts'));
        walk(next);
      }
    };
    walk('lib/plan/public-prices.ts');
    // review r2: limits.ts reads the shared paid test from lib/storebilling/source.ts (pure, no imports).
    expect([...seen].sort()).toEqual(['lib/auth/membership.ts', 'lib/plan/limits.ts', 'lib/plan/public-prices.ts', 'lib/storebilling/source.ts', 'lib/stripe/plans.ts']);
  });
});
