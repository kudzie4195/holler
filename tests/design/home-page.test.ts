import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ live: null as unknown }));
vi.mock('@/lib/seo/home-live', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/home-live')>()),
  loadHomeLive: async () => h.live,
}));

import Home from '../../app/page';
import { NO_LIVE, homeLivePreviewFixture } from '../../lib/seo/home-live';
import { homeCopy } from '../../lib/seo/public-copy';
import { priceLabel } from '@/lib/stripe/plans';
import { TRIAL_DAYS } from '@/lib/auth/membership';

async function render(live: unknown): Promise<string> {
  h.live = live;
  return renderToStaticMarkup(await Home());
}
function toText(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}
const between = (html: string, a: string, b: string) => html.slice(html.indexOf(a), b ? html.indexOf(b, html.indexOf(a)) : undefined);

// No live data (the database is unreachable in tests) and the preview fixture (HOLLER_PREVIEW_FIXTURES=1).
const NOW = new Date('2026-11-19T15:00:00.000Z');
const html = await render(NO_LIVE);
const text = toText(html);
const fixture = homeLivePreviewFixture(NOW);
const live = await render(fixture);
const liveText = toText(live);

const BANNED = [
  'delve', 'seamless', 'robust', 'comprehensive', 'holistic', 'elevate', 'unlock', 'unleash', 'empower', 'journey', 'landscape',
  'realm', 'game-changer', 'leverage', 'utilize', 'moreover', 'furthermore', 'effortless', 'supercharge', 'revolutionize',
];
const words = (m: string) => toText(m.replace(/<select[\s\S]*?<\/select>/g, ' ')).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

describe('home page, Version 3', () => {
  it('has exactly one h1 and the sections in the design order', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('<main id="main">');
    const order = ['id="top"', 'id="how"', 'id="feeds-h"', 'id="app-h"', 'id="pricing"', 'id="faq"', 'id="check"'];
    const at = order.map((s) => live.indexOf(s));
    expect(at.every((x) => x > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // Live only: the latest band and the proof strip sit between the hero and the alert card.
    const latest = live.indexOf('LATEST NEAR');
    const proof = live.indexOf('aria-label="What Holler reads"');
    expect(latest).toBeGreaterThan(live.indexOf('id="top"'));
    expect(proof).toBeGreaterThan(latest);
    expect(live.indexOf('id="how"')).toBeGreaterThan(proof);
  });

  it('headings never skip a level', () => {
    for (const page of [html, live]) {
      const levels = [...page.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      expect(levels[0]).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `h${levels[i - 1]} then h${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });

  it('two ZIP forms: plain GET to /check, one field named zip, labelled, numeric, no client script', () => {
    const forms = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect(f).toMatch(/^<form action="\/check" method="get"/);
      expect(f.match(/<input/g)).toHaveLength(1);
      expect(f.match(/name="/g)).toHaveLength(1);
      const id = /<input[^>]*id="([^"]+)"/.exec(f)![1];
      expect(f).toContain(`<label for="${id}"`);
      for (const a of ['name="zip"', 'inputMode="numeric"', 'autoComplete="postal-code"', 'maxLength="5"', 'pattern="[0-9]{5}"']) expect(f).toContain(a);
      expect(toText(f)).toContain('Check my area');
      expect(f).toMatch(/<button type="submit"/);
    }
    expect(html.match(/<script(?![^>]*application\/ld\+json)/g)).toBeNull();
  });

  it('prices, trial and limits come from the plan files; both plans; no "Starter"', () => {
    for (const p of [priceLabel('starter', 'monthly'), priceLabel('pro', 'monthly'), priceLabel('starter', 'annual'), priceLabel('pro', 'annual')]) {
      expect(text).toContain(p);
    }
    expect(text).toContain(`From ${priceLabel('starter', 'monthly')} a month after ${TRIAL_DAYS} days free. No card.`);
    expect(text).toContain(`${TRIAL_DAYS} days free. Then a flat monthly price.`);
    expect(text).not.toContain('Starter');
    expect(html).toContain('aria-label="Plans"');
    expect(html.match(/data-price=""/g)?.length).toBe(4);
    // Both cards say push comes with the app; alerts by email today.
    expect(text.split('Push arrives with the app.').length - 1).toBe(2);
    expect(text).toContain('Until then, alerts come by email.');
    expect(text).toContain('THE APP · COMING SOON');
  });

  it('no endorsement wording, no banned words, no em dashes, no invented proof', () => {
    for (const t of [text, liveText]) {
      expect(t.replace(/not affiliated with or endorsed by any government agency/g, '')).not.toMatch(/trusted by|partner|as seen in|endorsed/i);
      for (const w of BANNED) expect(t.toLowerCase(), w).not.toMatch(new RegExp(`\\b${w}\\b`));
      expect(t).not.toMatch(/testimonial|\d+\s*(customers|businesses use)|★/i);
    }
    expect(html + live).not.toContain('—');
  });

  it('is short: at most 600 words with nav and footer, live or not', () => {
    const n = { noData: words(html), live: words(live) };
    console.log(JSON.stringify({ words: n }));
    expect(n.live).toBeLessThanOrEqual(600);
    expect(n.noData).toBeLessThanOrEqual(600);
  });

  it('FAQ: the four questions, open, and the visible text equals the FAQPage JSON-LD exactly', () => {
    const faq = between(html, 'id="faq"', 'id="check"');
    const qs = [...faq.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => toText(m[1]).trim());
    const as = [...faq.matchAll(/<h3[^>]*>[^<]+<\/h3><p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => toText(m[1]).trim());
    expect(qs).toEqual(['Is this a lead list?', 'Where does it come from?', 'How do alerts reach me?', 'Does it cover my area?']);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(qs);
    expect(ld.mainEntity.map((q: { acceptedAnswer: { text: string } }) => q.acceptedAnswer.text)).toEqual(as);
    expect(homeCopy().faqs.map((f) => f.q)).toEqual(qs);
    for (const href of ['/faq', '/guides', '/data']) expect(faq).toContain(`href="${href}"`);
  });

  it('internal links: /check, /pricing, /signup, /faq, /guides, /data and at least six /for/<id> pages', () => {
    for (const href of ['/check', '/pricing', '/signup', '/faq', '/guides', '/data']) expect(html, href).toMatch(new RegExp(`(href|action)="${href}"`));
    const forLinks = new Set([...html.matchAll(/href="(\/for\/[a-z-]+)"/g)].map((m) => m[1]));
    expect(forLinks.size).toBeGreaterThanOrEqual(6);
    for (const id of ['roofing', 'plumbing', 'hvac', 'tree-service']) expect(forLinks).toContain(`/for/${id}`);
  });
});

describe('no live data', () => {
  it('draws the example map, labelled, with no dates and no source link; no proof strip, no latest band, no ledger example lines', () => {
    expect(text).toContain('Example alerts around a Chicago ZIP code. Not live data. Distances to scale, directions not.');
    expect(html).toContain('aria-label="Map of example alerts around ZIP 60614, Chicago, not live data:');
    expect(text).not.toContain('Real alerts');
    expect(html).not.toContain('LATEST NEAR');
    expect(html).not.toContain('What Holler reads');
    expect(text).not.toMatch(/FROM HOLLER'S OWN RECORDS/i);
    expect(html).not.toContain('<time');
    // The example alert card says so, and its source button is a label, not a link.
    const card = between(html, 'id="how"', 'id="feeds-h"');
    expect(toText(card)).toContain('EXAMPLE');
    expect(card).not.toMatch(/<a [^>]*href="http/);
    expect(toText(card)).toContain('Open the source record');
    // Ledger: no example lines without data.
    expect(toText(between(html, 'id="feeds-h"', 'id="app-h"'))).not.toContain('EXAMPLE');
    expect(html).toContain('aria-label="Preview of the Holler app, with example records:');
  });
});

describe('live data (preview fixture)', () => {
  it('real map with computed Chicago dates, latest band from the newest picked record, proof strip from the stats', () => {
    const m = fixture.map!;
    expect(liveText).toMatch(/Real alerts around ZIP 60614, Chicago, [A-Z][a-z]{2} \d{1,2}( to ([A-Z][a-z]{2} )?\d{1,2})?\. Distances to scale, directions not\./);
    expect(live).toContain('aria-label="Map of real alerts from ');
    const newest = [...m.records].sort((a, b) => Date.parse(b.occurredAt!) - Date.parse(a.occurredAt!))[0];
    const band = toText(between(live, 'LATEST NEAR', '</p>'));
    expect(band).toContain(`${newest.label} · ${newest.mi.toFixed(1)} MI · `);
    const proof = toText(between(live, 'aria-label="What Holler reads"', '</section>'));
    expect(proof).toContain(fixture.proof!.total7.toLocaleString('en-US'));
    expect(proof).toContain(`${fixture.proof!.feeds} city, county and weather feeds`);
    expect(proof).toContain('1 TAP to the official record, on every alert');
    expect(proof).toMatch(/FROM HOLLER'S OWN RECORDS, [A-Z][a-z]{2} \d{1,2}, \d{4}/i);
    // Every dot on the map is a picked record, labelled with its distance.
    for (const r of m.records) expect(live).toContain(`${r.label} ${r.mi.toFixed(1)} MI`);
  });

  it('the alert card links to the record source in a safe way; ledger rows show real examples with dates', () => {
    const card = between(live, 'id="how"', 'id="feeds-h"');
    expect(card).toMatch(/<a href="https:\/\/[^"]+" rel="noopener noreferrer"/);
    expect(toText(card)).not.toMatch(/\bEXAMPLE\b/);
    const ledger = toText(between(live, 'id="feeds-h"', 'id="app-h"'));
    expect(ledger.match(/EXAMPLE · [A-Z]{3} \d{1,2}/g)?.length).toBe(3);
    expect(ledger).toContain(fixture.weather!.title);
    expect(live).toContain('aria-label="Preview of the Holler app: a push saying New alert near Chicago,');
  });
});

describe('source rules', () => {
  const files = ['app/page.tsx', ...readdirSync(new URL('../../components/home', import.meta.url)).map((f) => `components/home/${f}`)];
  const src = files.map((f) => [f, readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')] as const);

  it('no "use client" in the home page or its components', () => {
    for (const [f, s] of src) expect(s, f).not.toMatch(/['"]use client['"]/);
  });

  it('no literal price, limit, trial length, count or date in app/page.tsx or components/home (60614 lives in lib/seo/home-map.ts)', () => {
    for (const [f, s] of src) {
      const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(code, f).not.toMatch(/\$\d/);
      expect(code, f).not.toMatch(/\b\d+\s*(days?|trades?|areas?|keyword|feeds|records)\b/i);
      expect(code, f).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d/);
      expect(code, f).not.toMatch(/\b20\d\d\b/);
      expect(code, f).not.toMatch(/\b(13,000|12,840|49|60614)\b/);
      expect(code, f).not.toMatch(/\byesterday\b|\bdays? ago\b/i);
    }
  });
});
