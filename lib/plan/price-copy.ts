/**
 * Price and trial phrases for public copy (SEO pages, llms.txt, CTAs, metadata). Pure: every figure comes from lib/stripe/plans.ts PRICES_CENTS
 * and every name from lib/plan/limits.ts TIER_NAMES, so no page types a price or a plan name by hand
 * (tests/plan/no-old-prices.test.ts fails on a typed old figure).
 */
import { TRIAL_DAYS } from '../auth/membership';
import { priceLabel } from '../stripe/plans';
import { TIER_NAMES, type Tier } from './limits';

export { TRIAL_DAYS };
/**
 * The trial in whole months, for the headline form: 60 days is "2 months". Computed from TRIAL_DAYS (30 days a month), never typed;
 * tests/plan/no-months-free.test.ts fails if TRIAL_DAYS stops being a whole number of 30-day months.
 */
export const TRIAL_MONTHS = Math.round(TRIAL_DAYS / 30);
/**
 * Headline form: the number of months, then the word for months, then "free" (2 months today). For heroes, CTAs and short lines. The ONLY
 * place that phrase may appear in Holler copy: it is the
 * free trial, never the yearly saving (that is always a percent, "save 16%", lib/stripe/plans.ts annualSavingLabel).
 */
export const TRIAL_HEADLINE = `${TRIAL_MONTHS} ${TRIAL_MONTHS === 1 ? 'month' : 'months'} free`;
/** Precise form: "60-day free trial". For terms, pricing fine print, FAQ, emails and JSON-LD. */
export const TRIAL_PHRASE = `${TRIAL_DAYS}-day free trial`;
// Spanish: lib/i18n es.ts fills the same constants into 'land.trial' ({months} -> the 2-month headline in Spanish) and
// 'land.description' ("prueba gratis de {days} días" -> "prueba gratis de 60 días"); tests/plan/no-months-free.test.ts checks both.

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

/** CTA label on the city and week pages: "Get alerts for Austin from $7.99/mo, " then TRIAL_HEADLINE. */
export function cityCtaLabel(cityName: string): string {
  return `Get alerts for ${cityName} from ${FROM_MONTHLY}/mo, ${TRIAL_HEADLINE}`;
}

/** CTA label on the storm pages: "Get alerts from $7.99/mo, " then TRIAL_HEADLINE. */
export function stormCtaLabel(): string {
  return `Get alerts from ${FROM_MONTHLY}/mo, ${TRIAL_HEADLINE}`;
}
