import { describe, expect, it } from 'vitest';
import { GUIDES, GUIDE_SLUGS, guideBySlug, guidePath, type Guide } from '@/lib/seo/guides';
import { isExternal, linksIn, stripLinks } from '@/lib/seo/guides/inline';
import { linkableTexts, sectionProse, sectionTexts } from '@/lib/seo/guides/text';
import { GUIDES_HUB_META, FAQ_META, DATA_META, guideJsonLd, guideMeta, hubJsonLd, faqPageJsonLd } from '@/lib/seo/guides/seo';
import { jsonLdString } from '@/lib/seo/jsonld';
import { FAQ_GROUPS, FAQ_ITEMS, faqItems } from '@/lib/seo/faq';
import type { EnvKey } from '@/lib/env';
import { CATEGORIES } from '@/lib/signals/categories';
import { TRADE_FACTS } from '@/lib/seo/trade-pages';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { CITY_FEEDS } from '@/lib/signals/capabilities';
import { BANNED, bannedHits, copyStats, hasEmDash, sentences, wordCount } from './helpers/copy-metrics';

const EXPECTED_SLUGS = [
  'how-contractors-find-work-from-building-permits',
  'storm-damage-leads-from-weather-alerts-and-storm-reports',
  'what-311-requests-tell-local-service-businesses',
  'free-public-data-sources-for-local-leads',
  'pay-per-lead-vs-flat-fee-alerts',
  'federal-contracts-for-small-local-businesses',
  'new-business-licenses-as-a-lead-source',
  'how-to-respond-to-a-local-lead-fast',
];

/** Every Holler route a guide may link to. Trade pages exist for each category that has trade facts. */
const KNOWN_ROUTES = new Set<string>([
  '/check', '/local', '/data', '/request', '/pricing', '/faq', '/guides', '/for', '/about',
  ...CATEGORIES.filter((c) => TRADE_FACTS[c.id]).map((c) => `/for/${c.id}`),
  ...EXPECTED_SLUGS.map((s) => `/guides/${s}`),
]);

/** Official publishers only. A guide may not cite anything outside this list. */
const OFFICIAL_HOSTS = [
  'weather.gov', 'spc.noaa.gov', 'fema.gov', 'usgs.gov', 'usaspending.gov', 'census.gov', 'nyc.gov', 'faa.gov', 'ftc.gov', 'sba.gov',
  'gsa.gov', 'acquisition.gov', 'cityofchicago.org', 'austintexas.gov', 'sf.gov', 'flsenate.gov',
];

const allText = (g: Guide) => [
  g.title, g.directAnswer, ...g.sections.flatMap((s) => [s.heading, ...sectionTexts(s)]), g.howHolerHelps,
  ...g.faq.flatMap((f) => [f.q, f.a]), ...g.related.map((r) => r.label),
];
/** The prose a reader reads as sentences: answer box, paragraphs, lists, worked examples, the Holler box and the quick answers. Table cells are figures, not sentences. */
const bodyOf = (g: Guide) => [g.directAnswer, ...g.sections.flatMap(sectionProse), g.howHolerHelps, ...g.faq.flatMap((f) => [f.q, f.a])].join('\n');
/** Everything outside "How Holler helps": where the product name is rationed. */
const outsideHelps = (g: Guide) => [g.directAnswer, ...g.sections.flatMap((s) => [s.heading, ...sectionTexts(s)]), ...g.faq.flatMap((f) => [f.q, f.a])].join('\n');
const sectionWords = (s: Guide['sections'][number]) => wordCount(stripLinks(sectionTexts(s).join('\n')));

/** Editor's list on top of the shared BANNED list: filler a reader skips. Checked on guides and the FAQ only. */
const EDITOR_BANNED = [
  'navigate', 'foster', 'boasts', 'crucial', 'vital', 'pivotal', 'key takeaway', "in today's", 'when it comes to', "it's important to",
  'it is important to', 'it is worth noting', "here's the thing", 'that said', 'at the end of the day', 'look no further', 'rest assured',
  "whether you're", 'whether you are',
];
const editorHits = (t: string) => {
  const l = t.toLowerCase().replace(/’/g, "'");
  return EDITOR_BANNED.filter((w) => new RegExp(`\\b${w.replace(/'/g, "'")}\\b`).test(l));
};
/** "A, B and C" style lists with short items: a reflex when used everywhere. Counted per 200 words. */
const TRIPLE = /\b[\w'$-]+(?: [\w'$-]+){0,2}, (?!\d{4}\b)[\w'$-]+(?: [\w'$-]+){0,2},? (?:and|or) (?!not\b)[\w'$-]+/g;
const triplesPer200 = (t: string) => ((stripLinks(t).match(TRIPLE) ?? []).length / Math.max(1, wordCount(stripLinks(t)))) * 200;
const firstWords = (t: string, n: number) => stripLinks(t).split(/\s+/).slice(0, n).join(' ').toLowerCase();

describe('guides: the set', () => {
  it('has exactly the eight slugs, in hub order, with no duplicates', () => {
    expect(GUIDE_SLUGS).toEqual(EXPECTED_SLUGS);
    expect(new Set(GUIDE_SLUGS).size).toBe(8);
  });
  it('an unknown slug has no guide (the page calls notFound)', () => {
    expect(guideBySlug('nope')).toBeUndefined();
    expect(guideBySlug(EXPECTED_SLUGS[0])?.slug).toBe(EXPECTED_SLUGS[0]);
    expect(guidePath('x')).toBe('/guides/x');
  });
  it('guides differ in structure: not all the same number of sections, and not all open the same way', () => {
    const counts = new Set(GUIDES.map((g) => g.sections.length));
    expect(counts.size).toBeGreaterThanOrEqual(3);
    // No section count is shared by more than three of the eight guides, so at least three guides differ from the rest.
    const byCount = new Map<number, number>();
    for (const g of GUIDES) byCount.set(g.sections.length, (byCount.get(g.sections.length) ?? 0) + 1);
    expect(Math.max(...byCount.values()), JSON.stringify([...byCount])).toBeLessThanOrEqual(3);
    expect(counts.size).toBeGreaterThanOrEqual(4);
    // Lists where a list helps: at least two guides, at least one of them numbered; and the number of quick answers varies.
    expect(GUIDES.filter((g) => g.sections.some((s) => s.bullets)).length).toBeGreaterThanOrEqual(2);
    expect(GUIDES.some((g) => g.sections.some((s) => s.bullets && s.ordered))).toBe(true);
    expect(new Set(GUIDES.map((g) => g.faq.length)).size).toBeGreaterThanOrEqual(2);
    // Not every guide closes with the same words.
    expect(new Set(GUIDES.map((g) => g.howHolerHelps.split(/\s+/).slice(0, 3).join(' '))).size).toBeGreaterThanOrEqual(6);
    const openers = new Set(GUIDES.map((g) => g.directAnswer.split(/\s+/).slice(0, 2).join(' ').toLowerCase()));
    expect(openers.size).toBeGreaterThanOrEqual(6);
    expect(GUIDES.some((g) => g.sections.some((s) => s.bullets))).toBe(true);
    expect(GUIDES.some((g) => g.sections.every((s) => !s.bullets))).toBe(true);
  });
  it('no two sections anywhere in the set open with the same first five words, and no two guides share a paragraph skeleton', () => {
    const openers = GUIDES.flatMap((g) => g.sections.map((s) => firstWords(s.paragraphs[0] ?? '', 5)));
    const dupes = openers.filter((o, i) => openers.indexOf(o) !== i);
    expect(dupes).toEqual([]);
    // Skeleton: paragraphs per section, plus T (table), E (worked example), O (numbered list), B (bullets).
    const skeleton = (g: Guide) => g.sections.map((s) => `${s.paragraphs.length}${s.table ? 'T' : ''}${s.example ? 'E' : ''}${s.bullets ? (s.ordered ? 'O' : 'B') : ''}`).join('-');
    expect(new Set(GUIDES.map(skeleton)).size).toBe(GUIDES.length);
    // Not every section is three paragraphs: the old one-shape-fits-all layout.
    const threeParas = GUIDES.flatMap((g) => g.sections).filter((s) => s.paragraphs.length === 3 && !s.table && !s.example && !s.bullets).length;
    expect(threeParas / GUIDES.flatMap((g) => g.sections).length).toBeLessThan(0.5);
  });
  it('some guides carry a data table and some a worked example with real figures', () => {
    expect(GUIDES.filter((g) => g.sections.some((s) => s.table)).length).toBeGreaterThanOrEqual(2);
    expect(GUIDES.filter((g) => g.sections.some((s) => s.example)).length).toBeGreaterThanOrEqual(2);
  });
});

describe.each(GUIDES.map((g) => [g.slug, g] as const))('guide %s', (_slug, g) => {
  it('opens with a direct answer of 40 to 60 words', () => {
    const n = wordCount(stripLinks(g.directAnswer));
    expect(n).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(60);
  });

  it('has 4 to 7 question-style sections of 90 to 200 words', () => {
    expect(g.sections.length).toBeGreaterThanOrEqual(4);
    expect(g.sections.length).toBeLessThanOrEqual(7);
    for (const s of g.sections) {
      expect(s.heading.endsWith('?'), s.heading).toBe(true);
      const n = sectionWords(s);
      expect(n, `${s.heading} has ${n} words`).toBeGreaterThanOrEqual(90);
      expect(n, `${s.heading} has ${n} words`).toBeLessThanOrEqual(200);
    }
    expect(new Set(g.sections.map((s) => s.heading)).size).toBe(g.sections.length);
  });

  it('cites at least 3 official sources, all https, all on an official host', () => {
    const links = linkableTexts(g).flatMap(linksIn).filter((l) => isExternal(l.href));
    const unique = new Set(links.map((l) => l.href));
    expect(unique.size).toBeGreaterThanOrEqual(3);
    for (const u of unique) {
      const host = new URL(u).hostname.replace(/^www\./, '');
      expect(OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)), u).toBe(true);
    }
  });

  it('links to 2 to 4 Holler pages, all known routes (related list and inline links together)', () => {
    expect(g.related.length).toBeGreaterThanOrEqual(2);
    expect(g.related.length).toBeLessThanOrEqual(4);
    const inline = [...linkableTexts(g), ...g.faq.map((f) => f.a)]
      .flatMap(linksIn)
      .filter((l) => !isExternal(l.href))
      .map((l) => l.href);
    const internal = new Set([...g.related.map((r) => r.href), ...inline]);
    expect(internal.size).toBeGreaterThanOrEqual(2);
    expect(internal.size).toBeLessThanOrEqual(4);
    for (const h of internal) expect(KNOWN_ROUTES.has(h), h).toBe(true);
    expect(internal.has(guidePath(g.slug))).toBe(false);
  });

  it('shows a last reviewed date that is the fixed 2026-11-17', () => {
    expect(g.lastReviewed).toBe('2026-11-17');
  });

  it('uses no banned word and no em dash anywhere', () => {
    for (const t of allText(g)) {
      expect(bannedHits(t), t.slice(0, 60)).toEqual([]);
      expect(hasEmDash(t), t.slice(0, 60)).toBe(false);
      expect(/–/.test(t), 'en dash').toBe(false);
    }
    expect(BANNED).toContain('leverage');
  });

  it('has 3 to 4 real questions, each answered in 20 to 60 words and not copied from a heading', () => {
    expect(g.faq.length).toBeGreaterThanOrEqual(3);
    expect(g.faq.length).toBeLessThanOrEqual(4);
    for (const f of g.faq) {
      expect(f.q.endsWith('?')).toBe(true);
      const n = wordCount(f.a);
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(60);
      expect(g.sections.map((s) => s.heading)).not.toContain(f.q);
    }
  });

  it('has a short, honest "How Holler helps" of 40 to 90 words that says Holler is new or points to the free checker', () => {
    const n = wordCount(stripLinks(g.howHolerHelps));
    expect(n).toBeGreaterThanOrEqual(40);
    expect(n).toBeLessThanOrEqual(90);
    expect(g.howHolerHelps).toMatch(/Holler is new|free checker|check your area|pricing page/i);
  });

  it('never claims SAM.gov, Bluesky, Ticketmaster, concerts or people asking online as sources', () => {
    const t = allText(g).join('\n');
    expect(t).not.toMatch(/Bluesky|Ticketmaster|concert|people asking online/i);
    // SAM is named only as the place a business registers or finds bids, never as something Holler reads.
    for (const s of sentences(t)) if (/SAM/.test(s)) expect(s, s).not.toMatch(/Holler (reads|watches|checks|pulls)[^.]*SAM/i);
  });

  it('measures like plain copy: mean sentence length 14 to 22, >= 12% short sentences, stdev/mean >= 0.60', () => {
    const st = copyStats(bodyOf(g));
    expect(st.mean, 'mean').toBeGreaterThanOrEqual(14);
    expect(st.mean, 'mean').toBeLessThanOrEqual(22);
    expect(st.shortShare, 'short share').toBeGreaterThanOrEqual(0.12);
    expect(st.cv, 'cv').toBeGreaterThanOrEqual(0.6);
  });

  it('editor rules: no filler phrase, at most one short-item triple per 200 words, and Holler named at most twice outside its own box', () => {
    for (const t of allText(g)) expect(editorHits(t), t.slice(0, 60)).toEqual([]);
    const body = bodyOf(g);
    expect(triplesPer200(body), (stripLinks(body).match(TRIPLE) ?? []).join(' | ')).toBeLessThanOrEqual(1);
    expect((outsideHelps(g).match(/\bHoller\b/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('tables are well formed and every worked example has at least two lines', () => {
    for (const s of g.sections) {
      if (s.table) {
        expect(s.table.caption.length).toBeGreaterThan(10);
        for (const row of s.table.rows) expect(row.length, row.join(' | ')).toBe(s.table.head.length);
      }
      if (s.example) expect(s.example.lines.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('builds Article, BreadcrumbList and FAQPage JSON-LD that parse and carry the required fields', () => {
    const ld = guideJsonLd(g);
    const parsed = JSON.parse(jsonLdString(ld)) as Record<string, unknown>[];
    const article = parsed.find((x) => x['@type'] === 'Article')!;
    const crumbs = parsed.find((x) => x['@type'] === 'BreadcrumbList')!;
    const faq = parsed.find((x) => x['@type'] === 'FAQPage')!;
    expect(article.headline).toBe(g.title);
    expect(article.description).toBe(g.description);
    expect(article.dateModified).toBe(g.lastReviewed);
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(article.url)).toContain(guidePath(g.slug));
    expect((article.author as { name: string }).name).toBe('Holler');
    const items = crumbs.itemListElement as { position: number; name: string; item: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[2].name).toBe(g.title);
    const qs = faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(qs.map((q) => q.name)).toEqual(g.faq.map((f) => f.q));
    expect(qs.map((q) => q.acceptedAnswer.text)).toEqual(g.faq.map((f) => f.a));
  });

  it('has a unique title under 60 characters and a description of 120 to 160 characters', () => {
    const m = guideMeta(g);
    expect(m.title.length).toBeLessThan(60);
    expect(m.description.length).toBeGreaterThanOrEqual(120);
    expect(m.description.length).toBeLessThanOrEqual(160);
    expect(m.path).toBe(guidePath(g.slug));
  });
});

describe('meta across every new page', () => {
  const metas = [...GUIDES.map(guideMeta), GUIDES_HUB_META, FAQ_META, DATA_META];
  it('titles and descriptions are unique, titles under 60, descriptions 120 to 160, one canonical path each', () => {
    expect(new Set(metas.map((m) => m.title)).size).toBe(metas.length);
    expect(new Set(metas.map((m) => m.description)).size).toBe(metas.length);
    expect(new Set(metas.map((m) => m.path)).size).toBe(metas.length);
    for (const m of metas) {
      expect(m.title.length, m.title).toBeLessThan(60);
      expect(m.description.length, m.title).toBeGreaterThanOrEqual(120);
      expect(m.description.length, m.title).toBeLessThanOrEqual(160);
      expect(bannedHits(`${m.title} ${m.description}`)).toEqual([]);
      expect(hasEmDash(`${m.title} ${m.description}`)).toBe(false);
    }
  });
});

describe('the hub and FAQ JSON-LD', () => {
  it('hub: breadcrumb plus an ItemList of all 8 guides', () => {
    const parsed = JSON.parse(jsonLdString(hubJsonLd())) as Record<string, unknown>[];
    const list = parsed.find((x) => x['@type'] === 'ItemList')!;
    expect(list.numberOfItems).toBe(8);
    expect(parsed.find((x) => x['@type'] === 'BreadcrumbList')).toBeDefined();
  });
  it('faq: FAQPage questions and answers equal the visible text exactly, in order', () => {
    const parsed = JSON.parse(jsonLdString(faqPageJsonLd())) as Record<string, unknown>[];
    const faq = parsed.find((x) => x['@type'] === 'FAQPage')!;
    const qs = faq.mainEntity as { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[];
    expect(qs).toHaveLength(FAQ_ITEMS.length);
    qs.forEach((q, i) => {
      expect(q['@type']).toBe('Question');
      expect(q.name).toBe(FAQ_ITEMS[i].q);
      expect(q.acceptedAnswer['@type']).toBe('Answer');
      expect(q.acceptedAnswer.text).toBe(FAQ_ITEMS[i].a);
    });
    expect(parsed.find((x) => x['@type'] === 'BreadcrumbList')).toBeDefined();
  });
});

describe('/faq with every optional key set (the people-asking sentences live here, not on the home page)', () => {
  const ALL = (...k: EnvKey[]) =>
    k.every((x) => ['BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD', 'TICKETMASTER_API_KEY', 'SAM_API_KEY'].includes(x));
  const items = faqItems(ALL);
  it('same questions, every answer still 40 to 90 words, no em dash, no banned word, and the JSON-LD equals the text', () => {
    expect(items.map((i) => i.q)).toEqual(FAQ_ITEMS.map((i) => i.q));
    for (const i of items) {
      const n = wordCount(i.a);
      expect(n, i.q).toBeGreaterThanOrEqual(40);
      expect(n, i.q).toBeLessThanOrEqual(90);
    }
    const text = items.map((i) => `${i.q}\n${i.a}`).join('\n');
    expect(bannedHits(text)).toEqual([]);
    expect(hasEmDash(text)).toBe(false);
    expect(text).toContain('people asking online come from licensed search APIs and Bluesky search');
    const ld = (JSON.parse(jsonLdString(faqPageJsonLd(ALL))) as Record<string, unknown>[]).find((x) => x['@type'] === 'FAQPage')!;
    const qs = ld.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(qs.map((q) => q.name)).toEqual(items.map((i) => i.q));
    expect(qs.map((q) => q.acceptedAnswer.text)).toEqual(items.map((i) => i.a));
  });
});

describe('/faq content', () => {
  const text = FAQ_ITEMS.map((i) => `${i.q}\n${i.a}`).join('\n');
  it('has 3 or 4 groups and 12 to 16 questions, 3 or 4 per group', () => {
    expect(FAQ_GROUPS.length).toBeGreaterThanOrEqual(3);
    expect(FAQ_GROUPS.length).toBeLessThanOrEqual(4);
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(12);
    expect(FAQ_ITEMS.length).toBeLessThanOrEqual(16);
    expect(FAQ_GROUPS.map((g) => g.title)).toEqual(['What Holler is', 'Data and coverage', 'Pricing and trial', 'Resident requests and privacy']);
    expect(new Set(FAQ_ITEMS.map((i) => i.q)).size).toBe(FAQ_ITEMS.length);
  });
  it('every answer is 40 to 90 words, plain text with no links', () => {
    for (const i of FAQ_ITEMS) {
      const n = wordCount(i.a);
      expect(n, i.q).toBeGreaterThanOrEqual(40);
      expect(n, i.q).toBeLessThanOrEqual(90);
      expect(i.a).not.toMatch(/\[|\]\(|https?:/);
    }
  });
  it('states the fixed pricing and request facts', () => {
    expect(text).toContain('Solo is $7.99 a month or $79.99 a year');
    expect(text).toContain('Pro is $13.99 a month or $139.99 a year');
    expect(text).toMatch(/14-day free trial/);
    expect(text).toMatch(/14 days of alerts on Solo limits/);
    expect(text).not.toMatch(/Starter|7-day|Seven days/);
    expect(text).toMatch(/no card/i);
    expect(text).toMatch(/one service area and up to five trades/);
    expect(text).toMatch(/three service areas and up to 15 trades/);
    expect(text).toMatch(/five keyword watches/);
    expect(text).toMatch(/free for residents/);
    expect(text).toMatch(/confirm by email/);
    expect(text).toMatch(/reply through Holler/);
    expect(text).toMatch(/14 days/);
    expect(text).toMatch(/close it sooner|close the request whenever/);
  });
  it('says one true thing about email privacy: a business sees the address only if the resident replies to it', () => {
    const answer = FAQ_ITEMS.find((i) => /see my email/i.test(i.q))!.a;
    expect(answer).toMatch(/^Not unless you reply to that business/);
    expect(answer).toMatch(/If you reply to a business by email, that business sees your address/);
    expect(text).not.toMatch(/never shown to a business/i);
    expect(answer).not.toMatch(/^No\b/);
  });
  it('a public page shows only the service and the city; the description goes only to matching businesses', () => {
    const t = FAQ_ITEMS.find((i) => /resident request\?/i.test(i.q))!.a;
    expect(t).toMatch(/public page shows only the service and the city/);
    expect(t).toMatch(/Matching businesses get the description/);
    expect(text).not.toMatch(/becomes a public record|shown publicly|is public/i);
    const open = FAQ_ITEMS.find((i) => /stay open/i.test(i.q))!.a;
    expect(open).toMatch(/description goes only to matching businesses/);
  });
  it('FAQ answers alone have stdev/mean of sentence length of at least 0.62, with some very short and some long sentences', () => {
    const answers = FAQ_ITEMS.map((i) => i.a).join('\n');
    const st = copyStats(answers);
    expect(st.cv, 'cv of the answers').toBeGreaterThanOrEqual(0.62);
    const lens = sentences(answers).map(wordCount);
    expect(lens.filter((n) => n <= 6).length, 'very short sentences').toBeGreaterThanOrEqual(15);
    expect(lens.filter((n) => n >= 25).length, 'long sentences').toBeGreaterThanOrEqual(5);
  });
  it('no banned word, no em dash, and no claim of Bluesky, SAM.gov, Ticketmaster or concerts', () => {
    expect(bannedHits(text)).toEqual([]);
    expect(hasEmDash(text)).toBe(false);
    expect(text).not.toMatch(/Bluesky|SAM\.gov|Ticketmaster|concert|people asking online/i);
  });
  it('measures like plain copy: mean 14 to 22, >= 12% short, stdev/mean >= 0.60, at most one short-item triple per 200 words', () => {
    const st = copyStats(text);
    expect(st.mean).toBeGreaterThanOrEqual(14);
    expect(st.mean).toBeLessThanOrEqual(22);
    expect(st.shortShare).toBeGreaterThanOrEqual(0.12);
    expect(st.cv).toBeGreaterThanOrEqual(0.6);
    expect(triplesPer200(text)).toBeLessThanOrEqual(1);
    expect(editorHits(text)).toEqual([]);
  });
  it('answers open differently: no two answers share their first two words, and none opens with a stall', () => {
    const openers = FAQ_ITEMS.map((i) => firstWords(i.a, 2));
    expect(openers.filter((o, i) => openers.indexOf(o) !== i)).toEqual([]);
    for (const i of FAQ_ITEMS) expect(i.a, i.q).not.toMatch(/^(It depends|Great question|Good question|Well,|So,)/);
  });
});

describe('facts that depend on the code base', () => {
  it('the check cadences named in the guides and FAQ match the adapters', () => {
    const cad = (id: string) => ALL_ADAPTERS.find((a) => a.id === id)?.cadenceMinutes;
    expect(cad('nws')).toBe(15);
    expect(cad('faa')).toBe(15);
    expect(cad('spc')).toBe(30);
    expect(cad('usgs')).toBe(30);
    expect(cad('fema')).toBe(360);
    expect(cad('usaspending')).toBe(720);
    expect(cad('socrata-chicago-311')).toBe(180);
    expect(cad('socrata-chicago-permits')).toBe(360);
    expect(cad('socrata-chicago-inspections')).toBe(720);
  });
  it('the cities named for permits, 311 and business licenses have those feeds switched on', () => {
    const has = (slug: string, t: string) => (CITY_FEEDS[slug] ?? []).includes(t as never);
    for (const slug of ['chicago-il', 'new-york-city-ny', 'austin-tx', 'san-francisco-ca']) expect(has(slug, 'permit'), `${slug} permits`).toBe(true);
    for (const slug of ['chicago-il', 'new-york-city-ny', 'austin-tx', 'san-francisco-ca']) expect(has(slug, '311'), `${slug} 311`).toBe(true);
    for (const slug of ['chicago-il', 'san-francisco-ca', 'los-angeles-ca', 'new-york-city-ny', 'orlando-fl']) expect(has(slug, 'business'), `${slug} business`).toBe(true);
  });
});

describe('round 3 fixes in the guides', () => {
  const storms = guideBySlug('storm-damage-leads-from-weather-alerts-and-storm-reports')!;
  const sources = guideBySlug('free-public-data-sources-for-local-leads')!;
  const respond = guideBySlug('how-to-respond-to-a-local-lead-fast')!;
  const stormText = [storms.directAnswer, ...storms.sections.flatMap((s) => [s.heading, ...s.paragraphs]), ...storms.faq.map((f) => f.a)].join('\n');
  const everything = GUIDES.map((g) => allText(g).join('\n')).join('\n');

  it('the storms direct answer does not tell roofers to call; it says to reach out the same day in ways the law allows', () => {
    expect(storms.directAnswer).not.toMatch(/\bcall\b/i);
    expect(storms.directAnswer).toContain('reach out the same day, in the ways the law allows');
  });
  it('the storms guide links the SPC storm reports page, never the /wcm/ page, and does not say Storm Data compiles preliminary reports', () => {
    const hrefs = GUIDES.flatMap((g) => [...g.sections.flatMap((s) => [...s.paragraphs, ...(s.bullets ?? [])]), g.howHolerHelps].flatMap(linksIn)).map((l) => l.href);
    expect(hrefs).not.toContain('https://www.spc.noaa.gov/wcm/');
    expect(hrefs).toContain('https://www.spc.noaa.gov/climo/reports/today.html');
    for (const g of [storms, sources]) expect(allText(g).join('\n')).not.toMatch(/Storm Data|web charts/i);
    expect(stormText).toMatch(/labels every report preliminary/);
  });
  it('the storms guide warns about state solicitation limits, cites Florida statute 489.147 on the official site, and says it is not legal advice', () => {
    expect(stormText).toMatch(/Some states restrict how contractors may solicit roof work after a storm/);
    expect(stormText).toContain('https://www.flsenate.gov/Laws/Statutes/2026/489.147');
    expect(stormText).toMatch(/Do Not Call Q&A/);
    // Texting rules were not verified on an official page this round, so the guide says it does not cover them instead of naming them.
    expect(stormText).toMatch(/Text messages fall under separate rules that this guide does not cover/);
    expect(stormText).toMatch(/general information, not legal advice/);
  });
  it('every guide that gives contact advice carries a general information, not legal advice line', () => {
    for (const slug of [storms.slug, respond.slug, 'how-contractors-find-work-from-building-permits', 'pay-per-lead-vs-flat-fee-alerts', 'new-business-licenses-as-a-lead-source']) {
      const g = guideBySlug(slug)!;
      expect(allText(g).join(' '), slug).toMatch(/general information, not legal advice/);
    }
  });
  it('the sources guide no longer claims its links are the ones used in each alert', () => {
    expect(allText(sources).join('\n')).not.toMatch(/same ones Holler cites/i);
    expect(allText(sources).join('\n')).toMatch(/Each Holler alert links to its source page/);
  });
  it('"Holler is new" is not repeated on the guides (it stays on the about, FAQ and request pages)', () => {
    expect(everything).not.toMatch(/Holler is new/);
  });
  it('the resident request section tells a business the address is hidden until the resident replies, and the public page shows only service and city', () => {
    const t = respond.sections.find((s) => /request posted on Holler/.test(s.heading))!.paragraphs.join(' ');
    expect(t).toMatch(/public page shows only the service and the city/);
    expect(t).toMatch(/email address stays hidden from you until the resident answers you by email/);
    expect(t).not.toMatch(/never shown to you|appears publicly|public record/i);
    expect(everything).not.toMatch(/never shown to (you|a business)/i);
  });
  it('quick answers are plain text: no guide FAQ answer holds a link (the page prints them as text)', () => {
    for (const g of GUIDES) for (const f of g.faq) expect(linksIn(f.a), f.q).toEqual([]);
  });
  it('no guide says Holler never messages anyone on your behalf (it sends the replies a business writes)', () => {
    expect(everything).not.toMatch(/messages anyone on your behalf|messages anyone for you/i);
  });
  it('the direct answers do not use absolutes the cited pages do not', () => {
    expect(guideBySlug('federal-contracts-for-small-local-businesses')!.directAnswer).toContain('you usually need an active SAM registration');
    expect(guideBySlug('new-business-licenses-as-a-lead-source')!.directAnswer).toContain('often needs');
    // The old line about where damage starts had no official source; the guide now states the verified date of the 1 inch standard.
    expect(storms.sections[1].paragraphs.join(' ')).toContain('national standard since January 5, 2010');
    expect(stormText).not.toMatch(/often where roof/);
  });
  it('uses US spelling: the licenses guide slug, and no licence or other British spelling in any guide, FAQ or link', () => {
    expect(GUIDE_SLUGS).toContain('new-business-licenses-as-a-lead-source');
    expect(GUIDE_SLUGS.join(' ')).not.toMatch(/licence/);
    const all = `${everything}\n${FAQ_ITEMS.map((i) => `${i.q} ${i.a}`).join('\n')}\n${GUIDES.map((g) => `${g.slug} ${g.metaTitle} ${g.description}`).join('\n')}`;
    expect(all).not.toMatch(/\b(licence[sd]?|licenced|colour\w*|neighbour\w*|favourite\w*|organis\w+|enquir\w+|cheque\w*|centre\w*|behaviour\w*)\b/i);
  });
});
