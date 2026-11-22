// Owner decision: Holler's only free offer is the 14-day free trial. The yearly saving is a percent, never "months free".
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { Pricing } from '@/components/pricing';
import { PRICING_FAQ, YEARLY_NOTE } from '@/lib/plan/pricing-page';
import { PUBLIC_PRICES } from '@/lib/plan/public-prices';
import { annualSavingLabel, annualSavingSentence } from '@/lib/stripe/plans';

const root = path.resolve(__dirname, '../..');
const BANNED = /\bmonths?\s+free\b|\bfree\s+months?\b/i;
const SCAN_DIRS = ['app', 'components', 'lib', 'emails', 'mobile/src', 'mobile/store', 'public'];
const SCAN_FILES = ['LAUNCH.md', 'README.md', 'SPEC.md', 'mobile/STORE-SETUP.md'];
const TEXT_EXT = /\.(tsx?|mjs|js|json|md|txt|html|xml|svg|css)$/;
const SKIP = new Set(['node_modules', '.next', '.git', '.gen', 'screenshots']);

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

describe('no "months free" anywhere', () => {
  it('no source, doc, email, store listing or public file contains "months free" / "month free"', () => {
    const files = [...SCAN_DIRS.flatMap((d) => walk(path.join(root, d))), ...SCAN_FILES.map((f) => path.join(root, f))];
    const hits: string[] = [];
    for (const f of files) {
      let text = '';
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      text.split('\n').forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('computed labels and rendered pricing copy never say it', () => {
    const strings = [
      annualSavingLabel('starter'),
      annualSavingLabel('pro'),
      annualSavingSentence('starter'),
      annualSavingSentence('pro'),
      YEARLY_NOTE,
      ...PRICING_FAQ.flatMap((f) => [f.q, f.a]),
      renderToStaticMarkup(createElement(Pricing)),
      JSON.stringify(PUBLIC_PRICES),
    ];
    for (const s of strings) expect(s).not.toMatch(BANNED);
    expect(PUBLIC_PRICES.plans.solo.annualSaving).toBe('save 16%');
    expect(PUBLIC_PRICES.plans.pro.annualSaving).toBe('save 16%');
  });

  it('the banned-phrase pattern catches the variants', () => {
    for (const s of ['about 2 months free', '1 month free', 'Months Free', 'two free months']) expect(s).toMatch(BANNED);
    expect(`Every plan starts with a ${TRIAL_DAYS}-day free trial. No card needed.`).not.toMatch(BANNED);
  });

  it('the 14-day trial wording is unchanged', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(PUBLIC_PRICES.trialDays).toBe(14);
    const text = renderToStaticMarkup(createElement(Pricing)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Every plan starts with a 14-day free trial. No card needed.');
    expect(text).toContain('The trial uses Solo limits. Move to Pro in Settings, or cancel, any time.');
  });
});
