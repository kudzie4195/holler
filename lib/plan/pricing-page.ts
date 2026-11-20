/**
 * Copy and structured data for /pricing. Kept out of the page so tests can check every price against lib/stripe/plans.ts
 * and the refund wording against app/terms (tests/plan/pricing.test.ts).
 */
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { absoluteUrl } from '@/lib/seo/canonical';
import { annualMonthsFree, annualSavingLabel, annualSavingsPercent, priceDecimal, priceLabel } from '@/lib/stripe/plans';
import { PLAN_FEATURES } from './copy';
import { PLAN_LIMITS, TIER_NAMES, TIERS, type Tier } from './limits';

const S = PLAN_LIMITS.starter;
const P = PLAN_LIMITS.pro;
const SOLO = TIER_NAMES.starter;
const PRO = TIER_NAMES.pro;
const m = (t: Tier) => priceLabel(t, 'monthly');
const y = (t: Tier) => priceLabel(t, 'annual');

/** The full page title (under 60 characters): used as an absolute title, so the site template does not add a second "Holler". */
export const PRICING_TITLE = `Holler Pricing: ${SOLO} ${m('starter')} and ${PRO} ${m('pro')} a Month`;
/** 120 to 160 characters (tests/plan/pricing.test.ts). */
export const PRICING_DESCRIPTION = `${SOLO} is ${m('starter')} a month or ${y('starter')} a year. ${PRO} is ${m('pro')} a month or ${y('pro')} a year. Both start with a ${TRIAL_DAYS}-day free trial, no card needed.`;

/**
 * The one sentence in the green band (app/pricing/page.tsx). Final review B P2-1: the paragraph that restated each plan's price and
 * limits under the cards is gone; the cards and the table already say it, and the prices were shown three times in a row.
 */
export const PRICING_INTRO = ['Holler has two plans, and you can pay for either one by the month or by the year.'];

/** Rows for the comparison table: [label, Solo, Pro]. */
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
    a: `No. The free trial lasts ${TRIAL_DAYS} days with no card, and it runs on ${SOLO} limits: one ZIP code and up to ${S.trades} trades while you try it.`,
  },
  {
    q: 'What happens when the trial ends?',
    a: 'Your feed locks unless you subscribe. We never charge you just because a trial ended, and if you subscribe on the website during the trial, the first charge comes when it ends. A plan you buy in the app is charged by Apple or Google when you buy it.',
  },
  {
    q: 'Can I cancel any time?',
    a: 'Yes. Choose Manage billing in Settings and cancel there, which stops the next charge, and your plan stays on until the end of the period you already paid for.',
  },
  {
    q: `Can I switch between ${SOLO} and ${PRO}?`,
    a: `Yes, in Settings. Moving up to ${PRO} charges your card right away for the days left in your billing period, and if that charge fails, nothing changes. Moving down to ${SOLO} turns the unused part of ${PRO} into a credit on your next bill. Your extra areas, trades beyond ${S.trades} and keyword watches then stop being used, but they stay saved for later. Either way, you move to the current price of the plan you pick.`,
  },
  {
    q: 'Do you give refunds?',
    a: 'Payments are final. We do not refund part of a month or year, except where the law requires it or a plan change is prorated. If you think we charged you by mistake, write to us and we will look into it.',
  },
  {
    q: 'What is a keyword watch?',
    a: `A keyword watch is a phrase you pick, such as "tree removal", and ${PRO} gets up to ${P.keywords} of them. Holler sends you any record in your areas whose title or summary has that phrase, even when it falls outside your trades.`,
  },
];

/** The yearly saving line under the cards. Every number comes from lib/stripe/plans.ts (computed from the cents), never typed. */
export function yearlyNote(): string {
  const solo = annualMonthsFree('starter');
  const pro = annualMonthsFree('pro');
  if (solo !== null && solo === pro) return `Pay yearly on either plan and you get ${annualSavingLabel('starter')}.`;
  return `Paying yearly saves ${annualSavingsPercent('starter')}% on ${SOLO} and ${annualSavingsPercent('pro')}% on ${PRO}.`;
}

export const YEARLY_NOTE = yearlyNote();

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
