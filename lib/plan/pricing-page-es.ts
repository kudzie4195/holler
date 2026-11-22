/**
 * Copy and structured data for /es/pricing, the Spanish twin of lib/plan/pricing-page.ts. Words come from the dictionary (es-account.ts);
 * every price, limit and the trial length come from the same constants as the English page, through lib/plan/price-copy-es.ts.
 */
import { TRIAL_DAYS } from './price-copy';
import { t } from '../i18n';
import { absoluteUrl } from '../seo/canonical';
import { annualSavingsPercent, priceDecimal, priceLabel } from '../stripe/plans';
import { namedPlanPricesEs, planFeaturesEs, planNameEs, trialPhraseEs } from './price-copy-es';
import { PLAN_LIMITS, TIERS } from './limits';

const L = 'es' as const;
const S = PLAN_LIMITS.starter;
const P = PLAN_LIMITS.pro;
const SOLO = planNameEs('starter');
const PRO = planNameEs('pro');
const m = (tier: 'starter' | 'pro') => priceLabel(tier, 'monthly');
const y = (tier: 'starter' | 'pro') => priceLabel(tier, 'annual');

export const PRICING_PATH_ES = '/es/pricing';

/** Under 60 characters, absolute (the site template does not add a second "Holler"). */
export const PRICING_TITLE_ES = t(L, 'pricing.meta.title', { solo: SOLO, soloPrice: m('starter'), pro: PRO, proPrice: m('pro') });
/** 120 to 160 characters. */
export const PRICING_DESCRIPTION_ES = t(L, 'pricing.meta.desc', { soloLine: namedPlanPricesEs('starter'), proLine: namedPlanPricesEs('pro'), trial: trialPhraseEs() });

export const PRICING_INTRO_ES = t(L, 'pricing.intro');

const zips = (n: number) => t(L, n === 1 ? 'pricing.cell.zip_one' : 'pricing.cell.zip_many', { n });

/** [label, Plan Solo, Plan Pro], the same rows as COMPARISON. */
export const COMPARISON_ES: [string, string, string][] = [
  [t(L, 'pricing.row.monthly'), m('starter'), m('pro')],
  [t(L, 'pricing.row.yearly'), y('starter'), y('pro')],
  [t(L, 'pricing.row.areas'), zips(S.areas), zips(P.areas)],
  [t(L, 'pricing.row.trades'), t(L, 'pricing.cell.up_to', { n: S.trades }), t(L, 'pricing.cell.up_to', { n: P.trades })],
  [t(L, 'pricing.row.keywords'), t(L, 'pricing.cell.none'), t(L, 'pricing.cell.up_to', { n: P.keywords })],
  [t(L, 'pricing.row.email'), t(L, 'pricing.cell.yes'), t(L, 'pricing.cell.yes')],
  [t(L, 'pricing.row.feed'), t(L, 'pricing.cell.yes'), t(L, 'pricing.cell.yes')],
  [t(L, 'pricing.row.replies'), t(L, 'pricing.cell.yes'), t(L, 'pricing.cell.yes')],
];

/** The billing questions, in the same order as PRICING_FAQ. */
export const PRICING_FAQ_ES: { q: string; a: string }[] = [
  { q: t(L, 'pricing.faq.q1'), a: t(L, 'pricing.faq.a1', { days: TRIAL_DAYS, solo: SOLO, trades: S.trades }) },
  { q: t(L, 'pricing.faq.q2'), a: t(L, 'pricing.faq.a2') },
  { q: t(L, 'pricing.faq.q3'), a: t(L, 'pricing.faq.a3') },
  { q: t(L, 'pricing.faq.q4', { solo: SOLO, pro: PRO }), a: t(L, 'pricing.faq.a4', { solo: SOLO, pro: PRO, trades: S.trades }) },
  { q: t(L, 'pricing.faq.q5'), a: t(L, 'pricing.faq.a5') },
  { q: t(L, 'pricing.faq.q6'), a: t(L, 'pricing.faq.a6', { pro: PRO, n: P.keywords }) },
];

/** The yearly saving line (yearlyNote in English). Every percent computed from the cents. */
export function yearlyNoteEs(): string {
  const solo = annualSavingsPercent('starter');
  const pro = annualSavingsPercent('pro');
  if (solo >= 1 && solo === pro) return t(L, 'pricing.yearly_same', { pct: solo });
  if (solo >= 1 && pro >= 1) return t(L, 'pricing.yearly_both', { a: solo, b: pro, solo: SOLO, pro: PRO });
  if (solo >= 1) return t(L, 'pricing.yearly_one', { pct: solo, plan: SOLO });
  if (pro >= 1) return t(L, 'pricing.yearly_one', { pct: pro, plan: PRO });
  return '';
}

export const YEARLY_NOTE_ES = yearlyNoteEs();

/** SoftwareApplication with one Offer per plan, in Spanish (inLanguage es), pointing at /es/pricing. Same prices as pricingLd. */
export function pricingLdEs(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Holler',
    inLanguage: 'es',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: absoluteUrl('/es'),
    description: PRICING_DESCRIPTION_ES,
    offers: TIERS.map((tier) => ({
      '@type': 'Offer',
      name: `Holler ${planNameEs(tier)}`,
      description: planFeaturesEs(tier).join('. '),
      price: priceDecimal(tier, 'monthly'),
      priceCurrency: 'USD',
      url: absoluteUrl(PRICING_PATH_ES),
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', price: priceDecimal(tier, 'monthly'), priceCurrency: 'USD', billingDuration: 'P1M', unitCode: 'MON' },
        { '@type': 'UnitPriceSpecification', price: priceDecimal(tier, 'annual'), priceCurrency: 'USD', billingDuration: 'P1Y', unitCode: 'ANN' },
      ],
    })),
  };
}

/** FAQPage for the Spanish billing questions. */
export function pricingFaqLdEs(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'es',
    mainEntity: PRICING_FAQ_ES.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}
