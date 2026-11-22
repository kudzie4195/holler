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
import { TRIAL_HEADLINE } from '@/lib/plan/price-copy';
import { PUSH_INTERVAL_MS } from '@/lib/push/notify';
import { PUSH_CAP, capPhrase } from '@/lib/seo/home-cadence';
import { tidyInches } from '@/components/home/select';
import { planShortParts } from '@/components/pricing';
import { tradeEntry, tradePath } from '@/lib/seo/trade-view';
import { env } from '@/lib/env';

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
const count = (m: string) => toText(m).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/** Removes each element that starts at a match of `open` (a start tag), with everything inside it, by tag balance. */
function dropElements(m: string, open: RegExp): string {
  let out = m;
  for (;;) {
    const hit = open.exec(out);
    if (!hit) return out;
    const tag = /^<([a-z0-9]+)/.exec(hit[0])![1];
    const re = new RegExp(`<(/?)${tag}(?=[\\s>])[^>]*>`, 'g');
    re.lastIndex = hit.index;
    let depth = 0;
    let end = out.length;
    for (let t = re.exec(out); t; t = re.exec(out)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    out = out.slice(0, hit.index) + ' ' + out.slice(end);
  }
}

/**
 * Every word a sighted visitor sees on a wide screen, nav and footer included, the map labels and the phone's cards included
 * (commander decision 6, round 9 fix wave). Left out, and only these:
 *  - the numbered key under the map, which replaces the map labels only under 520 px (never both on one screen);
 *  - visually hidden text (sr-only: the skip link and the ZIP field labels).
 * Attribute text (aria-label, alt) is never counted. rawWords below counts every word in the markup, for the report.
 */
function words(m: string): number {
  let v = dropElements(m, /<ol class="hm-key[^"]*"[^>]*>/);
  v = dropElements(v, /<(label|a|span)[^>]*class="sr-only[^"]*"[^>]*>/);
  return count(v);
}

describe('home page, Version 3', () => {
  it('has exactly one h1 and the sections in the design order', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toMatch(/<main id="main"[ >]/);
    expect(html.match(/<main[ >]/g)).toHaveLength(1);
    const order = ['id="top"', 'id="how"', 'id="feeds-h"', 'id="app-h"', 'id="pricing"', 'id="faq"', 'id="check"'];
    const at = order.map((s) => live.indexOf(s));
    expect(at.every((x) => x > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // Live only: the newest-on-the-map band and the proof strip sit between the hero and the alert card.
    const latest = live.indexOf('NEWEST ON THE MAP');
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
      expect(f).toMatch(/^<form [^>]*action="\/check"/);
      expect(f).toMatch(/^<form [^>]*method="get"/);
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
    expect(text).toContain(`From ${priceLabel('starter', 'monthly')}/mo after ${TRIAL_HEADLINE}. No card.`);
    expect(text).toContain('after 2 months free. No card.'); // round 18: the headline form of the 60-day trial
    expect(text).toContain(`${TRIAL_HEADLINE}. Then a flat monthly price.`);
    expect(text).not.toContain('Starter');
    expect(html).toContain('aria-label="Plans"');
    expect(html.match(/data-price="/g)?.length).toBe(4);
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

  it('is short: every visible word, nav and footer included: at most 700 with live data and 620 without', () => {
    const n = { noData: words(html), live: words(live), rawNoData: count(html), rawLive: count(live) };
    console.log(JSON.stringify({ words: n }));
    expect(n.live).toBeLessThanOrEqual(700);
    expect(n.noData).toBeLessThanOrEqual(620);
  });

  it('every optional key set (search, Bluesky, SAM.gov, Ticketmaster): still at most 700 and 620 words, and the FAQ text equals its JSON-LD', async () => {
    const OPTIONAL = ['BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD', 'SAM_API_KEY', 'TICKETMASTER_API_KEY'] as const;
    const saved = OPTIONAL.map((k) => env[k]);
    for (const k of OPTIONAL) env[k] = 'set-in-test';
    try {
      expect(homeCopy().metaDescription).toContain('and local posts'); // the keys really are on for this render
      const keyedNoData = await render(NO_LIVE);
      const keyedLive = await render(fixture);
      const n = { noData: words(keyedNoData), live: words(keyedLive) };
      console.log(JSON.stringify({ wordsAllKeys: n }));
      expect(n.live).toBeLessThanOrEqual(700);
      expect(n.noData).toBeLessThanOrEqual(620);
      for (const page of [keyedNoData, keyedLive]) {
        const faq = between(page, 'id="faq"', 'id="check"');
        const qs = [...faq.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => toText(m[1]).trim());
        const as = [...faq.matchAll(/<h3[^>]*>[^<]+<\/h3><p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => toText(m[1]).trim());
        const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
        expect(ld['@type']).toBe('FAQPage');
        expect(qs).toHaveLength(4);
        expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(qs);
        expect(ld.mainEntity.map((q: { acceptedAnswer: { text: string } }) => q.acceptedAnswer.text)).toEqual(as);
        // The people-asking sentences are on /faq only.
        expect(toText(faq)).not.toMatch(/asking online|Bluesky|licensed search|draft reply/i);
      }
    } finally {
      OPTIONAL.forEach((k, i) => (env[k] = saved[i]));
    }
  });

  it('the word count sees the map labels and the phone cards (they are not dropped as pictures)', () => {
    const map = homeLivePreviewFixture(NOW).map!;
    const withPictures = words(live);
    const v = dropElements(dropElements(live, /<div role="img"[^>]*>/), /<ol class="hm-key[^"]*"[^>]*>/);
    expect(withPictures).toBeGreaterThan(count(dropElements(v, /<(label|a|span)[^>]*class="sr-only[^"]*"[^>]*>/)) + map.records.length * 3);
  });

  it('honest about the link: never "official record", "its record" or "source record"; the link goes to the public source', () => {
    for (const t of [text, liveText]) {
      expect(t).not.toMatch(/official record|its record|source record/i);
      expect(t).not.toMatch(/Real alerts|LATEST NEAR/);
    }
    expect(text).toContain('Each one links to its public source.');
    expect(text).toContain('Each alert links to its source.');
    expect(toText(between(live, 'id="how"', 'id="feeds-h"'))).toContain('Open the source');
    expect(toText(between(live, 'id="how"', 'id="feeds-h"'))).toContain('The source One tap to the city or weather service page it came from.');
  });

  it('the push cap is built from the constant the push sender uses', () => {
    expect(PUSH_CAP).toBe(capPhrase(PUSH_INTERVAL_MS));
    expect(capPhrase(3_600_000)).toBe('one an hour');
    expect(capPhrase(7_200_000)).toBe('one every 2 hours');
    expect(capPhrase(1_800_000)).toBe('one every 30 minutes');
    expect(text).toContain(`At most ${PUSH_CAP}, only for your trades and your radius.`);
    expect(text).toContain(`push will be capped at ${PUSH_CAP}.`);
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
    // "below" means nothing in the JSON-LD.
    expect(as.join(' ')).not.toMatch(/\bbelow\b/);
    expect(as[3]).toContain('Check your ZIP to see.');
  });

  it('internal links: /check, /pricing, /signup, /faq, /guides, /data, /for and at least nine /for/<id> pages inside <main>', () => {
    for (const page of [html, live]) {
      for (const href of ['/check', '/pricing', '/signup', '/faq', '/guides', '/data', '/for']) expect(page, href).toMatch(new RegExp(`(href|action)="${href}"`));
      const ledger = between(page, 'id="feeds-h"', 'id="app-h"');
      // The ledger sentences name trades as plain text: no link anywhere in the rows.
      const rows = ledger.slice(0, ledger.indexOf('<nav'));
      expect(rows).toContain('Good for');
      expect(rows).not.toMatch(/<a[\s>]/);
      // One quiet index under the rows: "FIND YOUR TRADE", then the page of every trade the sentences name, once each, in the
      // order named, then "All trades" to /for.
      const nav = ledger.slice(ledger.indexOf('<nav'), ledger.indexOf('</nav>') + 6);
      expect(nav).toMatch(/^<nav aria-labelledby="trades-h"/);
      expect(nav).toContain('<p id="trades-h" class="eyebrow m-0">FIND YOUR TRADE</p>');
      const named = homeCopy().families.flatMap((f) => f.goodFor).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i && tradeEntry(t.id));
      const links = [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
      expect(links).toEqual([...named.map((t) => [tradePath(t.id), `${t.label.charAt(0).toUpperCase()}${t.label.slice(1)}`]), ['/for', 'All trades']]);
      for (const a of nav.match(/<a [^>]*>/g)!) expect(a).toMatch(/class="h-link [^"]*text-brand-text[^"]*hover:underline[^"]*focus-visible:underline/);
      expect(nav).not.toMatch(/border|rounded|bg-/);
      expect(toText(ledger)).not.toContain('See all trades');
      // Inside <main>, not counting the footer: at least nine distinct trade pages.
      const main = between(page, '<main', '</main>');
      const forLinks = new Set([...main.matchAll(/href="(\/for\/[a-z-]+)"/g)].map((m) => m[1]));
      expect(forLinks.size).toBeGreaterThanOrEqual(9);
      for (const id of ['roofing', 'plumbing', 'hvac', 'tree-service', 'auto-glass', 'handyman', 'junk-removal', 'pest-control', 'windows-doors']) {
        expect(forLinks).toContain(`/for/${id}`);
      }
    }
  });

  it('the plan limits on the short cards are separate pieces with no separator dot', () => {
    const plans = between(html, 'aria-label="Plans"', '</ul>');
    for (const tier of ['starter', 'pro'] as const) {
      const parts = planShortParts(tier);
      expect(parts).toHaveLength(3);
      expect(plans).toContain(`<p class="flex flex-wrap gap-x-4 text-[1.0625rem]">${parts.map((p) => `<span class="max-w-full">${p}</span>`).join('')}</p>`);
    }
    expect(toText(plans)).not.toContain('·');
  });
});

describe('no live data', () => {
  it('draws the example map, labelled, with no dates and no source link; no proof strip, no latest band, no ledger example lines', () => {
    expect(text).toContain('Example records around a Chicago ZIP code. Not live data. Distances to scale, directions not.');
    expect(html).toContain('aria-label="Map of example records around ZIP 60614, Chicago, not live data:');
    expect(text).not.toContain('Real records');
    expect(html).not.toContain('NEWEST ON THE MAP');
    expect(html).not.toContain('What Holler reads');
    expect(text).not.toMatch(/HOLLER'S OWN (RECORDS|DATA)/i);
    expect(html).not.toContain('<time');
    // The example alert card says so, and has no source link and no fake button: a plain line says what the link would be.
    const card = between(html, 'id="how"', 'id="feeds-h"');
    expect(toText(card)).toContain('EXAMPLE');
    expect(card).not.toMatch(/<a [^>]*href="http/);
    expect(toText(card)).toContain('Each alert links to its source');
    expect(card).not.toContain('border-dashed');
    // Ledger: no example lines without data.
    expect(toText(between(html, 'id="feeds-h"', 'id="app-h"'))).not.toContain('EXAMPLE');
    expect(html).toContain('aria-label="Preview of the Holler app, with example records:');
    // A sighted visitor sees it too: an EXAMPLE tag in the app band, outside the picture.
    const band = between(html, 'id="app-h"', 'id="pricing"');
    expect(dropElements(band, /<div role="img"[^>]*>/)).toMatch(/>EXAMPLE</);
  });
});

describe('live data (preview fixture)', () => {
  it('real map with computed Chicago dates, latest band from the newest picked record, proof strip from the stats', () => {
    const m = fixture.map!;
    expect(liveText).toMatch(/Real records around ZIP 60614, Chicago, [A-Z][a-z]{2} \d{1,2}( to ([A-Z][a-z]{2} )?\d{1,2})?\. Distances to scale, directions not\./);
    expect(live).toContain('aria-label="Map of real records from ');
    const newest = [...m.records].sort((a, b) => Date.parse(b.occurredAt!) - Date.parse(a.occurredAt!))[0];
    const band = toText(between(live, 'NEWEST ON THE MAP', '</p>'));
    // Label, distance and date are separate pieces with no separator dot, so no line ends on a hanging "·".
    expect(band).toMatch(new RegExp(`^ ?NEWEST ON THE MAP ${newest.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${newest.mi.toFixed(1)} MI [A-Z]{3} \\d{1,2}\\s*$`));
    expect(band).not.toContain('·');
    const proof = toText(between(live, 'aria-label="What Holler reads"', '</section>'));
    expect(proof).toContain(`records dated in the last 7 days ${fixture.proof!.total7.toLocaleString('en-US')}`);
    expect(proof).toContain(`city, county and weather feeds checked ${fixture.proof!.feeds}`);
    expect(proof).toContain('to the public source, on every record alert 1 TAP');
    expect(proof).toMatch(/RECORD COUNT FROM HOLLER'S OWN DATA, [A-Z][a-z]{2} \d{1,2}, \d{4}/i);
    // Every dot on the map is a picked record, labelled with its distance.
    for (const r of m.records) expect(live).toContain(`${r.label} ${r.mi.toFixed(1)} MI`);
  });

  it('the alert card links to the record source in a safe way; ledger rows show real examples with dates', () => {
    const card = between(live, 'id="how"', 'id="feeds-h"');
    expect(card).toMatch(/<a href="https:\/\/[^"]+" rel="noopener noreferrer"/);
    expect(toText(card)).not.toMatch(/\bEXAMPLE\b/);
    const ledger = toText(between(live, 'id="feeds-h"', 'id="app-h"'));
    expect(ledger.match(/EXAMPLE · [A-Z]{3} \d{1,2}/g)?.length).toBe(3);
    // "1.00 inch hail" is shown as "1 inch hail".
    expect(fixture.weather!.title).toContain('1.00 inch');
    expect(ledger).toContain(tidyInches(fixture.weather!.title));
    expect(ledger).not.toContain('1.00 inch');
    expect(live).toContain('aria-label="Preview of the Holler app: a push saying New alert near Chicago,');
    // The picture's label names the three cards a sighted visitor sees, and no EXAMPLE tag is shown with live data.
    const aria = /aria-label="(Preview of the Holler app[^"]*)"/.exec(live)![1];
    const cardTitles = [...between(live, 'id="app-h"', 'id="pricing"').matchAll(/<span class="line-clamp-2 text-base[^"]*">([^<]+)<\/span>/g)].map((x) => x[1]);
    expect(cardTitles).toHaveLength(3);
    for (const t of cardTitles) expect(aria).toContain(t);
    expect(dropElements(between(live, 'id="app-h"', 'id="pricing"'), /<div role="img"[^>]*>/)).not.toMatch(/>EXAMPLE</);
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

  it('the round 9 gate grep finds nothing, comments included', () => {
    const gate = /\$[0-9]+(\.[0-9]{2})?|14[ -]day|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* [0-9]{1,2}\b|yesterday|days ago/;
    const pricing = ['components/pricing.tsx', readFileSync(new URL('../../components/pricing.tsx', import.meta.url), 'utf8')] as const;
    for (const [f, s] of [...src, pricing]) {
      s.split('\n').forEach((line, i) => expect(line, `${f}:${i + 1}`).not.toMatch(gate));
    }
  });

  it('no text under 13 px: no 12 px or smaller size anywhere in the home page files', () => {
    const pricing = ['components/pricing.tsx', readFileSync(new URL('../../components/pricing.tsx', import.meta.url), 'utf8')] as const;
    for (const [f, s] of [...src, pricing]) {
      for (const m of s.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]|font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        const px = m[3] ? Number(m[3]) : m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
        expect(px, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(13);
      }
      expect(s, f).not.toMatch(/\btext-(xs|\[1[0-2]px\])\b/);
    }
  });
});
