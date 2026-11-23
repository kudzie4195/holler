// REV2 probe 25 (r18 TRIAL, commit ef745e4): every email that mentions the trial or a price, and the dynamic blocks the prerender scan
// (probe 24) cannot see (the /check CTA in English and Spanish, the pricing cards, the home pricing band). In each one: no "months free"
// phrase together with a yearly price, no 14-day trial, and the trial stated as TRIAL_DAYS days.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderWelcome, renderVerifyEmail } from '../../lib/email/templates';
import { renderConfirmEmailOnly } from '../../lib/mobile/verify-email';
import { renderTrialEnded, renderTrialEnding, renderWelcomeMatches, renderWelcomeQuiet, TRIAL_ENDING_SUBJECT } from '../../lib/lifecycle/templates';
import { Pricing } from '../../components/pricing';
import { PricingBand } from '../../components/home/pricing-band';
import { t } from '../../lib/i18n';
import { TRIAL_DAYS, TRIAL_HEADLINE, TRIAL_PHRASE, FROM_MONTHLY, FROM_YEARLY, cityCtaLabel, stormCtaLabel } from '../../lib/plan/price-copy';
import { PUBLIC_PRICES } from '../../lib/plan/public-prices';
import { configBody } from '../../lib/mobile/config';

const MONTHS = /(months?\s+free|meses\s+gratis|free\s+months?)/i;
const YEARLY = /(\$\s?\d[\d,.]*\s*(a|per|\/)\s*(year|yr)\b|al\s+a(ñ|n)o|\byearly\b|\bannual|\banual|save \d+%)/i;
const T14 = /(14[\s -]*(day|days|d[ií]as)|two\s+weeks|dos\s+semanas)/i;
const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ');
const common = { businessName: 'Acme Roofing', feedUrl: 'https://x.test/app', plansUrl: 'https://x.test/app/settings#billing-h', unsubscribeUrl: 'https://x.test/u' };
const item = { title: 'Roof permit', city: 'Chicago', state: 'IL', occurredAt: '2026-11-20T00:00:00Z', kind: 'permit' } as never;

describe('REV2 emails', () => {
  const mails: [string, { subject: string; html: string; text: string }][] = [
    ['welcome (signup)', renderWelcome({ businessName: 'Acme', appUrl: 'https://x.test/app' })],
    ['verify', renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' })],
    ['confirm only (returning member)', renderConfirmEmailOnly({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' })],
    ['lifecycle welcome, matches', renderWelcomeMatches({ ...common, total: 3, items: [item, item, item] })],
    ['lifecycle welcome, quiet', renderWelcomeQuiet({ ...common, lines: [{ label: 'building permits', count: 12 }], total: 12, days: 90 })],
    ['trial ending, alerts', renderTrialEnding({ ...common, items: [item] })],
    ['trial ending, none', renderTrialEnding({ ...common, items: [] })],
    ['trial ended, missed', renderTrialEnded({ ...common, missed: 4 })],
    ['trial ended, none', renderTrialEnded({ ...common, missed: 0 })],
  ];
  it('no email holds a months-free phrase and a yearly price together; none says 14 days; day counts say TRIAL_DAYS', () => {
    const report: string[] = [];
    for (const [name, m] of mails) {
      for (const body of [m.subject + ' ' + strip(m.html), m.subject + ' ' + m.text]) {
        expect(MONTHS.test(body) && YEARLY.test(body), name).toBe(false);
        expect(T14.test(body), name).toBe(false);
        for (const d of body.matchAll(/(\d+)-day free trial/g)) expect(Number(d[1]), name).toBe(TRIAL_DAYS);
      }
      report.push(`${name}: months-free=${MONTHS.test(m.text)} yearly=${YEARLY.test(m.text)} "${(m.text.match(/[^.\n]*trial[^.\n]*\./i) ?? [''])[0].trim()}"`);
    }
    console.log(report.join('\n'));
    expect(TRIAL_ENDING_SUBJECT).toBe('Your trial ends in 3 days');
    // the returning-member confirmation promises no trial at all
    expect(/trial/i.test(mails[2][1].text)).toBe(false);
    // the two emails that name a yearly price never use the months headline
    expect(YEARLY.test(mails[5][1].text)).toBe(true);
    expect(MONTHS.test(mails[5][1].text)).toBe(false);
  });
});

describe('REV2 dynamic blocks', () => {
  it('pricing cards (full and short), per card: yearly price present, months-free absent', () => {
    for (const variant of ['full', 'short'] as const) {
      const html = renderToStaticMarkup(Pricing({ variant }));
      const cards = html.split(/<li\b/).slice(1).map(strip).filter((c) => /\$\d/.test(c));
      expect(cards.length).toBeGreaterThanOrEqual(2);
      for (const c of cards) { expect(YEARLY.test(c)).toBe(true); expect(MONTHS.test(c)).toBe(false); expect(T14.test(c)).toBe(false); }
      expect(MONTHS.test(strip(html))).toBe(false); // nowhere in the whole component
    }
  });
  it('home pricing band (heading + cards in one section): precise form only', () => {
    const txt = strip(renderToStaticMarkup(createElement(PricingBand)));
    expect(YEARLY.test(txt)).toBe(true);
    expect(MONTHS.test(txt)).toBe(false);
    expect(txt).toContain('30-day free trial. Then a flat monthly price.');
  });
  it('/check CTA box, English and Spanish, built exactly as components/check-results.tsx builds it', () => {
    const up = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const en = `Get these by email. ${up(TRIAL_PHRASE)}, no card` + ' ' + `Then from ${FROM_MONTHLY} a month or ${FROM_YEARLY} a year. Holler never posts for you.`;
    const es = t('es', 'chk.cta.btn', { trial: up(t('es', 'land.trial_precise', { days: TRIAL_DAYS })) }) + ' ' + t('es', 'chk.cta.then', { monthly: FROM_MONTHLY, yearly: FROM_YEARLY });
    for (const s of [en, es]) { expect(YEARLY.test(s)).toBe(true); expect(MONTHS.test(s)).toBe(false); }
    expect(es).toContain('Prueba gratis de 30 días, sin tarjeta');
    // and the source really uses those keys (not the headline) in that box
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('node:fs').readFileSync('components/check-results.tsx', 'utf8') as string;
    const box = src.slice(src.indexOf('function Cta('), src.indexOf('function Cta(') + 1400);
    expect(box).toContain('TRIAL_PHRASE');
    expect(box).toContain("'land.trial_precise'");
    expect(/TRIAL_HEADLINE|'land\.trial'/.test(box)).toBe(false);
  });
  it('Spanish home: price section is precise; the hero (no yearly price in that section) keeps the month headline', () => {
    const priceSection = t('es', 'price.h', { trial: 'Prueba gratis de 30 días' }) + ' ' + t('es', 'price.line', { starter: 'Solo', pro: 'Pro', a: '$7.99', b: '$79.99', c: '$13.99', d: '$139.99' });
    expect(YEARLY.test(priceSection)).toBe(true);
    expect(MONTHS.test(priceSection)).toBe(false);
    const hero = t('es', 'hero.price', { from: FROM_MONTHLY, trial: t('es', 'land.trial_one', { months: 1 }) });
    expect(hero).toBe('Desde $7.99/mes después de 1 mes gratis. Sin tarjeta.');
    expect(YEARLY.test(hero)).toBe(false);
  });
  it('CTA labels and the mobile config: headline never with a yearly price; config carries TRIAL_DAYS / both phrases', () => {
    for (const s of [cityCtaLabel('Chicago'), stormCtaLabel()]) { expect(MONTHS.test(s)).toBe(true); expect(YEARLY.test(s)).toBe(false); }
    expect(TRIAL_HEADLINE).toBe('1 month free');
    expect(PUBLIC_PRICES.trialPeriod).toBe('P30D');
    const cfg = JSON.stringify(configBody('https://x.test', null));
    expect(cfg).toContain('"trialDays":30');
    expect(T14.test(cfg)).toBe(false);
  });
});
