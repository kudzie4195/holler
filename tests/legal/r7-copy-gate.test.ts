// Round 7 copy gate for the three legal pages, plus the rule that prices and the trial length are printed from constants, never typed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proseMetrics, renderLegal, src, type LegalPage } from './render-helper';

vi.mock('@/components/doc-page', async () => (await import('./render-helper')).docPageMock());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/plan/public-prices');
});

const PAGES: LegalPage[] = ['privacy', 'terms', 'delete-account'];
const FILES = ['app/privacy/page.tsx', 'app/terms/page.tsx', 'app/delete-account/page.tsx', 'lib/legal/pages.tsx'];

describe.each(PAGES)('%s copy gate', (page) => {
  it('meets the prose numbers as gates/prose_metrics.py measures them', async () => {
    const { html } = await renderLegal(page);
    const m = proseMetrics(html);
    expect(m.cv, `cv ${m.cv}`).toBeGreaterThanOrEqual(0.55);
    expect(m.under8, `under8 ${m.under8}`).toBeGreaterThanOrEqual(0.12);
    expect(m.mean, `mean ${m.mean}`).toBeGreaterThanOrEqual(12);
    expect(m.mean, `mean ${m.mean}`).toBeLessThanOrEqual(22);
  });

  it('has no em or en dash and no banned phrase', async () => {
    const { html, text } = await renderLegal(page);
    expect(html).not.toMatch(/[–—]|&mdash;|&ndash;/);
    expect(text).not.toMatch(/\b(delve|robust|seamless|elevate|unlock|empower|journey|landscape|leverage)\b/i);
    expect(text).not.toMatch(/not only|more than just|it's worth noting|whether you're/i);
  });
});

describe('prices and trial length come from constants', () => {
  it('no price literal and no trial-length literal in the page sources', () => {
    for (const f of FILES) {
      const code = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
      // The liability cap ($100) is a legal amount, not a plan price; it is the only dollar figure allowed.
      const dollars = [...code.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]).filter((d) => d !== '$100');
      expect(dollars, f).toEqual([]);
      expect(code, f).not.toMatch(/\b\d+[- ]day (free )?trial|\btrial (lasts|is) \d+|\b\d+ days free\b/i);
      expect(code, f).not.toMatch(/\b(7|14)-day\b/);
    }
    // The cap is still where it was.
    expect(src('app/terms/page.tsx')).toContain('in the 12 months before the claim, or $100.');
  });

  it('terms print whatever the price module says', async () => {
    vi.doMock('@/lib/plan/public-prices', async (orig) => {
      const real = (await orig()) as typeof import('@/lib/plan/public-prices');
      const fake = (name: string, m: string, y: string) => ({
        name,
        monthly: { displayLong: `${m} a month` },
        annual: { displayLong: `${y} a year` },
        limits: { trades: 9 },
      });
      return {
        ...real,
        TRIAL_DAYS: 21,
        PUBLIC_PRICES: { ...real.PUBLIC_PRICES, trialDays: 21, trialPhrase: '21-day free trial', plans: { solo: fake('Alpha', '$1.11', '$11.11'), pro: fake('Beta', '$2.22', '$22.22') } },
      };
    });
    const { text } = await renderLegal('terms');
    expect(text).toContain('Alpha: $1.11 a month, or $11.11 a year.');
    expect(text).toContain('Beta: $2.22 a month, or $22.22 a year.');
    expect(text).toContain('A new account gets a 21-day free trial');
    expect(text).toContain('The trial has the same limits as Alpha.');
    expect(text).toContain('any trades beyond 9');
    expect(text).not.toMatch(/\$7\.99|\$79\.99|\$13\.99|\$139\.99|\bSolo\b|14-day free trial|60-day free trial/);
    const priv = await renderLegal('privacy');
    expect(priv.text).toContain('your plan (Alpha or Beta)');
    expect(priv.text).not.toMatch(/\bSolo\b|\bStarter\b/);
  });
});
