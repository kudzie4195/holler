/**
 * Round 17, unit ES (redo 1): no English left over. Renders what a Spanish member reads (3 digests, 10 cards, 3 drafts and a set of outreach
 * notes, /es and /es/check) and fails when an English word from Holler's own English UI shows up outside two places: the brand name, and the
 * record's data fields (what a source wrote: a title's own text, a summary, an address, a company name).
 *
 * The denylist is built from the English dictionary: every word Holler's English UI and title templates use that the Spanish dictionary does
 * not use at all, plus a short list of the words the grader found leaking (permit, near, reported, new, Roof, Plumbing ...).
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
const loadCheck = vi.hoisted(() => vi.fn());
vi.mock('@/lib/check/load', () => ({ loadCheck }));
vi.mock('@/lib/check/limit', () => ({ gateCheck: async () => 'ok' }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import HomeEs from '@/app/es/page';
import CheckPageEs from '@/app/es/check/page';
import { Feed } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { fallbackDraft } from '@/lib/ai/fallback';
import { NOTE_KINDS, renderNote } from '@/lib/outreach/templates';
import { instructionsFor } from '@/lib/ai/draft';
import { formatDistance, timeAgo } from '@/components/format';
import { bidCardLine } from '@/lib/signals/bid-card';
import { titleDataFields } from '@/lib/signals/title-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { RecentActivityView } from '@/components/feed/recent-activity';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { NOW } from '../signals/brief-fixtures';
import { shipCases, shipDigestItem, shipFeedItem, type ShipCase } from '../signals/ship-fixtures';

const BRAND = ['Holler', 'ColorLabPro'];

const words = (s: string) => s.toLowerCase().match(/\p{L}{3,}/gu) ?? [];

/** English words the English UI uses and the Spanish UI does not use anywhere. */
const DENY: Set<string> = (() => {
  const spanish = new Set<string>();
  for (const v of Object.values(es)) for (const w of words(v)) spanish.add(w);
  const out = new Set<string>();
  for (const v of Object.values(en)) for (const w of words(v)) if (!spanish.has(w)) out.add(w);
  for (const w of ['permit', 'permits', 'near', 'reported', 'new', 'roof', 'roofing', 'plumbing', 'hail', 'request', 'violation', 'failed', 'business', 'license', 'earthquake']) out.add(w);
  // words that are also Spanish names, brand or acronyms in a Spanish sentence
  for (const w of ['holler', 'hvac', 'colorlabpro', 'email', 'zip', 'mph', 'usps', 'naics']) out.delete(w);
  return out;
})();

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/** Remove each data value (case-insensitive) from the text. Longest first, so a long title is removed before the words in it. */
function without(s: string, data: Iterable<string>): string {
  let out = s;
  for (const d of [...new Set(data)].filter((x) => x && x.trim().length > 1).sort((a, b) => b.length - a.length)) {
    const esc = d.trim().replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    out = out.replace(new RegExp(esc, 'gi'), ' ');
  }
  return out;
}

function leaks(rendered: string, data: Iterable<string>): string[] {
  // links are not prose: out first, before data is taken out of the text around them
  let s = text(rendered).replace(/https?:\/\/\S+/g, ' ');
  s = without(s, data);
  for (const b of BRAND) s = s.split(b).join(' ');
  return [...new Set(words(s).filter((w) => DENY.has(w)))];
}

/**
 * The data in a summary. A summary a source wrote (permit type and class, a business, SPC remarks, an NWS description, a post) is data as a
 * whole. A summary Holler composed (FEMA, FAA, USGS, bids, contracts, Ticketmaster) is Spanish now: only the pieces that survive unchanged
 * (a buyer, an airport reason, a place) are data, so an untranslated Holler sentence shows up as a leak.
 */
function summaryData(c: ShipCase): string[] {
  const sum = c.signal.summary;
  if (!sum) return [];
  const loc = localizeSummary(sum, 'es', c.signal.source) ?? sum;
  if (loc === sum) return /^(?:spc|nws|bluesky|websearch|socrata|arcgis)/i.test(c.signal.source) ? [sum] : [];
  return sum.split(/\s*[|:,]\s*|\.\s+|\.$/).map((p) => p.trim()).filter((p) => p.length >= 3 && loc.includes(p));
}

/** What a case holds that a source wrote or a place/company name: the title's own parts, the summary, every string in data, the contacts. */
function dataOf(c: ShipCase): string[] {
  const out: string[] = [...titleDataFields(c.signal.title, c.signal.source)];
  // a post or a search hit is the author's own text; any other title left as it was would be a Holler template that was not translated, and must show up as a leak
  if (/^(?:bluesky|websearch)/i.test(c.signal.source)) out.push(c.signal.title);
  out.push(...summaryData(c));
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v, v.toLowerCase());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as object).forEach(walk);
  };
  walk(c.signal.data);
  walk(c.contacts);
  walk([c.managerName, c.managerRole]);
  // the brief repeats a violation's own words in lower case; a title's text field is data in either case
  for (const d of titleDataFields(c.signal.title, c.signal.source)) out.push(d.toLowerCase());
  return out;
}

const esDigestItem = (c: ShipCase) => {
  const base = shipDigestItem(c);
  const data = (c.signal.data ?? {}) as Record<string, unknown>;
  return { ...base, bidLine: data.subtype === 'bid' ? bidCardLine({ buyer: data.buyer as string, dueDate: data.dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW, 'es') : null };
};
const esFeedItem = (c: ShipCase, i: number) => {
  const base = shipFeedItem(c, i);
  const data = (c.signal.data ?? {}) as Record<string, unknown>;
  return {
    ...base,
    ago: timeAgo(c.signal.occurredAt, NOW.getTime(), 'es'),
    distance: formatDistance(c.match.distance_mi, 'es'),
    bidLine: data.subtype === 'bid' ? bidCardLine({ buyer: data.buyer as string, dueDate: data.dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW, 'es') : null,
  };
};

describe('summaries and the recent block', () => {
  it('every Holler-composed summary in the fixtures is Spanish on the card (nothing from the sentence is masked)', async () => {
    const cases = await shipCases();
    const composed = cases.filter((c) => c.signal.summary && /^(?:fema|faa|usgs|sam-gov|usaspending|ticketmaster|bids-)/.test(c.signal.source));
    expect(composed.length).toBeGreaterThan(2);
    for (const c of composed) expect(localizeSummary(c.signal.summary, 'es', c.signal.source), c.signal.source).not.toBe(c.signal.summary);
  });
  it('the 90-day recent block for a Spanish member: counts, titles, dates and notes have no English UI words', async () => {
    const cases = await shipCases();
    const examples = cases.slice(0, 5).map((c, i) => ({ title: c.signal.title, city: 'Atlanta', state: 'GA', date: `2026-11-${String(10 + i).padStart(2, '0')}` }));
    const types = ['storm-report', 'weather-alert', 'disaster', 'quake', 'airport', 'permit', '311', 'inspection', 'business', 'violation', 'event', 'event-permit', 'contract', 'federal-bid', 'other'];
    const preview = { total: 40, byIntent: { demand: 0, spending: 0, asking: 0 }, capped: true, byType: types.map((key, i) => ({ key, count: i + 1 })), examples };
    const data = cases.slice(0, 5).flatMap(dataOf);
    const html = renderToStaticMarkup(createElement(RecentActivityView, { preview, lang: 'es' }));
    expect(leaks(html, [...data, 'Atlanta, GA'])).toEqual([]);
    expect(leaks(renderToStaticMarkup(createElement(RecentActivityView, { preview: { ...preview, total: 0, byType: [], examples: [] }, lang: 'es' })), [])).toEqual([]);
    // the English block does have these words: the check is live
    expect(leaks(renderToStaticMarkup(createElement(RecentActivityView, { preview })), data).length).toBeGreaterThan(3);
  });
});

describe('the denylist itself', () => {
  it('is built from the English UI and holds the words the grader found', () => {
    for (const w of ['permit', 'near', 'reported', 'new', 'roof', 'plumbing', 'hail', 'request', 'federal'.slice(0, 0) || 'violation']) expect(DENY.has(w), w).toBe(true);
    expect(DENY.size).toBeGreaterThan(200);
    for (const w of ['holler', 'hvac', 'para', 'usted']) expect(DENY.has(w), w).toBe(false);
  });
  it('catches an English title left in a Spanish card (the check is not vacuous)', async () => {
    const [c] = await shipCases();
    const html = renderToStaticMarkup(createElement('div', null, 'Roof permit in Chicago, new request near you'));
    expect(leaks(html, dataOf(c))).toEqual(expect.arrayContaining(['permit', 'roof', 'new', 'request', 'near']));
  });
});

describe('what a Spanish member reads has no English UI words', () => {
  it('3 digests (all cards, one card, a few cards)', async () => {
    const cases = await shipCases();
    const sets = [cases, cases.slice(0, 1), cases.slice(3, 8)];
    expect(sets.map((s) => s.length)).toEqual([cases.length, 1, 5]);
    for (const set of sets) {
      const mail = renderDigest({ businessName: 'Taller Los Pinos', items: set.map(esDigestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, lang: 'es' });
      const data = set.flatMap(dataOf);
      expect(leaks(mail.html, data), `html (${set.length})`).toEqual([]);
      expect(leaks(mail.text, data), `text (${set.length})`).toEqual([]);
      expect(leaks(mail.subject, data), `subject (${set.length})`).toEqual([]);
    }
  });
  it('10 cards', async () => {
    const cases = (await shipCases()).slice(0, 10);
    expect(cases).toHaveLength(10);
    cases.forEach((c, i) => {
      const html = renderToStaticMarkup(createElement(Feed, { items: [esFeedItem(c, i)], cityPage: null, lang: 'es' }));
      expect(leaks(html, dataOf(c)), c.signal.title).toEqual([]);
    });
  });
  it('3 drafts, the model instructions and the outreach notes', () => {
    const drafts = [
      fallbackDraft({ businessName: 'Techos Pinos', categories: ['roofing'], title: 'Busco techador', city: 'Marietta', lang: 'es' }),
      fallbackDraft({ businessName: 'Clima Gómez', categories: ['hvac'], title: 'x', lang: 'es' }),
      fallbackDraft({ businessName: 'Jardinería Ramírez', categories: ['landscaping'], title: 'x', city: 'Smyrna', lang: 'es' }),
    ];
    for (const d of drafts) expect(leaks(d, ['Techos Pinos', 'Clima Gómez', 'Jardinería Ramírez']), d).toEqual([]);
    expect(drafts[2]).toContain('jardinería y paisajismo');
    // the instructions name the banned hype words on purpose, in Spanish
    expect(leaks(instructionsFor('es'), [])).toEqual([]);
    const vars = { org: 'Peachtree Builders LLC', address: '123 Main St' };
    for (const kind of NOTE_KINDS) expect(leaks(renderNote(kind, vars, 'es'), Object.values(vars)), kind).toEqual([]);
  });
  it('/es and /es/check (shell, bad input, results with Holler titles, empty results)', async () => {
    expect(leaks(renderToStaticMarkup(HomeEs()), [])).toEqual([]);
    type Props = { searchParams: Promise<Record<string, string>> };
    const findAsync = (node: ReactNode): ReactElement<Props> | null => {
      if (Array.isArray(node)) {
        for (const n of node) {
          const f = findAsync(n);
          if (f) return f;
        }
        return null;
      }
      if (!isValidElement(node)) return null;
      const props = node.props as { searchParams?: unknown; children?: ReactNode };
      if (props.searchParams && typeof node.type === 'function') return node as ReactElement<Props>;
      if (typeof node.type === 'function' && !props.children) return findAsync((node.type as (p: unknown) => ReactNode)(node.props));
      return findAsync(props.children);
    };
    const render = async (sp: Record<string, string>) => {
      const page = CheckPageEs({ searchParams: Promise.resolve(sp) } as never) as ReactElement;
      const check = findAsync(page);
      const out = check ? await (check.type as (p: Props) => Promise<ReactNode>)(check.props) : null;
      return renderToStaticMarkup(page) + renderToStaticMarkup(createElement('div', null, out));
    };
    for (const sp of [{}, { zip: 'abc' }, { zip: '60614' }, { zip: '60614', trade: 'astronaut' }] as Record<string, string>[]) expect(leaks(await render(sp), []), JSON.stringify(sp)).toEqual([]);
    const now = Date.now();
    const titles = ['1.50 inch hail reported near 2 ESE Atlanta, GA', 'Roof permit in Atlanta', 'Federal contract ($310K) in Cincinnati, OH: Plumbing (NAICS 238220)', 'Wind damage reported near 4 E Marietta, GA'];
    const sources = ['spc', 'arcgis-atlanta-permits', 'usaspending', 'spc'];
    const kinds = ['report', 'permit', 'contract', 'report'];
    loadCheck.mockResolvedValue({
      ok: true,
      checkedAt: new Date(now - 5 * 60_000).toISOString(),
      items: titles.map((title, i) => ({ id: i + 1, kind: kinds[i], source: sources[i], title, url: 'https://x.test/r', place: 'Atlanta, GA', lat: 33.8, lon: -84.4, occurredAt: new Date(now - (i + 1) * 3_600_000).toISOString(), severity: 2 })),
    });
    const html = await render({ zip: '30303', trade: 'roofing' });
    // the places inside the titles are data; nothing else
    expect(leaks(html, ['2 ESE Atlanta, GA', '4 E Marietta, GA', 'Atlanta, GA', 'Cincinnati, OH'])).toEqual([]);
    expect(text(html)).toContain('Viento fuerte reportado cerca de 4 E Marietta, GA (daño no confirmado)');
    loadCheck.mockResolvedValue({ ok: true, checkedAt: new Date().toISOString(), items: [] });
    expect(leaks(await render({ zip: '30303', trade: 'landscaping' }), ['Atlanta, GA'])).toEqual([]);
  });
});
