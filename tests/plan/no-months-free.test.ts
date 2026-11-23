// Owner decisions: the free trial is 30 days, shown as "1 month free" (headline) or "30-day free trial" (precise), both built from
// TRIAL_DAYS (round 23; it was 60 in round 18 and 14 before that). The yearly saving is ALWAYS a percent ("save 16%"), never "months free", so the two are never
// confused. So "months free" may appear ONLY as the trial phrase generated from the constants, and never next to a yearly price.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { Pricing } from '@/components/pricing';
import { PRICING_FAQ, YEARLY_NOTE, PRICING_DESCRIPTION } from '@/lib/plan/pricing-page';
import { TRIAL_HEADLINE, TRIAL_HEADLINE_KEY, TRIAL_MONTHS, TRIAL_PHRASE, cityCtaLabel, stormCtaLabel } from '@/lib/plan/price-copy';
import { PUBLIC_PRICES } from '@/lib/plan/public-prices';
import { TRADE_PRICE_LINE } from '@/lib/seo/trade-view';
import { annualSavingLabel, annualSavingSentence } from '@/lib/stripe/plans';
import { t } from '@/lib/i18n';
import { PricingBand } from '@/components/home/pricing-band';
import { CheckResults } from '@/components/check-results';
import { watchList } from '@/lib/check/watch';
import HomeEs from '@/app/es/page';

const root = path.resolve(__dirname, '../..');
const BANNED = /\bmonths?\s+free\b|\bfree\s+months?\b/i;
const BANNED_ES = /\bmes(es)?\s+gratis\b|\bgratis\s+(por|durante)\s+\S+\s+mes(es)?\b/i;
/** Any "N months free" with a yearly word in the same sentence: the old "about 2 months free" yearly-saving wording, in any form. */
const YEARLY_AND_MONTHS = /\b(year|yearly|annual|annually|año|anual)\b[^.!?]*\bmonths?\s+free\b|\bmonths?\s+free\b[^.!?]*\b(year|yearly|annual|annually|año|anual)\b/i;
const SCAN_DIRS = ['app', 'components', 'lib', 'emails', 'mobile/src', 'mobile/store', 'public'];
const SCAN_FILES = ['LAUNCH.md', 'README.md', 'SPEC.md', 'mobile/STORE-SETUP.md'];
const TEXT_EXT = /\.(tsx?|mjs|js|json|md|txt|html|xml|svg|css|py)$/;
const SKIP = new Set(['node_modules', '.next', '.git', '.gen', 'screenshots']);
/**
 * The only source lines allowed to hold "months free" / "meses gratis": the i18n headline template, filled with TRIAL_MONTHS
 * (app/es/page.tsx, components/check-results.tsx). lib/plan/price-copy.ts builds TRIAL_HEADLINE without typing the phrase.
 */
const ALLOWED_LINES: { file: string; line: RegExp }[] = [
  { file: 'lib/i18n/en.ts', line: /^\s*'land\.trial': '\{months\} months free',$/ },
  { file: 'lib/i18n/es.ts', line: /^\s*'land\.trial': '\{months\} meses gratis',$/ },
  // Round 23: the trial is one month, so each language also carries the singular template (price-copy.ts TRIAL_HEADLINE_KEY picks).
  { file: 'lib/i18n/en.ts', line: /^\s*'land\.trial_one': '\{months\} month free',$/ },
  { file: 'lib/i18n/es.ts', line: /^\s*'land\.trial_one': '\{months\} mes gratis',$/ },
];

function walk(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(n)) out.push(p);
  }
  return out;
}

/** Text nodes of rendered HTML: a button or a line is judged on its own, not glued to the price next to it. */
function textNodes(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Every "months free" in s is exactly the generated headline (never "about 2 months free", never another number). */
function onlyTheTrialHeadline(s: string): boolean {
  for (const m of s.matchAll(/(\w+\s+)?(\w+\s+months?\s+free)\b/gi)) {
    if (m[2] !== TRIAL_HEADLINE) return false;
    if (m[1] && /^about$/i.test(m[1].trim())) return false;
  }
  return true;
}

describe('"months free" only as the generated trial phrase', () => {
  it('no source, doc, email, store listing or public file types "months free" / "meses gratis", except the i18n headline template', () => {
    const files = [...SCAN_DIRS.flatMap((d) => walk(path.join(root, d))), ...SCAN_FILES.map((f) => path.join(root, f))];
    const hits: string[] = [];
    for (const f of files) {
      let text = '';
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      const rel = path.relative(root, f);
      text.split('\n').forEach((line, i) => {
        if (!BANNED.test(line) && !BANNED_ES.test(line)) return;
        if (ALLOWED_LINES.some((a) => a.file === rel && a.line.test(line))) return;
        hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
    // The allow-list is not stale: both template lines exist.
    for (const a of ALLOWED_LINES) expect(readFileSync(path.join(root, a.file), 'utf8').split('\n').some((l) => a.line.test(l)), a.file).toBe(true);
  });

  it('the yearly saving is a percent everywhere and never "months free" (the old "about 2 months free" guard)', () => {
    const yearly = [annualSavingLabel('starter'), annualSavingLabel('pro'), annualSavingSentence('starter'), annualSavingSentence('pro'), YEARLY_NOTE];
    for (const s of yearly) {
      expect(s).not.toMatch(BANNED);
      expect(s).not.toMatch(BANNED_ES);
    }
    expect(annualSavingLabel('starter')).toMatch(/^save \d+%$/);
    expect(annualSavingLabel('pro')).toMatch(/^save \d+%$/);
    expect(PUBLIC_PRICES.plans.solo.annualSaving).toBe('save 16%');
    expect(PUBLIC_PRICES.plans.pro.annualSaving).toBe('save 16%');
    expect(PUBLIC_PRICES.plans.solo.annualSaving).not.toMatch(BANNED);
    expect(PUBLIC_PRICES.plans.pro.annualSaving).not.toMatch(BANNED);
  });

  it('rendered pricing copy, FAQ, JSON payloads and CTAs: "months free" is only ever the trial headline, and never in a sentence about the year', () => {
    const strings = [
      ...PRICING_FAQ.flatMap((f) => [f.q, f.a]),
      PRICING_DESCRIPTION,
      TRADE_PRICE_LINE,
      ...textNodes(renderToStaticMarkup(createElement(Pricing))),
      ...textNodes(renderToStaticMarkup(createElement(Pricing as FC<{ variant?: 'short' | 'full' }>, { variant: 'short' }))),
      JSON.stringify(PUBLIC_PRICES),
      cityCtaLabel('Austin'),
      stormCtaLabel(),
    ];
    for (const s of strings) {
      expect(onlyTheTrialHeadline(s), s).toBe(true);
      expect(s, s).not.toMatch(YEARLY_AND_MONTHS);
      expect(s, s).not.toMatch(/about\s+\S+\s+months?\s+free/i);
    }
    // The headline really is used, and only where it means the trial.
    expect(cityCtaLabel('Austin')).toBe('Get alerts for Austin from $7.99/mo, 1 month free');
    expect(stormCtaLabel()).toBe('Get alerts from $7.99/mo, 1 month free');
    // Next to a yearly price, the precise form is used instead (trade pages): no "months free" there.
    expect(TRADE_PRICE_LINE).toContain('$79.99 a year');
    expect(TRADE_PRICE_LINE).toContain('30-day free trial');
    expect(TRADE_PRICE_LINE).not.toMatch(BANNED);
  });

  it('the banned-phrase patterns catch the variants', () => {
    for (const s of ['about 2 months free', '1 month free', 'Months Free', 'two free months']) expect(s).toMatch(BANNED);
    for (const s of ['2 meses gratis', '1 mes gratis', 'gratis por dos meses']) expect(s).toMatch(BANNED_ES);
    expect('Pay yearly, about 2 months free').toMatch(YEARLY_AND_MONTHS);
    expect('2 months free when you pay annually').toMatch(YEARLY_AND_MONTHS);
    expect(onlyTheTrialHeadline('pay yearly and get about 2 months free')).toBe(false);
    expect(onlyTheTrialHeadline('3 months free')).toBe(false);
    expect(onlyTheTrialHeadline('From $7.99/mo after 1 month free. No card.')).toBe(true);
    expect(`Every plan starts with a ${TRIAL_PHRASE}. No card needed.`).not.toMatch(BANNED);
  });
});

describe('the 30-day trial wording (round 23) comes from TRIAL_DAYS', () => {
  it('TRIAL_DAYS is 30, a whole number of 30-day months, and both phrases are built from it', () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(TRIAL_DAYS % 30).toBe(0);
    expect(TRIAL_MONTHS).toBe(1);
    expect(TRIAL_HEADLINE).toBe('1 month free');
    expect(TRIAL_PHRASE).toBe('30-day free trial');
    expect(PUBLIC_PRICES.trialDays).toBe(30);
    expect(PUBLIC_PRICES.trialHeadline).toBe(TRIAL_HEADLINE);
    expect(PUBLIC_PRICES.trialPhrase).toBe(TRIAL_PHRASE);
  });

  it('Spanish: "1 mes gratis" and "prueba gratis de 30 días", filled from the same constants', () => {
    expect(t('es', TRIAL_HEADLINE_KEY, { months: TRIAL_MONTHS })).toBe('1 mes gratis');
    expect(t('es', 'land.description', { from: '$7.99', days: TRIAL_DAYS })).toContain('prueba gratis de 30 días');
    expect(t('en', TRIAL_HEADLINE_KEY, { months: TRIAL_MONTHS })).toBe(TRIAL_HEADLINE);
    expect(t('en', 'land.description', { from: '$7.99', days: TRIAL_DAYS })).toContain(`a ${TRIAL_PHRASE}`);
  });

  it('pricing fine print and the Solo button use the precise form (the card shows a yearly price)', () => {
    const text = renderToStaticMarkup(createElement(Pricing)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Every plan starts with a 30-day free trial. No card needed.');
    expect(text).toContain('Start your 30-day free trial');
    expect(text).not.toMatch(BANNED);
    expect(text).toContain('The trial uses Solo limits. Move to Pro in Settings, or cancel, any time.');
    expect(text).not.toMatch(/\b14[- ]day|\b14 days|\b60[- ]day|\b60 days/);
  });
});

// Review r18 TRIAL F2: a button or a line is never judged alone. In any rendered card, CTA box or page section that shows a yearly price,
// the trial must be in its precise form ("60-day free trial" / "prueba gratis de 60 días"), never the 2-month headline.
// No \b after "año": ñ is not a word character in JS regexes.
const YEARLY = /\ba year\b|\/yr\b|\bper year\b|\byearly\b|\bannual\b|\bal año|\/año|\banual\b/i;
const HEADLINE_ANY = /\bmonths?\s+free\b|\bmes(es)?\s+gratis\b/i;
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** Whole cards (every <li>) and whole sections or articles: each block with everything nested inside it. */
function blocks(html: string): string[] {
  const out: string[] = [];
  for (const tag of ['li', 'section', 'article']) {
    const re = new RegExp(`<${tag}[\\s>]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      // the block runs to its own closing tag, counting nested tags of the same name
      let depth = 0;
      const tagRe = new RegExp(`<(/?)${tag}[\\s>]`, 'g');
      tagRe.lastIndex = m.index;
      let t: RegExpExecArray | null;
      let end = html.length;
      while ((t = tagRe.exec(html))) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) {
          end = t.index;
          break;
        }
      }
      out.push(plain(html.slice(m.index, end)));
    }
  }
  return out.filter(Boolean);
}
/** The blocks that show a yearly price and also the 2-month headline: must be none. */
function offending(html: string): string[] {
  return blocks(html).filter((b) => YEARLY.test(b) && HEADLINE_ANY.test(b));
}

describe('never the 2-month headline in a card or block with a yearly price (review F2)', () => {
  it('the block splitter finds a headline next to a yearly price inside one card (so the check below can fail)', () => {
    const bad = '<ul><li class="rounded-card"><p>$79.99 a year, save 16%</p><a>Try 2 months free</a></li><li class="rounded-card"><p>$7.99 a month</p><a>2 months free</a></li></ul>';
    expect(offending(bad)).toEqual(['$79.99 a year, save 16% Try 2 months free']);
    expect(offending('<main><section><h2>2 meses gratis</h2><p>$7.99 al mes o $79.99 al año</p></section></main>')).toHaveLength(1);
  });

  it('/pricing cards (full and short): no card holds both', () => {
    for (const variant of ['full', 'short'] as const) {
      const html = renderToStaticMarkup(createElement(Pricing as FC<{ variant?: 'short' | 'full' }>, { variant }));
      const cards = html.split(/<li(?=[^>]*rounded-card)/).slice(1);
      expect(cards.length, variant).toBe(2);
      for (const c of cards) if (YEARLY.test(plain('<li' + c))) expect(plain('<li' + c), variant).not.toMatch(HEADLINE_ANY);
      expect(offending(html), variant).toEqual([]);
    }
  });

  it('home pricing band (heading beside the short cards with yearly prices): precise form', () => {
    const html = renderToStaticMarkup(createElement(PricingBand));
    expect(plain(html)).toMatch(YEARLY);
    expect(plain(html)).not.toMatch(HEADLINE_ANY);
    expect(plain(html)).toContain(`${TRIAL_PHRASE}. Then a flat monthly price.`);
  });

  it('/check CTA box (button above "Then from ... a year"), English and Spanish: precise form', () => {
    for (const lang of ['en', 'es'] as const) {
      for (const mode of ['limited', 'quiet', 'ok'] as const) {
        const html = renderToStaticMarkup(
          createElement(CheckResults, {
            items: [],
            mode,
            checkedAt: '2026-11-17T11:55:00.000Z',
            placeLabel: 'Absarokee, MT',
            trade: 'roofing',
            tradeLabel: 'Roofing',
            citySlug: null,
            watches: watchList('roofing', null),
            now: Date.UTC(2026, 10, 17, 12, 0),
            lang,
          } as Parameters<typeof CheckResults>[0]),
        );
        expect(plain(html), `${lang} ${mode}`).not.toMatch(HEADLINE_ANY);
        expect(offending(html), `${lang} ${mode}`).toEqual([]);
      }
    }
    const en = renderToStaticMarkup(createElement(CheckResults, { items: [], mode: 'limited', checkedAt: '2026-11-17T11:55:00.000Z', placeLabel: 'X', trade: 'roofing', tradeLabel: 'Roofing', citySlug: null, watches: watchList('roofing', null), now: Date.UTC(2026, 10, 17, 12, 0) } as Parameters<typeof CheckResults>[0]));
    expect(plain(en)).toContain('Get these by email. 30-day free trial, no card');
    const es = renderToStaticMarkup(createElement(CheckResults, { items: [], mode: 'limited', checkedAt: '2026-11-17T11:55:00.000Z', placeLabel: 'X', trade: 'roofing', tradeLabel: 'Roofing', citySlug: null, watches: watchList('roofing', null), now: Date.UTC(2026, 10, 17, 12, 0), lang: 'es' } as Parameters<typeof CheckResults>[0]));
    expect(plain(es)).toContain('Reciba estas alertas por correo. Prueba gratis de 30 días, sin tarjeta');
  });

  it('/es home: the price section uses "Prueba gratis de 30 días"; the hero (monthly price only) keeps "1 mes gratis"; no section holds both', () => {
    const html = renderToStaticMarkup(HomeEs());
    expect(offending(html)).toEqual([]);
    expect(plain(html)).toContain('Prueba gratis de 30 días. Luego, un precio mensual fijo.');
    expect(plain(html)).toContain('después de 1 mes gratis');
  });
});
