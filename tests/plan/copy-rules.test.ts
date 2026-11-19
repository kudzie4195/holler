// Copy rules (round 7 CONTEXT.md) measured on the /pricing page prose and the /faq page prose. The text is built from the same
// constants the pages render, one line per visible block (a list item or table row counts as its own sentence), then measured with
// the shared helper tests/seo/helpers/copy-metrics.ts. The numbers are printed with a COPYSTATS marker for the hand-back.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pricing } from '@/components/pricing';
import { COMPARISON, PRICING_FAQ, PRICING_INTRO, YEARLY_NOTE } from '@/lib/plan/pricing-page';
import { FAQ_GROUPS } from '@/lib/seo/faq';
import { bannedHits, copyStats, hasEmDash } from '../seo/helpers/copy-metrics';

/** Visible text of a rendered component, one line per block element, so list items stay separate sentences. */
function blockText(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<\/(p|li|h[1-6]|dt|dd|tr|a)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Paragraphs (<p>) of a rendered component: card blurbs, the trial line and the footnote. Price lines (data-price) are labels. */
function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p[\s>][\s\S]*?<\/p>/g)].filter((m) => !m[0].includes('data-price')).map((m) => blockText(m[0]).replace(/\n/g, ' '));
}

/**
 * Prose of /pricing: intro, the paragraphs of the plan cards, the yearly note, and every billing question and answer. Headings,
 * table cells, button labels and the feature bullets are labels, not sentences, so they are left out here and counted in pricingAll.
 */
export function pricingProse(): string {
  return [...PRICING_INTRO, ...paragraphs(renderToStaticMarkup(createElement(Pricing))), YEARLY_NOTE, ...PRICING_FAQ.flatMap((f) => [f.q, f.a])].join('\n');
}

/** Every visible block of /pricing, labels included (headings, bullets, table rows, buttons). Printed, not asserted. */
export function pricingAll(): string {
  return [
    'Holler pricing',
    ...PRICING_INTRO,
    blockText(renderToStaticMarkup(createElement(Pricing))),
    YEARLY_NOTE,
    ...COMPARISON.map((r) => r.join(' ')),
    'Billing questions',
    ...PRICING_FAQ.flatMap((f) => [f.q, f.a]),
  ].join('\n');
}

/** Prose of /faq: the intro line and every question and answer (group titles are headings). */
export function faqProse(): string {
  return [
    'Short answers about what Holler is, where the data comes from, what it costs and how resident requests work.',
    ...FAQ_GROUPS.flatMap((g) => g.items.flatMap((i) => [i.q, i.a])),
  ].join('\n');
}

/** The pricing-and-trial group of /faq alone (the part this round rewrites). Printed, not asserted. */
export function faqPricingGroup(): string {
  return FAQ_GROUPS.filter((g) => g.id === 'pricing-and-trial').flatMap((g) => g.items.flatMap((i) => [i.q, i.a])).join('\n');
}

const fmt = (t: string) => {
  const s = copyStats(t);
  return JSON.stringify({ sentences: s.sentences, mean: +s.mean.toFixed(2), shortShare: +s.shortShare.toFixed(3), cv: +s.cv.toFixed(3) });
};

it('prints the label-inclusive numbers for the hand-back', () => {
  console.log(`COPYSTATS pricing-all-blocks ${fmt(pricingAll())}`);
  console.log(`COPYSTATS faq-pricing-group ${fmt(faqPricingGroup())}`);
  expect(hasEmDash(pricingAll())).toBe(false);
});

const DASHES = /[–—]/;
const EXTRA_BANNED = /\bnot only\b|more than just|it's worth noting|whether you're/i;

describe.each([
  ['pricing', pricingProse],
  ['faq', faqProse],
])('copy rules: %s page', (name, build) => {
  const text = build();
  const s = copyStats(text);
  it('meets the sentence-length rules', () => {
    console.log(`COPYSTATS ${name}-prose ${fmt(text)}`);
    expect(s.mean).toBeGreaterThanOrEqual(12);
    expect(s.mean).toBeLessThanOrEqual(22);
    expect(s.shortShare).toBeGreaterThanOrEqual(0.12);
    expect(s.cv).toBeGreaterThanOrEqual(0.55);
  });
  it('has no em or en dash and no banned word', () => {
    expect(hasEmDash(text)).toBe(false);
    expect(text).not.toMatch(DASHES);
    expect(bannedHits(text)).toEqual([]);
    expect(text).not.toMatch(EXTRA_BANNED);
  });
});
