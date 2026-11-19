/**
 * Price and trial phrases for public copy (SEO pages, llms.txt, CTAs, metadata). Pure: every figure comes from lib/stripe/plans.ts PRICES_CENTS
 * and every name from lib/plan/limits.ts TIER_NAMES, so no page types a price or a plan name by hand
 * (tests/plan/no-old-prices.test.ts fails on a typed old figure).
 */
import { TRIAL_DAYS } from '../auth/membership';
import { priceLabel } from '../stripe/plans';
import { TIER_NAMES, type Tier } from './limits';

export { TRIAL_DAYS };
/** "14-day free trial". */
export const TRIAL_PHRASE = `${TRIAL_DAYS}-day free trial`;
/** "14 days free". */
export const TRIAL_DAYS_FREE = `${TRIAL_DAYS} days free`;

/** The lowest monthly price ("$7.99"): what "from ... a month" copy quotes. */
export const FROM_MONTHLY = priceLabel('starter', 'monthly');
/** The lowest yearly price ("$79.99"). */
export const FROM_YEARLY = priceLabel('starter', 'annual');

/** "$7.99 a month or $79.99 a year" (style 'a') or "$7.99 per month or $79.99 per year" (style 'per'). */
export function planPrices(tier: Tier, style: 'a' | 'per' = 'a'): string {
  return `${priceLabel(tier, 'monthly')} ${style} month or ${priceLabel(tier, 'annual')} ${style} year`;
}

/** "Solo: $7.99 per month or $79.99 per year" (style 'per') or "Solo is $7.99 a month or $79.99 a year" (style 'a'). */
export function namedPlanPrices(tier: Tier, style: 'a' | 'per' = 'a'): string {
  return style === 'per' ? `${TIER_NAMES[tier]}: ${planPrices(tier, 'per')}` : `${TIER_NAMES[tier]} is ${planPrices(tier, 'a')}`;
}

/** CTA label on the city and week pages: "Get alerts for Austin from $7.99/mo, first 14 days free". */
export function cityCtaLabel(cityName: string, trialDays: number = TRIAL_DAYS): string {
  return `Get alerts for ${cityName} from ${FROM_MONTHLY}/mo, first ${trialDays} days free`;
}

/** CTA label on the storm pages: "Get alerts from $7.99/mo, first 14 days free". */
export function stormCtaLabel(trialDays: number = TRIAL_DAYS): string {
  return `Get alerts from ${FROM_MONTHLY}/mo, first ${trialDays} days free`;
}
