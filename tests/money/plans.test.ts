// Billing plans (U4). Pure parts only. The Stripe field names priceDataFor produces (currency, unit_amount, recurring.interval,
// product_data.name) are the Checkout Session line_items[].price_data fields in node_modules/stripe/esm/resources/Checkout/Sessions.d.ts
// (sourced). The 'year' interval is part of Stripe's recurring.interval enum (sourced: Stripe Prices API); not exercised against the live API here.
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_PRICE_CENTS,
  ANNUAL_SAVINGS_PERCENT,
  MONTHLY_PRICE_CENTS,
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
  it('monthly is $5 a month', () => {
    expect(priceDataFor('monthly')).toMatchObject({ currency: 'usd', unit_amount: 500, recurring: { interval: 'month' } });
  });
  it('annual is $48 a year', () => {
    expect(priceDataFor('annual')).toMatchObject({ currency: 'usd', unit_amount: 4800, recurring: { interval: 'year' } });
  });
});

describe('annual savings copy', () => {
  it('$60 against $48 is exactly 20 percent, so "save 20%" is true and "2 months free" is not claimed', () => {
    expect(MONTHLY_PRICE_CENTS * 12).toBe(6000);
    expect(ANNUAL_PRICE_CENTS).toBe(4800);
    expect(ANNUAL_SAVINGS_PERCENT).toBe(20);
    expect((6000 - 4800) / 6000).toBe(0.2); // exact
    expect(4800 / MONTHLY_PRICE_CENTS).toBe(9.6); // 9.6 months, not 10: so never say "2 months free"
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
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'unpaid', undefined)).toBe('past_due');
  });
  it('deleted is always canceled, whatever the body says', () => {
    expect(statusForSubscriptionEvent('customer.subscription.deleted', 'active', 'active')).toBe('canceled');
  });
  it('statuses that must not change the stored state return null', () => {
    expect(statusForSubscriptionEvent('customer.subscription.updated', 'incomplete', null)).toBeNull();
  });
});
