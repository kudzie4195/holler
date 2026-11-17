// Render the real page functions (nav, footer and cards replaced by plain shells) and check what a crawler would read:
// one h1, the direct answer right under it, the last reviewed date, the FAQ questions in the body, links, and the copy measures
// on the visible text of the whole page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NationalStats } from '@/lib/seo/national-data';

const h = vi.hoisted(() => ({ stats: null as unknown }));
vi.mock('@/components', () => ({
  TopNav: () => null,
  Footer: () => null,
  Card: ({ children, as: Tag = 'div' }: { children: ReactNode; as?: string }) => createElement(Tag, null, children),
  Notice: ({ children }: { children: ReactNode }) => createElement('div', { role: 'status' }, children),
}));
vi.mock('@/lib/seo/national-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/national-data')>()),
  loadNationalStats: async () => h.stats,
}));

import { GUIDES } from '@/lib/seo/guides';
import { FAQ_ITEMS } from '@/lib/seo/faq';
import { DATA_META, FAQ_META, GUIDES_HUB_META, guideMeta } from '@/lib/seo/guides/seo';
import GuidePage, * as guideModule from '@/app/guides/[slug]/page';
import HubPage, * as hubModule from '@/app/guides/page';
import FaqPage, * as faqModule from '@/app/faq/page';
import DataPage, * as dataModule from '@/app/data/page';
import { bannedHits, hasEmDash } from './helpers/copy-metrics';

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/(p|li|h1|h2|h3|dt|dd|th|td|time)>/g, '.\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

/** Same rule the copy script uses: sentences end at . ! ? followed by space; words are whitespace tokens. */
function pageStats(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
  const lens = sentences.map((s) => s.split(/\s+/).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return { mean, short: lens.filter((n) => n < 8).length / lens.length, cv: sd / mean };
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const GOOD: NationalStats = {
  ok: true,
  asOf: '2026-11-17T12:00:00.000Z',
  newestAt: '2026-11-17T11:42:00.000Z',
  total7: 1234,
  total30: 5678,
  kinds: [
    { id: 'alert', label: 'Weather alerts', last7: 100, last30: 400 },
    { id: 'other', label: 'Other records', last7: 5, last30: 9 },
  ],
  citiesActive30: 37,
  topCities: [
    { slug: 'chicago-il', name: 'Chicago', state: 'IL', path: '/local/illinois/chicago-il', last30: 900 },
    { slug: 'nowhere-xx', name: 'Nowhere', state: null, path: null, last30: 20 },
  ],
  topTrades: [{ id: 'roofing', label: 'Roofing', count: 321 }],
  sampleSize: 1000,
  sourcesSeen: 12,
};

beforeEach(() => {
  h.stats = GOOD;
});

async function renderGuide(slug: string) {
  const el = await GuidePage({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(el);
}

describe.each(GUIDES.map((g) => [g.slug, g] as const))('rendered guide %s', (slug, g) => {
  it('has one h1, then the direct answer, then the last reviewed date, all before the first h2', async () => {
    const html = await renderGuide(slug);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const h1 = html.indexOf('<h1');
    const answer = html.indexOf(g.directAnswer);
    const reviewed = html.indexOf('Last reviewed');
    const firstH2 = html.indexOf('<h2');
    expect(h1).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(h1);
    expect(reviewed).toBeGreaterThan(answer);
    expect(firstH2).toBeGreaterThan(reviewed);
    expect(html).toContain('November 17, 2026');
    expect(html).toContain('dateTime="2026-11-17"');
  });

  it('shows every section heading, every FAQ question and answer, and the related links', async () => {
    const html = await renderGuide(slug);
    const text = toText(html);
    for (const s of g.sections) expect(html).toContain(s.heading);
    expect(html).toContain('How Holler helps');
    for (const f of g.faq) {
      expect(text).toContain(f.q);
      expect(text).toContain(f.a);
    }
    for (const r of g.related) expect(html).toContain(`href="${r.href}"`);
  });

  it('external links open the official source with rel=noopener', async () => {
    const html = await renderGuide(slug);
    const ext = html.match(/<a [^>]*href="https:[^>]*>/g) ?? [];
    expect(ext.length).toBeGreaterThanOrEqual(3);
    for (const a of ext) expect(a).toContain('rel="noopener"');
  });

  it('embeds Article, BreadcrumbList and FAQPage JSON-LD that parses', async () => {
    const html = await renderGuide(slug);
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse(m![1].replace(/\\u003c/g, '<')) as { '@type': string }[];
    expect(data.map((d) => d['@type']).sort()).toEqual(['Article', 'BreadcrumbList', 'FAQPage']);
  });

  it('page text: mean <= 22, >= 12% short sentences, stdev/mean >= 0.55, no banned word, no em dash', async () => {
    const text = toText(await renderGuide(slug));
    const st = pageStats(text);
    expect(st.mean, 'mean').toBeLessThanOrEqual(22);
    expect(st.short, 'short').toBeGreaterThanOrEqual(0.12);
    expect(st.cv, 'cv').toBeGreaterThanOrEqual(0.55);
    expect(bannedHits(text)).toEqual([]);
    expect(hasEmDash(text)).toBe(false);
  });

  it('its metadata sets the title, description and canonical', async () => {
    const meta = await guideModule.generateMetadata({ params: Promise.resolve({ slug }) });
    const m = guideMeta(g);
    expect(meta.title).toEqual({ absolute: m.title });
    expect(meta.description).toBe(m.description);
    expect(String(meta.alternates?.canonical)).toMatch(new RegExp(`${m.path}$`));
  });
});

describe('guide page: unknown slug', () => {
  it('calls notFound (a 404) and noindexes its metadata', async () => {
    await expect(GuidePage({ params: Promise.resolve({ slug: 'does-not-exist' }) })).rejects.toThrow();
    const meta = await guideModule.generateMetadata({ params: Promise.resolve({ slug: 'does-not-exist' }) });
    expect(meta.robots).toEqual({ index: false });
  });
  it('is statically generated for exactly the 8 slugs', () => {
    expect(guideModule.generateStaticParams().map((p) => p.slug)).toEqual(GUIDES.map((g) => g.slug));
  });
});

describe('rendered hub', () => {
  it('has one h1, lists all 8 guides with links and dates, sets title, description and canonical', () => {
    const html = renderToStaticMarkup(createElement(HubPage));
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    for (const g of GUIDES) {
      expect(html).toContain(`href="/guides/${g.slug}"`);
      expect(html).toContain(g.title);
    }
    expect(count(html, /Last reviewed/g)).toBe(8);
    const meta = hubModule.generateMetadata();
    expect(meta.title).toEqual({ absolute: GUIDES_HUB_META.title });
    expect(meta.description).toBe(GUIDES_HUB_META.description);
    expect(String(meta.alternates?.canonical)).toMatch(/\/guides$/);
  });
});

describe('rendered FAQ', () => {
  it('has one h1, 4 groups, every question and answer, FAQPage JSON-LD equal to the visible text', () => {
    const html = renderToStaticMarkup(createElement(FaqPage));
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(count(html, /<h2[\s>]/g)).toBe(4);
    const text = toText(html);
    for (const i of FAQ_ITEMS) {
      expect(text).toContain(i.q);
      expect(text).toContain(i.a);
    }
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)!;
    const faq = m.flatMap((s) => JSON.parse(s.replace(/<\/?script[^>]*>/g, '').replace(/\\u003c/g, '<'))).find((d: { '@type': string }) => d['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text])).toEqual(
      FAQ_ITEMS.map((i) => [i.q, i.a]),
    );
  });
  it('page text passes the copy measures; metadata is set', () => {
    const text = toText(renderToStaticMarkup(createElement(FaqPage)));
    const st = pageStats(text);
    expect(st.mean).toBeLessThanOrEqual(22);
    expect(st.short).toBeGreaterThanOrEqual(0.12);
    expect(st.cv).toBeGreaterThanOrEqual(0.55);
    expect(bannedHits(text)).toEqual([]);
    expect(hasEmDash(text)).toBe(false);
    const meta = faqModule.generateMetadata();
    expect(meta.title).toEqual({ absolute: FAQ_META.title });
    expect(String(meta.alternates?.canonical)).toMatch(/\/faq$/);
  });
});

describe('rendered /data', () => {
  const render = async () => renderToStaticMarkup(await DataPage());

  it('shows every block when there is data, with a real "Updated" time and one h1', async () => {
    const html = await render();
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    const text = toText(html);
    expect(text).toContain('Updated');
    expect(html).toContain('dateTime="2026-11-17T11:42:00.000Z"');
    expect(text).toContain('Nov 17, 11:42 UTC');
    for (const heading of ['How many records did Holler read?', 'Records by type', 'Top cities by records in 30 days', 'Trades with the most matched records', 'How many sources delivered data?'])
      expect(text).toContain(heading);
    expect(text).toContain('5,678');
    expect(html).toContain('href="/local/illinois/chicago-il"');
    expect(html).toContain('href="/for/roofing"');
    expect(text).toMatch(/counts show what Holler read, not all\s+local activity/);
    expect(text).toMatch(/Cities rank higher when their government publishes open data/);
    expect(text).not.toMatch(/unavailable/i);
  });

  it('leaves out blocks that have no data', async () => {
    h.stats = { ...GOOD, kinds: [], topCities: [], topTrades: [], sourcesSeen: 0, citiesActive30: null };
    const text = toText(await render());
    expect(text).toContain('How many records did Holler read?');
    expect(text).not.toContain('Records by type');
    expect(text).not.toContain('Top cities');
    expect(text).not.toContain('Trades with the most');
    expect(text).not.toContain('sources delivered');
    expect(text).not.toContain('Cities with a record in 30 days');
  });

  it('with an empty database says there is nothing to count and shows no tables', async () => {
    h.stats = { ...GOOD, total7: 0, total30: 0, kinds: [], topCities: [], topTrades: [], sourcesSeen: 0, newestAt: null, citiesActive30: 0, sampleSize: 0 };
    const html = await render();
    expect(toText(html)).toContain('nothing to count yet');
    expect(html).not.toContain('<table');
    expect(toText(html)).not.toContain('Updated');
  });

  it('a database failure renders the page with a short note, never an error', async () => {
    h.stats = { ok: false, asOf: '2026-11-17T12:00:00.000Z', newestAt: null, total7: 0, total30: 0, kinds: [], citiesActive30: null, topCities: [], topTrades: [], sampleSize: 0, sourcesSeen: 0 };
    const html = await render();
    expect(count(html, /<h1[\s>]/g)).toBe(1);
    expect(toText(html)).toContain('The numbers are unavailable right now.');
    expect(html).not.toContain('<table');
    const meta = dataModule.generateMetadata();
    expect(meta.title).toEqual({ absolute: DATA_META.title });
    expect(String(meta.alternates?.canonical)).toMatch(/\/data$/);
  });

  it('page text passes the copy measures when there is data', async () => {
    const text = toText(await render());
    const st = pageStats(text);
    expect(st.mean).toBeLessThanOrEqual(22);
    expect(st.short).toBeGreaterThanOrEqual(0.12);
    expect(bannedHits(text)).toEqual([]);
    expect(hasEmDash(text)).toBe(false);
  });
});
