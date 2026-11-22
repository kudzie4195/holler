// Round 9 nav and footer: the structure of the approved design, no lost links, the legal lines unchanged, honest copy.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANY } from '@/lib/legal/company';
import { bannedHits, hasEmDash } from '../seo/helpers/copy-metrics';

const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

async function render(supportEmail: string) {
  vi.stubEnv('SUPPORT_EMAIL', supportEmail);
  vi.stubEnv('EMAIL_FROM', '');
  vi.resetModules();
  const { TopNav } = await import('@/components/top-nav');
  const { Footer } = await import('@/components/footer');
  return {
    nav: renderToStaticMarkup(createElement(TopNav)),
    navCta: renderToStaticMarkup(createElement(TopNav, { ctaHref: '/signup?plan=pro' })),
    footer: renderToStaticMarkup(createElement(Footer)),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every href the round 8 top nav (bar and scrolling row) and footer had, rendered with SUPPORT_EMAIL set. */
const OLD_NAV = ['#main', '/', '/about', '/check', '/data', '/faq', '/for', '/guides', '/local', '/login', '/pricing', '/request', '/signup'];
const OLD_FOOTER = ['/', '/about', '/check', '/data', '/delete-account', '/faq', '/for', '/guides', '/local', '/pricing', '/privacy', '/request', '/terms', 'mailto:support@localholler.com'];

describe('top nav', () => {
  it('green bar, one row: logo, Check your area, How it works, Pricing, Log in, Start free (outline signal)', async () => {
    const { nav } = await render('support@localholler.com');
    expect(nav).toMatch(/<header class="on-brand sticky top-0 z-40 bg-brand">/);
    const main = nav.slice(nav.indexOf('<nav aria-label="Main"'), nav.indexOf('</nav>'));
    expect(hrefs(main)).toEqual(['/check', '/#how', '/pricing']);
    expect(text(main)).toBe('Check your area How it works Pricing');
    expect(nav).toMatch(/href="\/login"[^>]*>Log in</);
    expect(nav).toMatch(/class="[^"]*border-signal[^"]*"[^>]*href="\/signup"|href="\/signup"[^>]*class="[^"]*border-signal/);
    expect(nav).not.toContain('aria-label="Sections"');
    expect(nav).not.toContain('delete-account');
  });

  it('phones: section links hide below md, Log in hides below 22.5rem (360 px at the default text size), Start free always shows', async () => {
    const { nav } = await render('');
    expect(nav).toContain('<nav aria-label="Main" class="hidden md:block">');
    // A rem breakpoint, so a larger browser text size (32 px) hides Log in on a 390 px window too (review 2b P2-7).
    expect(nav).toMatch(/class="[^"]*\bhidden min-\[22\.5rem\]:inline-flex[^"]*" href="\/login"|href="\/login"[^>]*class="[^"]*\bhidden min-\[22\.5rem\]:inline-flex/);
    expect(nav).not.toMatch(/min-\[\d+px\]/);
  });

  it('the bar is at least 64 px tall and may wrap, never a fixed height that pushes the page sideways (review 2b P2-7)', async () => {
    const { nav } = await render('');
    const bar = nav.match(/<header[^>]*><div class="([^"]*)"/)![1].split(' ');
    expect(bar).toEqual(expect.arrayContaining(['min-h-16', 'flex-wrap']));
    expect(bar).not.toContain('h-16');
  });

  it('keeps the skip link, the ctaHref prop and 44 px targets, with no script', async () => {
    const { nav, navCta } = await render('');
    expect(nav.indexOf('href="#main"')).toBeLessThan(nav.indexOf('<header'));
    expect(text(nav)).toContain('Skip to content');
    expect(navCta).toContain('href="/signup?plan=pro"');
    expect(navCta).not.toContain('href="/signup"');
    // h-link is min-height 44px (globals.css); the button is min-h-11.
    expect(read('app/globals.css')).toMatch(/\.h-link {[^}]*min-height: 44px/);
    expect(nav.match(/class="h-link/g)?.length).toBeGreaterThanOrEqual(4);
    expect(nav).toMatch(/border-signal[^"]*min-h-11|min-h-11[^"]*border-signal/);
    expect(nav).not.toContain('<script');
  });
});

describe('footer', () => {
  it('ink background, brand lockup first, then Product, Trades, Learn, Company in that order', async () => {
    const { footer } = await render('support@localholler.com');
    expect(footer).toMatch(/^<footer class="on-brand mt-auto bg-ink">/);
    expect(footer.indexOf('aria-label="Holler home"')).toBeLessThan(footer.indexOf('<nav aria-label="Footer"'));
    const titles = [...footer.matchAll(/<h2 class="eyebrow">([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(titles).toEqual(['Product', 'Trades', 'Learn', 'Company']);
  });

  it('two link columns on a phone (from 18rem, 288 px at the default text size), four from md up; one column only when a large browser text size leaves no room (review 2b P2-7)', async () => {
    const { footer } = await render('');
    expect(footer).toMatch(/<nav aria-label="Footer" class="grid grid-cols-1 [^"]*min-\[18rem\]:grid-cols-2 [^"]*md:grid-cols-4/);
  });

  it('has the agreed links in each group', async () => {
    const { footer } = await render('support@localholler.com');
    const group = (title: string) => {
      const start = footer.indexOf(`>${title}</h2>`);
      return hrefs(footer.slice(start, footer.indexOf('</ul>', start)));
    };
    expect(group('Product')).toEqual(['/check', '/pricing', '/#how', '/storms', '/request', '/es']);
    expect(group('Trades')).toEqual(['/for/roofing', '/for/plumbing', '/for/hvac', '/for/electrical', '/for/tree-service', '/for/restoration', '/for']);
    expect(group('Learn')).toEqual(['/local', '/guides', '/faq', '/data', '/about']);
    expect(group('Company')).toEqual(['mailto:support@localholler.com', '/privacy', '/terms', '/delete-account']);
  });

  it('the trade links point at real trade ids', async () => {
    const { CATEGORIES } = await import('@/lib/signals/categories');
    const ids = new Set(CATEGORIES.map((c: { id: string }) => c.id));
    for (const id of ['roofing', 'plumbing', 'hvac', 'electrical', 'tree-service', 'restoration']) expect(ids.has(id), id).toBe(true);
  });

  it('leaves out Email support when no support address is set', async () => {
    const { footer } = await render('');
    expect(footer).not.toContain('mailto:');
    expect(text(footer)).not.toContain('Email support');
  });

  it('keeps the legal disclaimer and the address line word for word', async () => {
    const { footer } = await render('');
    const t = text(footer);
    expect(t).toContain(
      'Data comes from public government records and can be late or wrong, and Holler is not affiliated with or endorsed by any government agency. Check the source before you act.',
    );
    expect(footer).toContain(`<address class="not-italic">${COMPANY.brand} is run by ${COMPANY.legalName}, ${COMPANY.addressLine}.</address>`.replace(/'/g, '&#x27;').replace(/&(?!#x27;)/g, '&amp;'));
    expect(t).toContain('Marietta, GA');
  });

  it('copy rules: no banned word, no em dash', async () => {
    const { footer, nav } = await render('support@localholler.com');
    const all = `${text(nav)} ${text(footer)}`;
    expect(bannedHits(all)).toEqual([]);
    expect(hasEmDash(all)).toBe(false);
  });
});

describe('no link lost from the round 8 nav and footer', () => {
  it('every old href is in the new nav or footer', async () => {
    const { nav, footer } = await render('support@localholler.com');
    const now = new Set([...hrefs(nav), ...hrefs(footer)]);
    const missing = [...new Set([...OLD_NAV, ...OLD_FOOTER])].filter((h) => !now.has(h));
    expect(missing).toEqual([]);
  });
});
