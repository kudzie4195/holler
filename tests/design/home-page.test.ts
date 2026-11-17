import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from '../../app/page';
import { Footer } from '../../components/footer';
import { TopNav } from '../../components/top-nav';

const html = renderToStaticMarkup(createElement(Home));
const text = html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

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

  it('has the resident band and the learn row', () => {
    expect(text).toContain('Need something done at home?');
    for (const href of ['/request', '/guides', '/data', '/faq']) expect(html).toContain(`href="${href}"`);
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
    expect(lens.length).toBeGreaterThan(20);
  });
});
