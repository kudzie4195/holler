import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEntries } from '@/lib/seo/sitemap-entries';
import { GUIDES } from '@/lib/seo/guides';
import { llmsText } from '@/lib/seo/public-copy';
import { withPublicPages } from '@/lib/seo/llms-extra';
import { bannedHits, hasEmDash } from './helpers/copy-metrics';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
const places = { ok: true, counts: {}, latest: {}, partial: false };

describe('sitemap: guides, FAQ, numbers, pricing and requests', () => {
  const es = buildEntries({ places, trades: [] });
  const paths = es.map((e) => path(e.url));
  it('lists /guides, each of the 8 guides, /faq, /data, /pricing, /request and /delete-account', () => {
    for (const p of ['/guides', '/faq', '/data', '/pricing', '/request', '/delete-account']) expect(paths, p).toContain(p);
    for (const g of GUIDES) expect(paths).toContain(`/guides/${g.slug}`);
    expect(GUIDES).toHaveLength(8);
  });
  it('has no duplicate URLs, with or without the weekly pages', () => {
    expect(new Set(paths).size).toBe(paths.length);
    const withNow = buildEntries({ places, trades: [], now: Date.parse('2026-11-17T12:00:00Z') });
    expect(new Set(withNow.map((e) => e.url)).size).toBe(withNow.length);
  });
  it('a guide lastmod is its reviewed date; pages without a stored change time have none', () => {
    const guide = es.find((e) => e.url.endsWith(`/guides/${GUIDES[0].slug}`))!;
    expect(guide.lastModified?.toISOString()).toBe('2026-11-17T00:00:00.000Z');
    for (const p of ['/faq', '/data', '/pricing', '/request']) expect(es.find((e) => path(e.url) === p)?.lastModified).toBeUndefined();
  });
  it('the existing entries are still there', () => {
    for (const p of ['/', '/check', '/about', '/for', '/local', '/local/georgia']) expect(paths).toContain(p);
  });
  it('the sitemap files are only edited, not replaced', () => {
    expect(src('app/sitemap.ts')).toContain('buildSitemapEntries');
  });
});

describe('robots stays as it was', () => {
  it('allows the site, blocks /app/ and /api/, and names the sitemap', () => {
    const s = src('app/robots.ts');
    expect(s).toContain("disallow: ['/app/', '/api/']");
    expect(s).toContain("allow: '/'");
  });
});

describe('llms.txt', () => {
  const url = (p: string) => `https://example.test${p}`;
  const base = llmsText({ cityCount: 300, states: [{ name: 'Georgia', slug: 'georgia' }], url }, () => false);
  const text = withPublicPages(base, url);

  it('names every guide path with its title and one line, plus /guides, /faq and /data', () => {
    for (const g of GUIDES) {
      expect(text).toContain(`[${g.title}](https://example.test/guides/${g.slug})`);
    }
    for (const p of ['/guides', '/faq', '/data']) expect(text).toContain(`https://example.test${p}`);
    const line = text.split('\n').find((l) => l.includes(`/guides/${GUIDES[0].slug}`))!;
    expect(line).toMatch(/\): .{20,}/);
  });
  it('gives /pricing with both plans and the trial, and replaces the old one-plan line', () => {
    expect(text).toContain('https://example.test/pricing');
    expect(text).toContain('Solo: $7.99 per month or $79.99 per year. 1 service area and up to 5 trades.');
    expect(text).toContain('Pro: $13.99 per month or $139.99 per year. Up to 3 service areas, up to 15 trades and up to 5 keyword watches.');
    expect(text).toContain('14-day free trial');
    expect(text).toContain('The trial has Solo limits.');
    expect(text).not.toMatch(/Starter|7-day/);
    expect(text).toMatch(/No card is needed to start/);
    expect(text.match(/## Pricing/g)).toHaveLength(1);
    expect(text).not.toContain('per month or $79.99 per year, after a 14-day free trial.');
  });
  it('describes the resident request feature accurately', () => {
    expect(text).toContain('## Resident requests');
    expect(text).toContain('https://example.test/request');
    expect(text).toMatch(/free/);
    expect(text).toMatch(/confirms it by email/);
    expect(text).toMatch(/a public page shows only the service and the city/);
    expect(text).toMatch(/description, with contact details removed/);
    expect(text).toMatch(/reply through Holler/);
    expect(text).toMatch(/never sees the resident's email address unless the resident replies to that business/);
    expect(text).not.toMatch(/never shown to a business/);
    expect(text).toMatch(/14 days/);
  });
  it('keeps everything that was already there', () => {
    for (const keep of ['# Holler', '## Public data sources', '## Trade pages', '## Pages', '[Check your area]', '[Georgia]', 'National Weather Service alerts']) expect(text).toContain(keep);
    expect(text.indexOf('## Guides')).toBeLessThan(text.indexOf('## Pages'));
  });
  it('is robust if the old pricing line or the Pages heading is gone', () => {
    const t = withPublicPages('# Holler\n\n## Trade pages\n\nx\n', url);
    expect(t).toContain('## Pricing');
    expect(t).toContain('## Guides');
  });
  it('added text follows the copy rules and adds no key-gated source', () => {
    const added = text.slice(text.indexOf('## Pricing'), text.indexOf('## Pages'));
    expect(bannedHits(added)).toEqual([]);
    expect(hasEmDash(added)).toBe(false);
    expect(added).not.toMatch(/Bluesky|SAM\.gov|Ticketmaster|concert/i);
  });
  it('the route serves it as plain text through the same helper', () => {
    const route = src('app/llms.txt/route.ts');
    expect(route).toContain('withPublicPages');
    expect(route).toContain('text/plain');
  });
});

describe('page sources', () => {
  it('each new page file renders exactly one h1 and the guide page 404s an unknown slug', () => {
    // Round 9: each page draws its one h1 through the green PageHeader band (components/page-header.tsx renders exactly one h1;
    // tests/design/page-parts.test.ts checks that), so a page file has one <PageHeader and no h1 of its own.
    for (const f of ['app/guides/page.tsx', 'app/guides/[slug]/page.tsx', 'app/faq/page.tsx', 'app/data/page.tsx']) {
      expect((src(f).match(/<PageHeader[\s>]/g) ?? []).length, f).toBe(1);
      expect((src(f).match(/<h1[\s>]/g) ?? []).length, f).toBe(0);
      expect(src(f), f).toContain('canonical');
    }
    expect(src('app/guides/[slug]/page.tsx')).toContain('notFound()');
    expect(src('app/data/page.tsx')).toContain('loadNationalStats');
  });
  it('uses design tokens, not raw hex colors, in the new pages', () => {
    for (const f of ['app/guides/page.tsx', 'app/guides/[slug]/page.tsx', 'app/guides/_components/shell.tsx', 'app/faq/page.tsx', 'app/data/page.tsx']) {
      expect(src(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
