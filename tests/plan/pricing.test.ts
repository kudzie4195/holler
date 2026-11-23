// Prices, display strings, the Pricing component and the /pricing page. All inputs are this repo's own constants (no external data).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_PRICE_CENTS,
  ANNUAL_SAVINGS_PERCENT,
  MONTHLY_PRICE_CENTS,
  PLAN_COPY,
  PRICES_CENTS,
  annualSavingsPercent,
  formatUsd,
  annualSavingLabel,
  priceDecimal,
  priceLabel,
} from '@/lib/stripe/plans';
import { TIER_NAMES, TIERS } from '@/lib/plan/limits';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { PRICE_CENTS } from '@/lib/stripe';
import { Pricing } from '@/components/pricing';
import PricingPage, { metadata } from '@/app/pricing/page';
import { COMPARISON, PRICING_DESCRIPTION, PRICING_FAQ, PRICING_TITLE, YEARLY_NOTE, pricingLd } from '@/lib/plan/pricing-page';
import { PLAN_FEATURES } from '@/lib/plan/copy';

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape',
  'realm', 'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];

describe('prices: one source of truth in cents', () => {
  it('Solo (id starter) 799 / 7999, Pro 1399 / 13999', () => {
    expect(PRICES_CENTS).toEqual({ starter: { monthly: 799, annual: 7999 }, pro: { monthly: 1399, annual: 13999 } });
    expect(MONTHLY_PRICE_CENTS).toBe(799);
    expect(ANNUAL_PRICE_CENTS).toBe(7999);
    expect(PRICE_CENTS).toBe(799);
  });
  it('display names: the internal id stays starter, the name shown is Solo', () => {
    expect(TIER_NAMES).toEqual({ starter: 'Solo', pro: 'Pro' });
    expect(TIERS).toEqual(['starter', 'pro']);
  });
  it('display strings derive from the cents', () => {
    expect(formatUsd(799)).toBe('$7.99');
    expect(formatUsd(1399)).toBe('$13.99');
    expect(formatUsd(7999)).toBe('$79.99');
    expect(formatUsd(13999)).toBe('$139.99');
    expect(formatUsd(1000)).toBe('$10');
    expect(formatUsd(1005)).toBe('$10.05');
    expect([priceLabel('starter', 'monthly'), priceLabel('starter', 'annual'), priceLabel('pro', 'monthly'), priceLabel('pro', 'annual')]).toEqual(['$7.99', '$79.99', '$13.99', '$139.99']);
    expect(PLAN_COPY.monthly.price).toBe('$7.99');
    expect(PLAN_COPY.annual.price).toBe('$79.99');
    expect(priceDecimal('pro', 'monthly')).toBe('13.99');
    expect(priceDecimal('pro', 'annual')).toBe('139.99');
  });
  it('yearly saving: a percent phrase on both plans, computed and rounded down (16.6% each)', () => {
    expect(annualSavingLabel('starter')).toBe('save 16%');
    expect(annualSavingLabel('pro')).toBe('save 16%');
    expect(annualSavingsPercent('starter')).toBe(16); // (95.88 - 79.99) / 95.88 = 16.6
    expect(annualSavingsPercent('pro')).toBe(16); // (167.88 - 139.99) / 167.88 = 16.6
    expect(ANNUAL_SAVINGS_PERCENT).toBe(16);
    expect(YEARLY_NOTE).toBe('Pay yearly on either plan and you save 16%.');
  });
});

describe('Pricing component', () => {
  const html = renderToStaticMarkup(createElement(Pricing));
  const text = textOf(html);
  it('renders both plans with monthly and yearly prices', () => {
    for (const s of ['Solo', 'Pro', '$7.99', '$79.99', '$13.99', '$139.99', 'a month', 'a year', 'save 16%']) expect(text).toContain(s);
    expect(text).not.toContain('Starter');
  });
  it('lists what each plan includes and the free trial line', () => {
    for (const f of [...PLAN_FEATURES.starter, ...PLAN_FEATURES.pro]) expect(text).toContain(f);
    expect(text).toContain(`Every plan starts with a ${TRIAL_DAYS}-day free trial. No card needed.`);
    expect(TRIAL_DAYS).toBe(60);
    expect(text).toContain('Every plan starts with a 60-day free trial. No card needed.');
    expect(text).toContain('The trial uses Solo limits. Move to Pro in Settings, or cancel, any time.');
  });
  it('links to /signup', () => {
    expect(html.match(/href="\/signup"/g)?.length).toBe(2);
  });
  it('takes no props and has no em dash or banned word', () => {
    expect(Pricing.length).toBe(0);
    expect(text).not.toContain('—');
    for (const w of BANNED) expect(text.toLowerCase()).not.toContain(w);
  });
});

describe('/pricing page', () => {
  const html = renderToStaticMarkup(createElement(PricingPage));
  const text = textOf(html);

  it('has one h1, the plan cards, a comparison table and 4 to 6 billing questions', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(text).toContain('Holler pricing');
    expect(html).toContain('<table');
    expect(html.match(/<tr/g)!.length).toBe(COMPARISON.length + 1);
    expect(PRICING_FAQ.length).toBeGreaterThanOrEqual(4);
    expect(PRICING_FAQ.length).toBeLessThanOrEqual(6);
    for (const f of PRICING_FAQ) {
      expect(text).toContain(f.q);
      expect(text).toContain(f.a);
    }
    const qs = PRICING_FAQ.map((f) => f.q).join(' ');
    expect(qs).toMatch(/cancel/i);
    expect(qs).toMatch(/trial ends/i);
    expect(qs).toMatch(/switch/i);
    expect(qs).toMatch(/refund/i);
  });

  it('review r2: the trial-end answer limits the delayed first charge to the website and says app purchases are charged at once', () => {
    const a = PRICING_FAQ.find((f) => /trial ends/i.test(f.q))!.a;
    expect(a).toContain('if you subscribe on the website during the trial, the first charge comes when it ends.');
    expect(a).toContain('A plan you buy in the app is charged by Apple or Google when you buy it.');
    expect(a).not.toMatch(/[\u2013\u2014]/);
    expect(text).toContain(a);
  });

  it('review r2: the store trial comment names the real period', () => {
    const src = readFileSync(path.resolve(__dirname, '../../lib/plan/public-prices.ts'), 'utf8');
    expect(src).not.toContain('"P7D"');
  });

  it('comparison table prices come from the constants', () => {
    expect(COMPARISON[0]).toEqual(['Monthly price', priceLabel('starter', 'monthly'), priceLabel('pro', 'monthly')]);
    expect(COMPARISON[1]).toEqual(['Yearly price', priceLabel('starter', 'annual'), priceLabel('pro', 'annual')]);
  });

  it('refund answer promises nothing beyond app/terms/page.tsx', () => {
    const terms = readFileSync(path.resolve(__dirname, '../../app/terms/page.tsx'), 'utf8');
    const flat = terms.replace(/\s+/g, ' ');
    // Phrases the FAQ restates, each present in the terms as written by their owner.
    for (const s of ['Payments are final.', 'We do not refund or credit part of a month or year, except where the law requires it or a plan change is prorated.', 'Cancelling stops the next charge.', 'Your plan stays on until the end of the period you already paid for.', 'Stripe prorates the change.', 'We never charge you just because a trial ended.']) {
      expect(flat).toContain(s);
    }
    const refund = PRICING_FAQ.find((f) => /refund/i.test(f.q))!.a;
    expect(refund).toContain('Payments are final.');
    expect(refund).toContain('except where the law requires it or a plan change is prorated');
    expect(refund).not.toMatch(/money.back guarantee|full refund|refund within|days to request/i);
  });

  it('metadata: title, description with prices, canonical /pricing', () => {
    expect(metadata.title).toEqual({ absolute: PRICING_TITLE });
    expect(String(metadata.description)).toContain('$13.99');
    expect(String(metadata.description)).toContain('$7.99');
    expect(metadata.alternates?.canonical).toBe('/pricing');
    // Specific title, description 120 to 160 characters, and share data that point at /pricing (not the home page).
    expect(PRICING_TITLE).toBe('Holler Pricing: Solo $7.99 and Pro $13.99 a Month');
    expect(PRICING_TITLE.length).toBeLessThan(60);
    expect(PRICING_DESCRIPTION.length).toBeGreaterThanOrEqual(120);
    expect(PRICING_DESCRIPTION.length).toBeLessThanOrEqual(160);
    const og = metadata.openGraph as { title?: string; description?: string; url?: string; siteName?: string; type?: string; images?: unknown[] };
    expect(og.title).toBe(PRICING_TITLE);
    expect(og.description).toBe(PRICING_DESCRIPTION);
    expect(String(og.url)).toMatch(/\/pricing$/);
    expect(og.siteName).toBe('Holler');
    expect(og.type).toBe('website');
    expect(og.images).toHaveLength(1);
    expect((metadata.twitter as { card?: string; title?: string }).card).toBe('summary_large_image');
  });

  it('JSON-LD is valid JSON with a SoftwareApplication carrying two Offers priced from the constants, plus the FAQ', () => {
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const data = JSON.parse(scripts[0]) as Record<string, unknown>[];
    const app = data.find((d) => d['@type'] === 'SoftwareApplication') as { offers: Record<string, unknown>[] };
    expect(app).toBeTruthy();
    expect(app.offers).toHaveLength(2);
    expect(app.offers.map((o) => [o['@type'], o.price, o.priceCurrency])).toEqual([
      ['Offer', (PRICES_CENTS.starter.monthly / 100).toFixed(2), 'USD'],
      ['Offer', (PRICES_CENTS.pro.monthly / 100).toFixed(2), 'USD'],
    ]);
    const specs = app.offers.map((o) => (o.priceSpecification as { price: string; billingDuration: string }[]).map((s) => `${s.price}/${s.billingDuration}`));
    expect(specs).toEqual([['7.99/P1M', '79.99/P1Y'], ['13.99/P1M', '139.99/P1Y']]);
    expect(app.offers.map((o) => o.name)).toEqual(['Holler Solo', 'Holler Pro']);
    const faq = data.find((d) => d['@type'] === 'FAQPage') as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(PRICING_FAQ.length);
    expect(pricingLd()['@context']).toBe('https://schema.org');
  });

  it('copy rules: no em dash, no banned words, sentence lengths mixed', () => {
    expect(text).not.toContain('—');
    for (const w of BANNED) expect(text.toLowerCase()).not.toContain(w);
    expect(text).not.toMatch(/whether you're|not just/i);
    // Sentences of the page's own prose (intro, cards, FAQ), the same kind the build script measures.
    const prose = [...PRICING_FAQ.flatMap((f) => [f.a]), ...textOf(renderToStaticMarkup(createElement(Pricing))).split(/(?<=[.!?])\s+/)].join(' ');
    const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
    const lens = sentences.map((s) => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    expect(mean).toBeLessThanOrEqual(22);
    expect(lens.filter((n) => n < 8).length / lens.length).toBeGreaterThanOrEqual(0.12);
    expect(sd / mean).toBeGreaterThanOrEqual(0.55);
  });
});
