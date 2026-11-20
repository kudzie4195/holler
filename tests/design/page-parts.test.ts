// Round 9, unit C: the shared inner-page parts (components/page-header.tsx) and the rules every inner page keeps.
// - PageHeader draws the page's only h1, on green (.on-brand), with the breadcrumb as a mono trail.
// - Contrast: every text/background pair the inner pages add beyond the token table in tests/design/tokens.test.ts, computed here.
// - No removed token, old hex, hero-paper, Fraunces or Geist in any file unit C owns.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PAGE_BOX } from '@/components/grid';
import { ClosingBand, Crumbs, FamilyMark, Ledger, PageHeader } from '@/components/page-header';
import { PRICING_INTRO } from '@/lib/plan/pricing-page';

const read = (p: string) => readFileSync(p, 'utf8');

describe('PageHeader', () => {
  const html = renderToStaticMarkup(
    createElement(PageHeader, {
      title: 'Storm and hail alerts for roofers',
      crumbs: [{ name: 'Home', href: '/' }, { name: 'By trade', href: '/for' }, { name: 'Roofing' }],
      lead: createElement('p', null, 'A one line lead.'),
    }, createElement('a', { href: '/signup' }, 'Start free')),
  );
  it('renders exactly one h1 with the title text, on a green .on-brand band', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Storm and hail alerts for roofers<\/h1>/);
    expect(html).toMatch(/^<div class="on-brand bg-brand">/);
  });
  it('breadcrumb: a labelled nav, links as 44 px targets, the current page marked', () => {
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html.match(/min-h-11/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/for"');
  });
  it('the main action sits inside the band, after the lead', () => {
    expect(html.indexOf('A one line lead.')).toBeLessThan(html.indexOf('href="/signup"'));
  });
  it('drops the current-page crumb when it repeats the h1 word for word (review 2 P2-17), keeps it otherwise', () => {
    const same = renderToStaticMarkup(
      createElement(PageHeader, { title: 'How to read a permit', crumbs: [{ name: 'Home', href: '/' }, { name: 'Guides', href: '/guides' }, { name: 'How to read a permit' }] }),
    );
    expect(same.match(/How to read a permit/g)).toHaveLength(1);
    expect(same).toContain('href="/guides"');
    expect(same).not.toContain('aria-current="page"');
    // Roofing is not the h1 text, so it stays as the marked current page (the first test above).
    expect(html).toContain('>Roofing</span>');
  });
  it('off the band the trail uses the light colors', () => {
    const light = renderToStaticMarkup(createElement(Crumbs, { items: [{ name: 'Home', href: '/' }, { name: 'FAQ' }], onBrand: false }));
    expect(light).toContain('text-muted');
    expect(light).not.toContain('on-brand');
  });
});

describe('records and calls to action', () => {
  it('a family is shown by shape and a word, not color alone: square for weather and permits, round for 311', () => {
    const w = renderToStaticMarkup(createElement(FamilyMark, { family: 'weather' }, 'Weather'));
    const s = renderToStaticMarkup(createElement(FamilyMark, { family: 'spending' }, 'Permits'));
    const c = renderToStaticMarkup(createElement(FamilyMark, { family: 'civic' }, '311'));
    expect(w).toContain('rounded-[3px] bg-storm');
    expect(s).toContain('rounded-[3px] bg-sage-mark');
    expect(c).toContain('rounded-full bg-civic-mark');
    for (const h of [w, s, c]) expect(h).toContain('aria-hidden="true"');
    expect(w).toContain('text-storm-ink');
  });
  it('a ledger is a ruled list: heavy ink rule on top, hairlines between rows', () => {
    const html = renderToStaticMarkup(createElement(Ledger, null, createElement('li', null, 'a')));
    expect(html).toMatch(/^<ul class="border-t-2 border-ink \[&amp;&gt;\*\]:border-b \[&amp;&gt;\*\]:border-line">/);
  });
  it('the closing band is green and its line is a paragraph, so it adds no heading to the outline', () => {
    const html = renderToStaticMarkup(createElement(ClosingBand, { line: 'Know first.' }, 'x'));
    expect(html).toContain('on-brand');
    expect(html).toContain('<p class="font-display');
    expect(html).not.toMatch(/<h[1-6]/);
  });
});

// ---- Contrast of the pairs unit C adds ----
function themeColors(): Record<string, string> {
  const theme = read('app/globals.css').match(/@theme\s*{([\s\S]*?)\n}/)![1];
  return Object.fromEntries([...theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const C = themeColors();
const LIGHT = ['background', 'surface', 'sand'];

/** [use, foreground token, background token, minimum]. Pairs already in the unit A table are not repeated here. */
export const C_PAIRS: [string, string, string, number][] = [
  // Family labels and the storm-day dates are family ink text on paper (the A table has them only on their own tint).
  ...LIGHT.flatMap((bg): [string, string, string, number][] => [
    ['weather label text', 'storm-ink', bg, 4.5],
    ['permit label text', 'sage-ink', bg, 4.5],
    ['311 label text', 'civic-ink', bg, 4.5],
  ]),
  // "Other records" outline square on /data: decorative next to its text label, still kept at 3:1.
  ['other records outline', 'muted', 'background', 3],
  // Delete account button: surface text on the danger fill.
  ['delete button text', 'surface', 'danger', 4.5],
  // Numbered step circles: signal numerals on brand (also in A's table as an eyebrow, repeated for the 14 px mono use).
  ['step numeral', 'signal', 'brand', 4.5],
  // Breadcrumb current page on the header band.
  ['breadcrumb current page', 'on-brand-faint', 'brand', 4.5],
];

describe('contrast of the pairs unit C adds', () => {
  it.each(C_PAIRS)('%s: %s on %s', (_use, fg, bg, min) => {
    expect(C[fg], fg).toBeTruthy();
    expect(C[bg], bg).toBeTruthy();
    expect(ratio(C[fg], C[bg])).toBeGreaterThanOrEqual(min);
  });
});

// ---- No old look in unit C's files ----
const A_FILES = new Set([
  'app/globals.css', 'app/layout.tsx', 'app/global-error.tsx', 'components/signal-meta.ts',
  ...['logo', 'button', 'input', 'select', 'field', 'card', 'badge', 'chip', 'notice', 'slider', 'empty-state', 'password-input', 'top-nav', 'footer', 'app-nav', 'auth-card', 'doc-page'].map((f) => `components/${f}.tsx`),
]);
const B_FILES = new Set(['app/page.tsx', 'components/pricing.tsx']);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(rel).isDirectory() ? walk(rel) : /\.(ts|tsx|css)$/.test(n) ? [rel] : [];
  });
}
export const UNIT_C_FILES = [...walk('app'), ...walk('components'), ...walk('lib/check')].filter(
  (f) => !A_FILES.has(f) && !B_FILES.has(f) && !/^components\/(icons|home|illustrations)\//.test(f),
);

const OLD: [string, RegExp][] = [
  ['accent token', /(?<![\w-])(?:[\w[\]&/-]+:)*!?(?:bg|text|border|ring|outline|from|to|via|fill|stroke|decoration|divide|placeholder|caret|shadow|border-l|border-t)-accent(?:-(?:hover|bright|text|soft))?(?![\w-])|--color-accent|var\(--color-accent/],
  ['accent tone', /tone(?:=|:\s*)["']accent["']/],
  ['brick', /(?<![\w-])(?:bg|text|border|fill|stroke)-brick(?![\w-])|--color-brick/],
  ['hero-paper', /hero-paper/],
  ['old hex', /#(?:e8590c|ad4205|fbe8d8|faf6ee|fffdf9|191714|5c574f|e5dccb|f3ebdd|8f8572|c94a08|e15509|c98a6b|8f3705|e7ede3|3b5a40|4f7d55|2f6f8f|d4e3cd)(?![0-9a-f])/i],
  ['raw hex color in a class or style', /(?:bg|text|border|fill|stroke)-\[#|color:\s*#/],
  ['Fraunces', /fraunces/i],
  ['Geist', /\bgeist\b/i],
  ['white literal', /(?<![\w-])(?:bg|text|border)-white(?![\w-])/],
  ['pill control', /rounded-full[^"'`]*(?:px-[3-9]|min-h-1[01])|(?:px-[3-9]|min-h-1[01])[^"'`]*rounded-full/],
];

describe("unit C's files keep nothing of the old look", () => {
  it('covers the inner pages and their components', () => {
    expect(UNIT_C_FILES).toEqual(expect.arrayContaining(['app/check/page.tsx', 'app/local/_components/ui.tsx', 'components/page-header.tsx', 'components/feed.tsx']));
    expect(UNIT_C_FILES).not.toContain('components/button.tsx');
    expect(UNIT_C_FILES).not.toContain('app/page.tsx');
  });
  it('no removed token, old hex, hero-paper, Fraunces, Geist, white literal or pill control', () => {
    const hits = UNIT_C_FILES.flatMap((f) =>
      read(f)
        .split('\n')
        .flatMap((line, i) => OLD.filter(([, re]) => re.test(line)).map(([name]) => `${f}:${i + 1} ${name}`)),
    );
    expect(hits).toEqual([]);
  });
  it('sub-heads inside the signed-in app and on reading pages are h-plain, not display capitals', () => {
    for (const f of ['components/feed.tsx', 'components/feed/empty-feed.tsx', 'components/feed/recent-activity.tsx', 'app/app/settings/page.tsx', 'app/guides/[slug]/page.tsx', 'app/faq/page.tsx']) {
      const h2s = read(f).match(/<h2[^>]*>/g) ?? [];
      expect(h2s.length, f).toBeGreaterThan(0);
      for (const h of h2s) if (!h.includes('sr-only')) expect(h, f).toContain('h-plain');
    }
  });
});

// ---- One page grid (commander decision 3, review 2 P1-1 and P1-2) ----
describe('one page grid: one 1200 px box, a 24 px gutter at every width, one left edge', () => {
  it('the box is max-w-[1200px] with px-6 and no width-dependent gutter', () => {
    expect(PAGE_BOX).toBe('mx-auto w-full max-w-[1200px] px-6');
  });
  const SHELLS = [
    'components/top-nav.tsx', 'components/footer.tsx', 'components/page-header.tsx', 'components/doc-page.tsx',
    'app/local/_components/ui.tsx', 'app/guides/_components/shell.tsx', 'app/check/page.tsx', 'app/request/page.tsx',
    'app/request/sent/page.tsx', 'app/pricing/page.tsx', 'app/(auth)/layout.tsx', 'app/onboarding/page.tsx',
    'app/onboarding/preview/page.tsx', 'app/app/layout.tsx', 'app/not-found.tsx', 'app/error.tsx',
  ];
  it.each(SHELLS)('%s builds its bands and columns on PAGE_BOX', (f) => {
    expect(read(f)).toContain('${PAGE_BOX}');
  });
  // The one exception (commander decision after the round 9 reviews): sign-in and onboarding centre their form column.
  const CENTRED = ['app/(auth)/layout.tsx', 'app/onboarding/page.tsx', 'app/onboarding/preview/page.tsx'];
  it.each(CENTRED)('%s centres its column inside PAGE_BOX; the logo bar stays on the grid edge', (f) => {
    const src = read(f);
    expect(src).toMatch(/className="mx-auto (?:flex w-full )?max-w-(?:md|2xl)/);
    expect(src).toMatch(/<div className=\{`\$\{PAGE_BOX\} flex h-16 items-center`\}>/);
  });
  it('no other page centres a narrower box of its own (a narrow measure nests inside PAGE_BOX, so its column starts at the logo edge)', () => {
    const files = [...walk('app'), ...walk('components')].filter((f) => !/^components\/home\//.test(f) && !CENTRED.includes(f) && f !== 'components/grid.ts' && f !== 'app/page.tsx' && f !== 'components/pricing.tsx');
    const hits = files.flatMap((f) =>
      read(f)
        .split('\n')
        .flatMap((line, i) => (/mx-auto[^"'`]*\bmax-w-|max-w-[^"'`]*\bmx-auto/.test(line) && !/absolute|empty-state/.test(line + f) ? [`${f}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});

describe('display font preload (review 2 P2-14)', () => {
  it('the root layout preloads the same Barlow file that globals.css uses, as a font with CORS', () => {
    const layout = read('app/layout.tsx');
    const file = '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2';
    expect(read('app/globals.css')).toContain(file);
    expect(layout).toContain(`new URL('../node_modules/${file}', import.meta.url)`);
    expect(layout).toContain('<link rel="preload" href={BARLOW_700} as="font" type="font/woff2" crossOrigin="anonymous" />');
  });
});

describe('small shell rules from the round 9 reviews', () => {
  it('.h-link is a 44 by 44 px target, so a short word such as "FAQ" is not a narrow strip (review 1 P2-7)', () => {
    const css = read('app/globals.css');
    const rule = css.slice(css.indexOf('.h-link {'), css.indexOf('}', css.indexOf('.h-link {')));
    expect(rule).toContain('min-height: 44px;');
    expect(rule).toContain('min-width: 44px;');
  });
  it('the dead .hero-paper backdrop is gone from globals.css (review 1 P1-3)', () => {
    expect(read('app/globals.css')).not.toContain('hero-paper');
  });
  it('the signal button darkens on hover with the signal-hover token, not a brightness filter (review 2 P2-12)', () => {
    const btn = read('components/button.tsx');
    expect(btn).toContain("signal: 'bg-signal text-ink hover:bg-signal-hover'");
    expect(btn).not.toMatch(/hover:brightness/);
    expect(C['signal-hover']).toBe('#c6dd32');
    expect(ratio(C.ink, C['signal-hover'])).toBeGreaterThanOrEqual(4.5);
  });
  it('/check shows what the check lists before a search, on the ZIP step and on a form error (review 2 P2-15)', () => {
    const page = read('app/check/page.tsx');
    expect((page.match(/<CheckPreview \/>/g) ?? []).length).toBe(3);
    expect(page).not.toMatch(/last 30 days/);
  });
  it('/pricing keeps one sentence in the green band and does not restate the prices under the cards (review 2 P1-6; final B P2-1)', () => {
    const page = read('app/pricing/page.tsx');
    expect(page).toContain('lead={<p>{PRICING_INTRO[0]}</p>}');
    // Final review B P2-1: the paragraph that repeated each plan's price and limits under the cards is gone (cards and table say it).
    expect(page).not.toContain('PRICING_INTRO.slice(1)');
    expect(PRICING_INTRO).toHaveLength(1);
    expect(PRICING_INTRO.join(' ')).not.toMatch(/\$\d/);
    // The lower sections use the home FAQ shape from md up (heading left third, body right two thirds), not a 768 px column.
    expect(page).not.toContain('max-w-3xl');
    expect(page.match(/md:grid md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,2fr\)\] md:gap-12/g)).toHaveLength(2);
    expect(page).toContain('<ComingNext page="pricing" split />');
    expect(read('components/coming-next.tsx')).toContain("split ? 'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12' : ''");
  });
  it('the footer calls /data by its page name and its tagline is balanced, not a one-word orphan line (review 2 P2-11; final A P2-5)', () => {
    const footer = read('components/footer.tsx');
    // Final review A P2-5: the label is back to the round 8 wording, the same words as the /data title and h1.
    expect(footer).toContain("{ href: '/data', label: 'Local public records in numbers' }");
    // Final review B P2-9: the legal line does not leave "you act." alone on a line.
    expect(footer).toMatch(/<p className="text-pretty">\s*Data comes from public government records/);
    expect(footer).toMatch(/text-balance[^"]*">Public records near you, sorted for your trade\.<\/p>/);
  });
  it('the guides list has no decorative icon tiles (review 2 P2-16)', () => {
    expect(read('app/guides/page.tsx')).not.toMatch(/Icon\b|GUIDE_ICON/);
  });
});

// ---- Fix wave 2 (review 2b P2-8 to P2-11, review 1 P2-7 leftovers and new P2-1) ----
describe('fix wave 2: wide-screen aside, one body size, one reading h1, 44 px targets', () => {
  it('the aside shell: a 768 px text column and a 320 px sticky column from 1024 px (64rem) up, nothing under it (review 2b P2-10)', async () => {
    const { Aside } = await import('@/app/local/_components/ui');
    const html = renderToStaticMarkup(createElement(Aside, null, createElement(ClosingBand, { line: 'Know first.' }, 'x')));
    // lg:[&_a]:w-full: the card's buttons take the full card width from 1024 px (final review B P2-2).
    expect(html).toMatch(/^<div data-aside="" class="lg:absolute lg:inset-y-0 lg:right-0 lg:w-80 lg:\[&amp;_a\]:w-full"><div class="lg:sticky lg:top-24"><div class="on-brand/);
    // No class without the lg: prefix, so under 1024 px the card is a plain block where the page puts it.
    const classes = [...html.matchAll(/class="([^"]*)"/g)].slice(0, 2).flatMap((m) => m[1].split(' '));
    expect(classes.every((c) => c.startsWith('lg:'))).toBe(true);
    const ui = read('app/local/_components/ui.tsx');
    expect(ui).toContain('<div className="lg:relative lg:min-h-[26rem] lg:pr-96">');
  });
  const ASIDE_PAGES = ['app/for/[trade]/page.tsx', 'app/local/[state]/[city]/page.tsx', 'app/storms/page.tsx'];
  it.each(ASIDE_PAGES)('%s turns the aside on and moves its one existing closing card into it, adding nothing', (f) => {
    const src = read(f);
    expect(src).toMatch(/<Page\s+withAside/);
    expect(src.match(/<ClosingBand/g)).toHaveLength(1);
    expect(src.match(/<Aside[\s>]/g)).toHaveLength(1);
    const inner = src.slice(src.indexOf('<Aside'), src.indexOf('</Aside>'));
    expect(inner).toContain('<ClosingBand');
    expect(inner).toContain('</ClosingBand>');
  });
  it('the storm day page keeps its wide records table and no aside', () => {
    expect(read('app/storms/[state]/[slug]/page.tsx')).not.toContain('withAside');
  });

  it('one body size: every public page shell uses BODY_TEXT, the same 1.0625rem as the homepage <main> (review 2b P2-11)', async () => {
    const { BODY_TEXT } = await import('@/components/grid');
    expect(BODY_TEXT).toBe('text-[1.0625rem]');
    expect(read('app/page.tsx')).toMatch(/<main id="main" className="text-\[1\.0625rem\]/);
    const shells = [
      'app/local/_components/ui.tsx', 'components/doc-page.tsx', 'app/guides/_components/shell.tsx', 'app/check/page.tsx', 'app/pricing/page.tsx',
      'app/request/page.tsx', 'app/request/sent/page.tsx', 'app/not-found.tsx', 'app/error.tsx', 'app/(auth)/layout.tsx', 'app/onboarding/page.tsx',
      'app/onboarding/preview/page.tsx',
    ];
    for (const f of shells) expect(read(f), f).toMatch(/<main id="main" className=\{`[^`]*\$\{BODY_TEXT\}/);
    // Running text on reading pages inherits it: no text-base left on a paragraph, answer or list there.
    for (const f of ['components/doc-page.tsx', 'app/faq/page.tsx', 'app/guides/page.tsx', 'app/guides/[slug]/page.tsx']) {
      expect(read(f), f).not.toMatch(/<(?:p|dd|ul|div|aside)[^>]*\btext-base\b/);
    }
  });

  it('one h1 size for reading pages: DocPage uses the same scale as PageHeader size "sm" (40 px, 52 px from sm) (review 2b P2-9)', () => {
    expect(read('components/doc-page.tsx')).toContain('<h1 className="break-words text-4xl sm:text-5xl">');
    expect(read('components/page-header.tsx')).toContain(": 'text-4xl sm:text-5xl';");
    for (const f of ['app/faq/page.tsx', 'app/guides/page.tsx', 'app/guides/[slug]/page.tsx']) expect(read(f), f).toMatch(/size="sm"/);
  });

  it('the /pricing "I want this" buttons are the default 44 px size, not sm (36 px with a mouse) (review 2b P2-8)', () => {
    const src = read('components/coming-next.tsx');
    expect(src).not.toContain('size="sm"');
    expect(src).toContain('size="md"');
  });

  it('breadcrumb links are 44 px tall with even gaps; the auth page switch links are 44 by 44 px targets (review 1 P2-7; final B P2-4)', () => {
    const crumbs = renderToStaticMarkup(createElement(Crumbs, { items: [{ name: 'Home', href: '/' }, { name: 'FAQ' }] }));
    // Final review B P2-4: no min-w-11, which gave "HOME" an 18 px gap before its slash and every other crumb 8 px. The links
    // stay 44 px tall and "HOME" is 34 px wide, above the WCAG 2.5.8 24 px minimum.
    expect(crumbs).toMatch(/<a [^>]*class="[^"]*min-h-11[^"]*" href="\/"|href="\/"[^>]*class="[^"]*min-h-11/);
    expect(crumbs).not.toContain('min-w-11');
    for (const f of ['app/(auth)/login/page.tsx', 'app/(auth)/signup/page.tsx', 'app/(auth)/forgot/page.tsx']) {
      expect(read(f), f).toContain('className="inline-flex min-h-11 min-w-11 items-center font-semibold text-brand-text underline"');
    }
  });

  it('a large browser text size cannot push a page sideways: labels wrap under 22.5rem, long words break (review 2b P2-7)', () => {
    const btn = read('components/button.tsx');
    expect(btn).toMatch(/'inline-flex max-w-full [^']*whitespace-normal min-\[22\.5rem\]:whitespace-nowrap/);
    const css = read('app/globals.css');
    const body = css.slice(css.indexOf('  body {'), css.indexOf('}', css.indexOf('  body {')));
    expect(body).toContain('overflow-wrap: break-word;');
  });
});
