// Billing plans (U4). Pure parts only. The Stripe field names priceDataFor produces (currency, product, unit_amount, recurring.interval)
// are the Checkout Session line_items[].price_data fields in node_modules/stripe/esm/resources/Checkout/Sessions.d.ts
// (sourced). The 'year' interval is part of Stripe's recurring.interval enum (sourced: Stripe Prices API); not exercised against the live API here.
import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  ANNUAL_PRICE_CENTS,
  ANNUAL_SAVINGS_PERCENT,
  MONTHLY_PRICE_CENTS,
  PRICES_CENTS,
  PRODUCT_IDS,
  annualSavingLabel,
  annualSavingSentence,
  annualSavingsCents,
  parsePlan,
  priceDataFor,
  statusForSubscriptionEvent,
  trialParams,
  alreadySubscribed,
  MAX_TRIAL_MS,
} from '../../lib/stripe';
import { TRIAL_DAYS } from '../../lib/auth/membership';

describe('parsePlan', () => {
  it('defaults to monthly when there is no body or no plan', () => {
    expect(parsePlan(undefined)).toBe('monthly');
    expect(parsePlan(null)).toBe('monthly');
    expect(parsePlan({})).toBe('monthly');
    expect(parsePlan({ plan: null })).toBe('monthly');
  });
  it('accepts monthly and annual', () => {
    expect(parsePlan({ plan: 'monthly' })).toBe('monthly');
    expect(parsePlan({ plan: 'annual' })).toBe('annual');
  });
  it('rejects anything else instead of guessing a price', () => {
    for (const bad of [{ plan: 'yearly' }, { plan: 'ANNUAL' }, { plan: 12 }, { plan: '' }, 'annual', ['annual'], 7]) expect(parsePlan(bad)).toBeNull();
  });
});

describe('priceDataFor', () => {
  it('Solo (id starter) monthly is 799 cents a month on the fixed product, never product_data', () => {
    const d = priceDataFor('monthly', 'starter', PRODUCT_IDS.starter);
    expect(d).toEqual({ currency: 'usd', product: 'holler_starter', unit_amount: 799, recurring: { interval: 'month' } });
    expect(d).not.toHaveProperty('product_data');
  });
  it('Solo annual 7999, Pro monthly 1399, Pro annual 13999', () => {
    expect(priceDataFor('annual', 'starter', 'holler_starter')).toMatchObject({ unit_amount: 7999, recurring: { interval: 'year' } });
    expect(priceDataFor('monthly', 'pro', 'holler_pro')).toMatchObject({ unit_amount: 1399, recurring: { interval: 'month' }, product: 'holler_pro' });
    expect(priceDataFor('annual', 'pro', 'holler_pro')).toMatchObject({ unit_amount: 13999, recurring: { interval: 'year' } });
  });
  it('the shape type-checks as stripe@23 Checkout line_items[].price_data', () => {
    const li: Stripe.Checkout.SessionCreateParams.LineItem = { quantity: 1, price_data: priceDataFor('annual', 'pro', 'holler_pro') };
    expect(li.price_data?.product).toBe('holler_pro');
  });
});

describe('annual savings copy: computed, never typed', () => {
  it('Solo: 12 x $7.99 = $95.88 against $79.99 saves $15.89 = 16.57%, shown rounded down as "save 16%"', () => {
    expect(MONTHLY_PRICE_CENTS * 12).toBe(9588);
    expect(ANNUAL_PRICE_CENTS).toBe(7999);
    expect(annualSavingsCents('starter')).toBe(1589);
    expect(annualSavingLabel('starter')).toBe('save 16%');
    expect(annualSavingSentence('starter')).toBe('Paying yearly saves 16%.');
    expect(ANNUAL_SAVINGS_PERCENT).toBe(16); // (9588 - 7999) / 9588 = 16.57%, rounded down
  });
  it('Pro: 12 x $13.99 = $167.88 against $139.99 saves $27.89 = 16.61%, shown as "save 16%"', () => {
    expect(PRICES_CENTS.pro.monthly * 12).toBe(16788);
    expect(annualSavingsCents('pro')).toBe(2789);
    expect(annualSavingLabel('pro')).toBe('save 16%');
    expect(annualSavingSentence('pro')).toBe('Paying yearly saves 16%.');
  });
  it('rounds down, and is empty when the saving is under 1% or a price is missing', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const plans = await import('../../lib/stripe/plans');
    const saved = { ...plans.PRICES_CENTS.starter };
    try {
      plans.PRICES_CENTS.starter.monthly = 500;
      plans.PRICES_CENTS.starter.annual = 4800;
      expect(plans.annualSavingLabel('starter')).toBe('save 20%');
      plans.PRICES_CENTS.starter.annual = 5950; // 0.8% saving
      expect(plans.annualSavingLabel('starter')).toBe('');
      expect(plans.annualSavingSentence('starter')).toBe('');
      plans.PRICES_CENTS.starter.annual = 0;
      expect(plans.annualSavingLabel('starter')).toBe('');
      plans.PRICES_CENTS.starter.annual = 6000;
      expect(plans.annualSavingLabel('starter')).toBe('');
    } finally {
      Object.assign(plans.PRICES_CENTS.starter, saved); // a fresh module instance (resetModules), restored anyway
    }
  });
});

describe('trial rules are plan independent', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  it('keeps the trial end for an early subscriber, so the first charge is after the trial', () => {
    const end = '2026-11-22T12:00:00Z';
    expect(trialParams(end, now)).toEqual({ trial_end: Math.ceil(Date.parse(end) / 1000) });
  });
  it('charges now only when the trial is over', () => {
    expect(trialParams('2026-11-10T00:00:00Z', now)).toEqual({});
  });
  it('round 23: a full TRIAL_DAYS trial passes as the exact trial_end (Stripe: at least 48 h ahead, a trial at most 730 days)', () => {
    const day = 86_400_000;
    const full = new Date(now + TRIAL_DAYS * day).toISOString();
    expect(TRIAL_DAYS).toBe(30);
    expect(trialParams(full, now)).toEqual({ trial_end: Math.ceil((now + TRIAL_DAYS * day) / 1000) });
    // a round-18 member still holding 60 days, and just over 48 hours left: still the exact end
    expect(trialParams(new Date(now + 60 * day - 3_600_000).toISOString(), now)).toEqual({ trial_end: Math.ceil((now + 60 * day - 3_600_000) / 1000) });
    expect(trialParams(new Date(now + 2 * day + 6 * 60_000).toISOString(), now)).toEqual({ trial_end: Math.ceil((now + 2 * day + 6 * 60_000) / 1000) });
    // under 48 hours: whole days, never a charge inside the trial
    expect(trialParams(new Date(now + 30 * 3_600_000).toISOString(), now)).toEqual({ trial_period_days: 2 });
    // bad data beyond TRIAL_MAX_DAYS is cut back, never sent to Stripe as is
    expect(trialParams(new Date(now + 400 * day).toISOString(), now)).toEqual({ trial_end: Math.ceil((now + MAX_TRIAL_MS) / 1000) });
    expect(MAX_TRIAL_MS).toBeLessThanOrEqual(730 * day);
  });
  it('already subscribed guard covers both plans (status, not plan)', () => {
    expect(alreadySubscribed('active')).toBe(true);
    expect(alreadySubscribed('past_due')).toBe(true);
    expect(alreadySubscribed('trialing')).toBe(false);
    expect(alreadySubscribed('canceled')).toBe(false);
  });
});

describe('statusForSubscriptionEvent (F-8)', () => {
  it('the fresh status wins over a stale event body', () => {
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'past_due', 'active')).toBe('active');
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'active', 'canceled')).toBe('canceled');
  });
  it('falls back to the event status when the fresh read failed', () => {
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'past_due', null)).toBe('past_due');
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'unpaid', undefined)).toBe('canceled');
  });
  it('deleted is always canceled, whatever the body says', () => {
    expect(statusForSubscriptionEvent('customer.subscription.deleted', 'active', 'active')).toBe('canceled');
  });
  it('statuses that must not change the stored state return null', () => {
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'incomplete', null)).toBeNull();
  });
});
