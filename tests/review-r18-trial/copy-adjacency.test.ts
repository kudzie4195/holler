// Regression tests from the r18 TRIAL review (probe 07); F2 fixed: the precise form in every block that shows a yearly price.
// Reviewer probe 07 (r18 TRIAL): is the 2-month headline ever shown next to a yearly price? The unit's own test judges each text node alone
// (tests/plan/no-months-free.test.ts textNodes: "a button or a line is judged on its own, not glued to the price next to it"), so it
// cannot see a button and a yearly price inside one card. This probe looks at whole cards and whole CTA boxes.
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pricing } from '../../components/pricing';
import { TRIAL_HEADLINE, TRIAL_PHRASE, cityCtaLabel, stormCtaLabel } from '../../lib/plan/price-copy';
import { annualSavingLabel, annualSavingsPercent, priceLabel } from '../../lib/stripe/plans';
import { PUBLIC_PRICES } from '../../lib/plan/public-prices';
import { PRICING_FAQ, PRICING_DESCRIPTION } from '../../lib/plan/pricing-page';
import { TRADE_PRICE_LINE } from '../../lib/seo/trade-view';
import { t } from '../../lib/i18n';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('REV copy: the 2-month headline and yearly prices', () => {
  it('constants', () => {
    expect(TRIAL_HEADLINE).toBe('1 month free');
    expect(TRIAL_PHRASE).toBe('30-day free trial');
    expect(annualSavingLabel('starter')).toBe('save 16%');
    expect(annualSavingLabel('pro')).toBe('save 16%');
    expect(PUBLIC_PRICES.trialPeriod).toBe('P30D');
  });

  it('the yearly saving is a percent, and 16% of a year IS about 2 months (why the two must not sit together)', () => {
    expect(annualSavingsPercent('starter')).toBe(16);
    expect(Math.round((annualSavingsPercent('starter') / 100) * 12)).toBe(2);
  });

  it('F2 fixed: on /pricing the Solo card holds the yearly price and "save 16%", and its button states the precise 30-day trial', () => {
    const html = renderToStaticMarkup(createElement(Pricing as FC<{ variant?: 'short' | 'full' }>, { variant: 'full' }));
    const cards = html.split(/<li(?=[^>]*rounded-card)/).slice(1).map((c) => text('<li' + c)); // one string per plan card, nested feature rows included
    const solo = cards.find((c) => c.includes(priceLabel('starter', 'annual')))!;
    expect(solo).toContain(`or ${priceLabel('starter', 'annual')} a year, save 16%`);
    expect(solo).toContain('Start your 30-day free trial');
    expect(solo).not.toMatch(/months free/);
    const pro = cards.find((c) => c.includes(priceLabel('pro', 'annual')))!;
    expect(pro).not.toMatch(/months free/); // the Pro card does not do it
  });

  it('home page (short cards): the cards themselves do not carry the headline', () => {
    const html = renderToStaticMarkup(createElement(Pricing as FC<{ variant?: 'short' | 'full' }>, { variant: 'short' }));
    expect(text(html)).not.toMatch(/months free/);
  });

  it('F2 (P3 part) fixed: the /check CTA box (button above the yearly price line) uses the precise form, English and Spanish', () => {
    const es = t('es', 'chk.cta.btn', { trial: 'Prueba gratis de 30 días' });
    expect(es).toBe('Reciba estas alertas por correo. Prueba gratis de 30 días, sin tarjeta');
    expect(t('es', 'land.trial_precise', { days: 30 })).toBe('prueba gratis de 30 días');
    expect(t('en', 'land.trial_precise', { days: 30 })).toBe(TRIAL_PHRASE);
  });

  it('single sentences that name a yearly price use the precise form (good)', () => {
    for (const s of [TRADE_PRICE_LINE, PRICING_DESCRIPTION, ...PRICING_FAQ.map((f) => `${f.q} ${f.a}`)]) {
      if (/year|annual/i.test(s)) expect(s, s).not.toMatch(/months? free/i);
    }
    expect(TRADE_PRICE_LINE).toContain('with a 30-day free trial');
    expect(cityCtaLabel('Austin')).toBe('Get alerts for Austin from $7.99/mo, 1 month free');
    expect(stormCtaLabel()).toBe('Get alerts from $7.99/mo, 1 month free');
  });

  it('Spanish: 1 mes gratis and prueba gratis de 30 días', () => {
    expect(t('es', 'land.trial_one', { months: 1 })).toBe('1 mes gratis');
    expect(t('es', 'land.description', { from: '$7.99', days: 30 })).toContain('prueba gratis de 30 días');
  });
});
