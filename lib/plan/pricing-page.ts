/**
 * Copy and structured data for /pricing. Kept out of the page so tests can check every price against lib/stripe/plans.ts
 * and the refund wording against app/terms (tests/plan/pricing.test.ts).
 */
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { absoluteUrl } from '@/lib/seo/canonical';
import { annualSavingsPercent, priceDecimal, priceLabel } from '@/lib/stripe/plans';
import { PLAN_FEATURES } from './copy';
import { PLAN_LIMITS, TIER_NAMES, TIERS } from './limits';

const S = PLAN_LIMITS.starter;
const P = PLAN_LIMITS.pro;
const m = (t: 'starter' | 'pro') => priceLabel(t, 'monthly');
const y = (t: 'starter' | 'pro') => priceLabel(t, 'annual');

/** The full page title (about 48 characters): used as an absolute title, so the site template does not add a second "Holler". */
export const PRICING_TITLE = `Holler Pricing: Starter ${m('starter')} and Pro ${m('pro')} a Month`;
/** 120 to 160 characters (tests/plan/pricing.test.ts). */
export const PRICING_DESCRIPTION = `Starter is ${m('starter')} a month or ${y('starter')} a year. Pro is ${m('pro')} a month or ${y('pro')} a year. Both start with a ${TRIAL_DAYS}-day free trial, and no card is needed to start.`;

export const PRICING_INTRO = [
  `Holler has two plans. Starter is ${m('starter')} a month and covers one ZIP code and up to ${S.trades} trades.`,
  `Pro is ${m('pro')} a month. It covers up to ${P.areas} ZIP codes and ${P.trades} trades, and adds ${P.keywords} keyword watches.`,
  `Both start with the same ${TRIAL_DAYS}-day free trial. No card is needed.`,
];

/** Rows for the comparison table: [label, Starter, Pro]. */
export const COMPARISON: [string, string, string][] = [
  ['Monthly price', m('starter'), m('pro')],
  ['Yearly price', y('starter'), y('pro')],
  ['Service areas', `${S.areas} ZIP code`, `${P.areas} ZIP codes`],
  ['Trades', `Up to ${S.trades}`, `Up to ${P.trades}`],
  ['Keyword watches', 'None', `Up to ${P.keywords}`],
  ['Email alerts', 'Yes', 'Yes'],
  ['Feed of matches', 'Yes', 'Yes'],
  ['Replies to resident requests', 'Yes', 'Yes'],
];

export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need a card to try it?',
    a: `No. The free trial lasts ${TRIAL_DAYS} days and needs no card. It uses Starter limits, so you get one ZIP code and up to ${S.trades} trades while you try it.`,
  },
  {
    q: 'What happens when the trial ends?',
    a: 'Your feed locks unless you subscribe. We never charge you just because a trial ended. If you subscribe during the trial, the first charge comes when the trial ends.',
  },
  {
    q: 'Can I cancel any time?',
    a: 'Yes. In Settings, choose Manage billing and cancel there. Cancelling stops the next charge. Your plan stays on until the end of the period you already paid for.',
  },
  {
    q: 'Can I switch between Starter and Pro?',
    a: `Yes, from Settings. Moving up to Pro charges your card right away for the days left in your billing period. If that charge fails, nothing changes. Moving down to Starter turns the unused part of Pro into a credit on your next bill. Your extra areas, trades beyond ${S.trades} and keyword watches then stop being used. They stay saved for later.`,
  },
  {
    q: 'Do you give refunds?',
    a: 'Payments are final. We do not refund part of a month or year, except where the law requires it or a plan change is prorated. Think you were charged by mistake? Write to us and we will look into it.',
  },
  {
    q: 'What is a keyword watch?',
    a: `A phrase you pick, such as "tree removal". Holler sends you any record in your areas whose title or summary has that phrase, even when it falls outside your trades. Pro gets up to ${P.keywords}.`,
  },
];

export const YEARLY_NOTE = `Paying yearly saves ${annualSavingsPercent('starter')}% on either plan.`;

/** SoftwareApplication with one Offer per plan. Offer.price is the monthly price; the yearly price is a second UnitPriceSpecification. */
export function pricingLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Holler',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: absoluteUrl('/'),
    description: PRICING_DESCRIPTION,
    offers: TIERS.map((t) => ({
      '@type': 'Offer',
      name: `Holler ${TIER_NAMES[t]}`,
      description: PLAN_FEATURES[t].join('. '),
      price: priceDecimal(t, 'monthly'),
      priceCurrency: 'USD',
      url: absoluteUrl('/pricing'),
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', price: priceDecimal(t, 'monthly'), priceCurrency: 'USD', billingDuration: 'P1M', unitCode: 'MON' },
        { '@type': 'UnitPriceSpecification', price: priceDecimal(t, 'annual'), priceCurrency: 'USD', billingDuration: 'P1Y', unitCode: 'ANN' },
      ],
    })),
  };
}
