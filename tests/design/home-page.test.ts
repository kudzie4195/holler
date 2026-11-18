import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ live: null as unknown }));
vi.mock('@/lib/seo/home-live', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/home-live')>()),
  loadHomeLive: async () => h.live,
}));

import Home from '../../app/page';
import { Footer } from '../../components/footer';
import { TopNav } from '../../components/top-nav';
import { HOME_LIVE_PREVIEW_FIXTURE } from '../../lib/seo/home-live';

async function render(live: unknown): Promise<string> {
  h.live = live;
  return renderToStaticMarkup(await Home());
}
function toText(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

// No live data (the database is unreachable in tests): the band is simply absent.
const html = await render(null);
const text = toText(html);
const withBand = await render(HOME_LIVE_PREVIEW_FIXTURE);

const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape',
  'realm', 'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];

describe('home page design pass', () => {
  it('has exactly one h1 and keeps the hero check form', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('action="/check"');
  });

  it('names the keyless public sources in a text-only strip, with no endorsement wording', () => {
    expect(text).toContain('Reads public data from');
    for (const s of ['National Weather Service', 'NOAA Storm Prediction Center', 'FEMA', 'USGS', 'FAA', 'USAspending.gov', 'City open-data portals']) {
      expect(text).toContain(s);
    }
    // The footer disclaimer (legal.md (c)) says Holler is NOT endorsed by any agency; that negation is not an endorsement claim.
    expect(text.replace(/not affiliated with or endorsed by any government agency/g, '')).not.toMatch(/trusted by|partner|as seen in|endorsed/i);
  });

  it('mentions both plans and no longer says there is one price', () => {
    expect(text).toContain('$5 a month');
    expect(text).toContain('$9.99');
    expect(text).not.toMatch(/one price/i);
  });

  it('says each price at most twice outside the plan cards (the hero line), with no flat-price section', () => {
    const outsideCards = toText(html.replace(/<ul[^>]*aria-label="Plans"[\s\S]*?<\/ul><p/, '<p'));
    expect(outsideCards.match(/\$5\b/g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(outsideCards.match(/\$9\.99/g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(text).not.toMatch(/no bill per lead/i);
  });

  it('is short: at most 600 words with nav, footer, closed FAQ answers and the live band', () => {
    // The trade picker's <option> labels are left out: a closed dropdown shows none of them, and the picker is the shared CheckForm.
    // Same rule as gates/r4/count-words.mjs.
    const words = (m: string) => toText(m.replace(/<select[\s\S]*?<\/select>/g, ' ')).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    expect(words(withBand)).toBeLessThanOrEqual(600);
    expect(words(html)).toBeLessThanOrEqual(560);
  });

  it('FAQ: at most four native accordions, closed, matching the FAQPage JSON-LD exactly', () => {
    const qs = [...html.matchAll(/<summary[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(4);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(qs.map((q) => q.replace(/&#x27;/g, "'")));
    expect(html).toContain('href="/faq"');
  });

  it('the live band renders only with data, says records not leads, and its icons are decorative', () => {
    expect(html).not.toContain('This week on Holler');
    expect(withBand).toContain('This week on Holler');
    const band = toText(withBand.slice(withBand.indexOf('id="this-week"'), withBand.indexOf('id="how-h"')));
    expect(band).toContain('Not jobs or leads');
    expect(band).not.toMatch(/\bjobs (for|near) you|\bleads (for|near) you|customers/i);
    expect(band).toContain('4,812');
    const icons = withBand.match(/<svg[^>]*viewBox="0 0 24 24"[^>]*>/g) ?? [];
    expect(icons.length).toBeGreaterThan(15);
    for (const svg of icons) expect(svg).toContain('aria-hidden="true"');
  });

  it('adds no client JavaScript: no new "use client" file and no script besides JSON-LD', () => {
    expect(readFileSync(new URL('../../app/page.tsx', import.meta.url), 'utf8')).not.toContain("'use client'");
    for (const f of readdirSync(new URL('../../components/icons', import.meta.url))) {
      expect(readFileSync(new URL(`../../components/icons/${f}`, import.meta.url), 'utf8')).not.toContain('use client');
    }
    expect(readFileSync(new URL('../../lib/seo/home-live.ts', import.meta.url), 'utf8')).not.toContain('use client');
    expect(html.match(/<script(?![^>]*application\/ld\+json)/g)).toBeNull();
  });

  it('inline SVG on the page stays small (under 20 KB above the old page, with the band)', () => {
    const bytes = (withBand.match(/<svg[\s\S]*?<\/svg>/g) ?? []).reduce((a, s) => a + Buffer.byteLength(s), 0);
    expect(bytes).toBeLessThan(9_400 + 20 * 1024);
  });

  it('has the resident band and the learn row', () => {
    expect(text).toContain('Need something done at home?');
    for (const href of ['/request', '/guides', '/data', '/faq']) expect(html).toContain(`href="${href}"`);
    // Trade chips link to their /for pages.
    expect(html).toContain('href="/for/roofing"');
  });

  it('follows the copy rules: no em dashes, no banned words, no invented proof', () => {
    expect(html).not.toContain('—');
    for (const w of BANNED) expect(text.toLowerCase(), w).not.toMatch(new RegExp(`\\b${w}\\b`));
    expect(text).not.toMatch(/testimonial|\d+\s*(customers|businesses use)|★/i);
  });

  it('the illustration is decorative and small', () => {
    const src = readFileSync(new URL('../../components/illustrations/main-street.tsx', import.meta.url), 'utf8');
    expect(src).toContain('aria-hidden="true"');
    expect(Buffer.byteLength(src)).toBeLessThan(6 * 1024);
  });
});

describe('shared navigation', () => {
  const nav = renderToStaticMarkup(createElement(TopNav));
  it('every public section is reachable on narrow screens with no script', () => {
    const row = nav.slice(nav.indexOf('aria-label="Sections"'));
    for (const href of ['/check', '/for', '/local', '/guides', '/faq', '/data', '/request', '/pricing', '/about']) expect(row).toContain(`href="${href}"`);
    expect(nav).not.toContain('<script');
  });
  it('the footer groups product, learn and legal links and shows the mailing address', () => {
    const f = renderToStaticMarkup(createElement(Footer));
    for (const href of ['/check', '/for', '/local', '/pricing', '/request', '/guides', '/faq', '/data', '/about', '/terms', '/privacy']) {
      expect(f).toContain(`href="${href}"`);
    }
    expect(f).toContain('Marietta, GA');
  });
});

/** Prints sentence stats for the copy-rule check in the hand-back; only asserts the hard rules. */
describe('home copy rhythm', () => {
  it('reports sentence statistics', () => {
    const sentences = text
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => /[a-z]/i.test(s));
    const lens = sentences.map((s) => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    const short = lens.filter((n) => n < 8).length / lens.length;
    console.log(JSON.stringify({ sentences: lens.length, mean: +mean.toFixed(1), cv: +(sd / mean).toFixed(2), shortShare: +short.toFixed(2) }));
    expect(lens.length).toBeGreaterThan(10);
  });
});
