// Round 3 pages fixes: share metadata, the /data retitle, spelling, "Holler is new" spread, form border contrast, phone nav, heading font.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GUIDES } from '@/lib/seo/guides';
import { DATA_META, FAQ_META, GUIDES_HUB_META, guideMeta } from '@/lib/seo/guides/seo';
import { dataJsonLd } from '@/lib/seo/national-seo';
import { socialMeta } from '@/lib/seo/social';
import { TopNav } from '@/components/top-nav';
import { Footer } from '@/components/footer';
import { Input } from '@/components/input';
import { Select } from '@/components/select';
import { controlClasses } from '@/components/field';
import { bannedHits, hasEmDash } from './helpers/copy-metrics';

vi.mock('@/components', async () => {
  const react = await import('react');
  return {
    TopNav: () => null,
    Footer: () => null,
    Card: ({ children }: { children: React.ReactNode }) => react.createElement('div', null, children),
    Notice: ({ children }: { children: React.ReactNode }) => react.createElement('div', null, children),
  };
});

const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

/** WCAG 2.x relative luminance contrast of two #rrggbb colors. */
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (css: string, name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))![1];

describe('form control borders (WCAG 1.4.11)', () => {
  const css = read('app/globals.css');
  const strong = token(css, 'line-strong');
  it('line-strong is at least 3:1 on the page background, the card surface and the sand band; the decorative line token is unchanged', () => {
    expect(contrast(strong, token(css, 'surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(strong, token(css, 'background'))).toBeGreaterThanOrEqual(3);
    expect(contrast(strong, token(css, 'sand'))).toBeGreaterThanOrEqual(3);
    expect(token(css, 'line')).toBe('#e5dccb');
    expect(contrast(token(css, 'line'), token(css, 'surface'))).toBeLessThan(3);
  });
  it('inputs, selects and the shared control classes use it, and hover darkens rather than lightens the border', () => {
    expect(controlClasses).toContain('border-line-strong');
    expect(controlClasses).not.toMatch(/\bborder-line(?![-\w])/);
    expect(controlClasses).toContain('hover:border-ink');
    expect(controlClasses).not.toContain('hover:border-ink/40');
    expect(renderToStaticMarkup(createElement(Input, { label: 'Name' }))).toContain('border-line-strong');
    expect(renderToStaticMarkup(createElement(Select, { label: 'Trade' }, createElement('option', null, 'x')))).toContain('border-line-strong');
    expect(read('components/feed.tsx')).toContain('border-line-strong');
  });
});

describe('heading font', () => {
  const css = read('app/globals.css');
  it('Fraunces loads with font-display swap and has a metric-matched local fallback listed right after it', () => {
    expect(css).toMatch(/font-family: 'Fraunces Variable';[\s\S]*?font-display: swap;/);
    const fb = css.match(/@font-face\s*{\s*font-family: 'Fraunces Fallback';([\s\S]*?)}/)![1];
    expect(fb).toContain("src: local('Georgia')");
    expect(fb).toMatch(/size-adjust: 10\d(\.\d+)?%/);
    expect(fb).toMatch(/ascent-override: \d+(\.\d+)?%/);
    expect(fb).toMatch(/descent-override: \d+(\.\d+)?%/);
    expect(css).toMatch(/--font-display: 'Fraunces Variable', 'Fraunces Fallback'/);
  });
});

describe('phone navigation row', () => {
  const html = renderToStaticMarkup(createElement(TopNav));
  const row = html.slice(html.indexOf('aria-label="Sections"'));
  const hrefs = [...row.matchAll(/href="(\/[a-z]*)"/g)].map((m) => m[1]);
  it('lists the links in the order a phone visitor needs them, with Check, Request and Pricing first', () => {
    expect(hrefs.slice(0, 9)).toEqual(['/check', '/request', '/pricing', '/for', '/local', '/guides', '/faq', '/data', '/about']);
    const labels = [...row.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Check your area', 'Request a service', 'Pricing', 'By trade', 'By city', 'Guides', 'FAQ', 'Data', 'About']);
  });
  it('has vertical padding for the focus ring, a visible scroll cue, 44px targets, a visible hover fill and no script', () => {
    expect(row).toMatch(/nav-scroll[^"]*py-1\.5/);
    expect(row).not.toMatch(/nav-scroll[^"]*\bh-12\b/);
    expect(row).toContain('bg-gradient-to-l');
    expect(row).toContain('aria-hidden="true"');
    expect(row).toContain('min-h-11');
    expect(row).toContain('hover:bg-surface');
    expect(row).not.toContain('hover:bg-sand');
    expect(html).not.toContain('<script');
  });
  it('the css no longer masks the row, which faded the focus ring of the last link', () => {
    expect(read('app/globals.css')).not.toMatch(/\.nav-scroll\s*{[^}]*mask-image/);
  });
  it('the header Main landmark holds the section links and exists only on wide screens; Log in and Start free are not in a landmark named Main', () => {
    const header = html.slice(0, html.indexOf('aria-label="Sections"'));
    expect(header).toMatch(/<nav aria-label="Main" class="hidden xl:block">/);
    expect(header.indexOf('/login')).toBeGreaterThan(header.indexOf('</nav>'));
  });
});

describe('share metadata (Open Graph and Twitter)', () => {
  it('socialMeta repeats every field a page needs, because a page object replaces the layout object', () => {
    const m = socialMeta({ title: 'T | Holler', description: 'D', path: '/x' });
    const og = m.openGraph as { title: string; description: string; url: string; siteName: string; type: string; images: { url: string; width: number; height: number }[] };
    expect(og).toMatchObject({ title: 'T | Holler', description: 'D', siteName: 'Holler', type: 'website' });
    expect(og.url).toMatch(/\/x$/);
    expect(og.images[0]).toMatchObject({ url: '/og.png', width: 1200, height: 630 });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', title: 'T | Holler', description: 'D', images: ['/og.png'] });
    expect((socialMeta({ title: 'a', description: 'b', path: '/g', type: 'article' }).openGraph as { type: string }).type).toBe('article');
  });

  it('/guides, /faq and /data match their page meta; each guide is an article that matches its own meta', async () => {
    const hub = (await import('@/app/guides/page')).generateMetadata();
    const faq = (await import('@/app/faq/page')).generateMetadata();
    const data = (await import('@/app/data/page')).generateMetadata();
    for (const [meta, m] of [[hub, GUIDES_HUB_META], [faq, FAQ_META], [data, DATA_META]] as const) {
      expect(meta.openGraph).toMatchObject({ title: m.title, description: m.description, siteName: 'Holler', type: 'website' });
      expect(String((meta.openGraph as { url: string }).url)).toMatch(new RegExp(`${m.path}$`));
      expect((meta.openGraph as { images: unknown[] }).images).toHaveLength(1);
      expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: m.title, description: m.description });
    }
    const { generateMetadata } = await import('@/app/guides/[slug]/page');
    for (const g of GUIDES) {
      const meta = await generateMetadata({ params: Promise.resolve({ slug: g.slug }) });
      const m = guideMeta(g);
      expect(meta.openGraph).toMatchObject({ title: m.title, description: m.description, siteName: 'Holler', type: 'article' });
      expect(String((meta.openGraph as { url: string }).url)).toContain(`/guides/${g.slug}`);
      expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: m.title });
    }
  });

  it('/request sets its own Open Graph and Twitter values: its own url and title, an image, and the same description as the page', async () => {
    const { metadata } = await import('@/app/request/page');
    const og = metadata.openGraph as { title: string; description: string; url: string; siteName: string; type: string; images: unknown[] };
    expect(og.url).toBe('/request');
    expect(og.title).toMatch(/^Ask local businesses for a quote/);
    expect(og.description).toBe(metadata.description);
    expect(og).toMatchObject({ siteName: 'Holler', type: 'website' });
    expect(og.images).toHaveLength(1);
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', description: metadata.description });
  });
});

describe('/data is titled as records, not demand', () => {
  it('title, description, JSON-LD names, footer and home links say "Local public records in numbers"', () => {
    expect(DATA_META.title).toMatch(/^Local Public Records in Numbers/);
    expect(DATA_META.description).toContain('dated in the last 7 and 30 days');
    expect(DATA_META.description).not.toMatch(/demand|arrived/i);
    const stats = { ok: true, asOf: '2026-11-17T12:00:00.000Z', newestAt: null } as never;
    const ld = JSON.stringify(dataJsonLd(stats));
    expect(ld).toContain('Local public records in numbers');
    expect(ld).not.toMatch(/demand in numbers/i);
    expect(JSON.stringify(dataJsonLd({ ok: false } as never))).toContain('Local public records in numbers');
    expect(renderToStaticMarkup(createElement(Footer))).toContain('Local public records in numbers');
    for (const f of ['app/page.tsx', 'app/data/page.tsx', 'lib/seo/national-seo.ts', 'lib/seo/llms-extra.ts', 'lib/seo/guides/seo.ts', 'components/footer.tsx']) {
      expect(read(f), f).not.toMatch(/demand in numbers/i);
    }
  });
  it('the page h1, breadcrumb and the lines under it say records, and the places label is not "cities"', () => {
    const src = read('app/data/page.tsx');
    expect(src).toMatch(/<h1[^>]*>Local public records in numbers<\/h1>/);
    expect(src).toContain("{ name: 'Local public records in numbers' }");
    expect(src).toContain('not how much demand there is');
    expect(src).toContain('Places with a record in 30 days');
    expect(src).toContain('We take the ten cities with the most records in 60 days and sort them by their last 30 days.');
    expect(src).not.toContain('It ranks the ten cities');
    // rows where both counts are zero are hidden
    expect(src).toContain('k.last7 > 0 || k.last30 > 0');
  });
});

describe('"Holler is new" is said on at most three pages', () => {
  it('appears only in the FAQ, the about copy and the request page', () => {
    const files = ['lib/seo/faq.ts', 'lib/seo/public-copy.ts', 'app/request/page.tsx', 'app/page.tsx', 'app/pricing/page.tsx', 'lib/plan/pricing-page.ts', 'lib/seo/llms-extra.ts', 'components/footer.tsx', 'lib/seo/guides/seo.ts'];
    const guideFiles = readdirSync(new URL('../../lib/seo/guides', import.meta.url)).map((f) => `lib/seo/guides/${f}`);
    const hits = [...new Set([...files, ...guideFiles])].filter((f) => /Holler is new/.test(read(f)));
    expect(hits.sort()).toEqual(['app/request/page.tsx', 'lib/seo/faq.ts', 'lib/seo/public-copy.ts']);
  });
});

describe('US spelling in files that hold public words', () => {
  function walk(dir: string): string[] {
    const abs = new URL(`../../${dir}`, import.meta.url);
    return readdirSync(abs).flatMap((n) => {
      const rel = `${dir}/${n}`;
      return statSync(new URL(`../../${rel}`, import.meta.url)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
    });
  }
  // lib/signals has an internal note that names a dataset in the source's own words; the pages never print it.
  const files = [...walk('app'), ...walk('components'), ...walk('lib/seo'), ...walk('lib/plan'), ...walk('lib/legal'), ...walk('lib/email')];
  it('no "licence", "licenced", "colour", "neighbour", "favourite", "organise", "enquiry" or "cheque" in any page, component or copy module', () => {
    const bad = /\b(licences?|licenced|colour\w*|neighbour\w*|favourite\w*|organis(e|es|ed|ing|ation)|enquir(y|ies)|cheques?)\b/i;
    const hits = files.flatMap((f) => read(f).split('\n').map((l, i) => [f, i + 1, l] as const)).filter(([, , l]) => bad.test(l));
    expect(hits.map(([f, n]) => `${f}:${n}`)).toEqual([]);
  });
  it('no guide file or slug keeps the old spelling', () => {
    expect(readdirSync(new URL('../../lib/seo/guides', import.meta.url)).join(' ')).not.toMatch(/licence/);
  });
});

describe('meta descriptions', () => {
  it('/about description is 120 to 160 characters', async () => {
    const { aboutCopy } = await import('@/lib/seo/public-copy');
    const n = aboutCopy(() => false).metaDescription.length;
    expect(n).toBeGreaterThanOrEqual(120);
    expect(n).toBeLessThanOrEqual(160);
  });
});

describe('copy rules on the strings added in this round', () => {
  it('no banned word and no em dash in the new share and nav strings', () => {
    const text = [PRICING_TEXT(), DATA_META.title, DATA_META.description].join(' ');
    expect(bannedHits(text)).toEqual([]);
    expect(hasEmDash(text)).toBe(false);
  });
});

function PRICING_TEXT(): string {
  return read('lib/plan/pricing-page.ts').match(/PRICING_TITLE = `[^`]*`/)![0];
}
