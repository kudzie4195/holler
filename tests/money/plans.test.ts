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
  annualMonthsFree,
  annualMonthsSaved,
  annualSavingLabel,
  annualSavingsCents,
  parsePlan,
  priceDataFor,
  statusForSubscriptionEvent,
  trialParams,
  alreadySubscribed,
} from '../../lib/stripe';

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
  it('Solo: 12 x $7.99 = $95.88 against $79.99 saves $15.89, which is 1.99 monthly payments: "about 2 months free"', () => {
    expect(MONTHLY_PRICE_CENTS * 12).toBe(9588);
    expect(ANNUAL_PRICE_CENTS).toBe(7999);
    expect(annualSavingsCents('starter')).toBe(1589);
    expect(annualMonthsSaved('starter')).toBeCloseTo(1.9887, 3);
    expect(annualMonthsFree('starter')).toBe(2);
    expect(annualSavingLabel('starter')).toBe('about 2 months free');
    expect(ANNUAL_SAVINGS_PERCENT).toBe(17); // (9588 - 7999) / 9588 = 16.57%
  });
  it('Pro: 12 x $13.99 = $167.88 against $139.99 saves $27.89, which is 1.99 monthly payments: "about 2 months free"', () => {
    expect(PRICES_CENTS.pro.monthly * 12).toBe(16788);
    expect(annualSavingsCents('pro')).toBe(2789);
    expect(annualMonthsSaved('pro')).toBeCloseTo(1.9936, 3);
    expect(annualSavingLabel('pro')).toBe('about 2 months free');
  });
  it('the old prices would NOT earn "months free" (9.6 months paid for 12): the helper falls back to a computed percent', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const plans = await import('../../lib/stripe/plans');
    const saved = { ...plans.PRICES_CENTS.starter };
    try {
      plans.PRICES_CENTS.starter.monthly = 500;
      plans.PRICES_CENTS.starter.annual = 4800;
      expect(plans.annualMonthsFree('starter')).toBeNull(); // 1200 / 500 = 2.4 months: not within 0.05 of a whole number
      expect(plans.annualSavingLabel('starter')).toBe('save 20%');
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
