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

const text = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

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
    const examples = cases.slice(0, 5).map((c, i) => ({ title: c.signal.title, source: c.signal.source, city: 'Atlanta', state: 'GA', date: `2026-11-${String(10 + i).padStart(2, '0')}` }));
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

describe('a construction stage update (round 17, STAGE) for a Spanish member', () => {
  const STAGE_AT = '2026-11-20T09:00:00Z';
  const permitCase = async () => {
    const c = (await shipCases()).find((x) => x.signal.kind === 'permit');
    expect(c, 'a permit case').toBeDefined();
    return c as ShipCase;
  };

  it('the update email (subject, html, text) has no English UI words, and says Actualización de etapa with a Spanish date', async () => {
    const c = await permitCase();
    const item = { ...esDigestItem(c), label: 'coming_soon' as const, trade: 'landscaping', permitStage: 'final_inspection', permitStageAt: STAGE_AT, permitStageUpdate: true };
    const mail = renderDigest({ businessName: 'Taller Los Pinos', items: [item], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, lang: 'es' });
    const data = dataOf(c);
    expect(leaks(mail.html, data), 'html').toEqual([]);
    expect(leaks(mail.text, data), 'text').toEqual([]);
    expect(leaks(mail.subject, data), 'subject').toEqual([]);
    expect(mail.subject).toBe('Actualización: inspección final en un permiso cerca de usted');
    expect(mail.text).toContain('Actualización de etapa: inspección final, indicada por la fuente pública el 20 nov 2026.');
    expect(mail.text).toContain('Actualización de etapa, 20 nov 2026');
    expect(mail.html).toContain('Actualización de etapa: inspección final');
    expect(mail.text).not.toMatch(/Stage update|Update:|near you|\bnew\b/i);
    expect(mail.text).not.toMatch(/hace \d+ d/);
  });

  it('a mix and an updates-only digest are Spanish too', async () => {
    const c = await permitCase();
    const up = { ...esDigestItem(c), label: 'coming_soon' as const, trade: 'landscaping', permitStage: 'finaled', permitStageAt: STAGE_AT, permitStageUpdate: true };
    const plain = esDigestItem(c);
    for (const items of [[up, { ...up }], [up, plain]]) {
      const mail = renderDigest({ businessName: 'Taller Los Pinos', items, appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW, lang: 'es' });
      expect(leaks(mail.subject, []), mail.subject).toEqual([]);
      expect(leaks(mail.text, dataOf(c)), mail.subject).toEqual([]);
    }
  });

  it('the card line of a permit at a stage is Spanish on a Spanish card (not the English sentence)', async () => {
    const c = await permitCase();
    const item = { ...esFeedItem(c, 0), permitStage: 'certificate_of_occupancy', permitStageAt: STAGE_AT };
    const html = renderToStaticMarkup(createElement(Feed, { items: [item], cityPage: null, lang: 'es' }));
    expect(text(html)).toContain('La fuente pública indica un certificado de ocupación (visto el 20 nov 2026). Es posible que el edificio abra pronto.');
    expect(leaks(html, dataOf(c))).toEqual([]);
  });
});

/**
 * Round 18, unit ES: the new Spanish pages (pricing, sign-up, log-in, password, confirm, onboarding), the signed-in app for a Spanish
 * member (header, feed chrome and banners in every trial and billing state, Settings in every billing state, account deletion, the verify
 * notice) and every new Spanish email and token page. Same denylist as above (it now also holds the English UI words of the pricing,
 * account, Settings and email strings, from lib/i18n/en-account.ts). Data allowed: the business name, the place and the email address.
 */
describe('round 18: new Spanish pages, the app for a Spanish member, and the Spanish account emails', () => {
  /** Labels that may still say "(en inglés)": the pages that are English on purpose (privacy, terms, the full FAQ). */
  const ENGLISH_ON_PURPOSE = ['Privacidad (en inglés)', 'Términos (en inglés)', 'términos (en inglés)', 'Política de privacidad (en inglés)', 'Todas las preguntas (en inglés)'];
  // "Solo" is also "only": it must always be "Plan Solo", and "Plan Solo" is never the subject of a verb ("El plan Solo cuesta" reads as
  // "the plan only costs"); the copy writes "Plan Solo: $7.99 al mes" or puts the name after a preposition ("del Plan Solo").
  const soloAlone = (s: string) => [
    ...[...s.matchAll(/(?<!\p{L})s[oó]lo(?!\p{L})/giu)].filter((m) => !/plan\s+$/i.test(s.slice(Math.max(0, (m.index ?? 0) - 5), m.index))).map((m) => s.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 20)),
    ...[...s.matchAll(/plan solo\s+(?:cuesta|es|incluye|cubre|tiene|da|sirve|vale)(?!\p{L})/giu)].map((m) => m[0]),
  ];

  it('every surface: no English UI word, no Spanish wording rule broken, "Plan Solo" never "Solo" alone, "(en inglés)" only on English-only pages', async () => {
    const { renderSpanish } = await import('./r18-spanish');
    const { spanishProblems } = await import('@/lib/i18n/rules');
    const all = await renderSpanish();
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(53);
    for (const [k, s] of Object.entries(all)) {
      expect(leaks(s.out, s.data), k).toEqual([]);
      let plain = without(text(s.out).replace(/https?:\/\/\S+/g, ' '), s.data);
      expect(soloAlone(plain), k).toEqual([]);
      for (const ok of ENGLISH_ON_PURPOSE) plain = plain.split(ok).join(' ');
      expect(plain, k).not.toContain('(en inglés)');
      expect(spanishProblems(plain), k).toEqual([]);
    }
  }, 120_000);

  it('the check is live: an English word or a bare "Solo" in a Spanish page is caught', () => {
    expect(leaks('<p>Billing questions: Manage billing in Settings</p>', [])).toEqual(expect.arrayContaining(['billing', 'manage', 'settings']));
    expect(soloAlone('El plan Solo cuesta $7.99')).toHaveLength(1);
    expect(soloAlone('Plan Solo: $7.99 al mes')).toEqual([]);
    expect(soloAlone('Solo cuesta $7.99 al mes')).toHaveLength(1);
    expect(soloAlone('La prueba usa los límites del Plan Solo.')).toEqual([]);
  });
});

describe('round 18 integration: the other units\' screens for a Spanish member (lists, door hanger, work profile, lookup lines, holds)', () => {
  const BIZ = 'Techos Ramírez';
  const DATA = [BIZ, 'Atlanta, GA', 'Atlanta', 'Smyrna, GA', 'Smyrna', 'Cobb', '1584 ABNER NW', '22 OAK ST', '30318', '30080', '2 N Smyrna, GA', '404-555-0123', 'peachtreeroofing.example', 'Peachtree Roofing LLC'];

  it('lists index, storm list, neighborhood list, door hanger (the print view is the page itself), work profile, lookup lines and hold chips', async () => {
    const { baseMocks, appMocks } = await import('./r18-harness');
    const { esMember } = await import('./r18-spanish');
    const { renderResolved } = await import('./render-tree');
    const { spanishProblems } = await import('@/lib/i18n/rules');
    const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
    const report = { id: 9001, kind: 'hail', label: 'act_now', title: '1.75 inch hail reported near 2 N Smyrna, GA', city: 'Smyrna', state: 'GA', county: 'Cobb', occurredAt: day(1), reportDay: day(1).slice(0, 10), url: 'https://www.spc.noaa.gov/climo/reports/', lat: 33.9, lon: -84.51 };
    const entries = [
      { address: '1584 ABNER NW', zip: '30318', city: 'Atlanta', state: 'GA', permitType: 'Roof', date: day(3).slice(0, 10), url: 'https://example.org/p/1', distanceMi: 0.8 },
      { address: '22 OAK ST', zip: '30080', city: 'Smyrna', state: 'GA', permitType: null, date: day(5).slice(0, 10), url: 'https://example.org/p/2', distanceMi: 1.6 },
    ];
    const list = { entries, total: 2, capped: false, hasApprox: false, partial: false };
    const out: Record<string, string> = {};
    baseMocks({ profile: esMember({ categories: ['roofing', 'landscaping'] }) });
    appMocks();
    vi.doMock('@/lib/lists/load', async (orig) => ({
      ...(await orig<typeof import('@/lib/lists/load')>()),
      loadStormReports: async () => [report],
      loadStormReport: async () => report,
      loadStormList: async () => list,
      loadAreaCounts: async () => [{ trade: 'landscaping', total: 2, partial: false }],
      loadAreaList: async () => ({ ...list, entries: entries.map((e) => ({ ...e, distanceMi: null })) }),
    }));
    const sp = (q: Record<string, string>) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(q) }) as never;
    out['lists.index'] = await renderResolved(createElement((await import('@/app/app/lists/page')).default));
    out['lists.storm'] = await renderResolved((await import('@/app/app/lists/storm/page')).default(sp({ id: '9001' })));
    out['lists.area'] = await renderResolved((await import('@/app/app/lists/area/page')).default(sp({ trade: 'landscaping' })));
    out['lists.door-hanger'] = await renderResolved((await import('@/app/app/lists/door-hanger/page')).default(sp({})));
    out['lists.door-hanger.storm'] = await renderResolved((await import('@/app/app/lists/door-hanger/page')).default(sp({ storm: '1' })));
    const { DoorHanger } = await import('@/components/lists/door-hanger');
    out['hanger.storm'] = renderToStaticMarkup(createElement(DoorHanger, { lang: 'es', initialBusiness: BIZ, storm: true }));
    // Settings "What work do you take?" for a Spanish member (the Settings page itself is in the round 18 ES block above)
    const { WorkProfileForm } = await import('@/components/work-profile-form');
    out['settings.work'] = renderToStaticMarkup(createElement(WorkProfileForm, { action: async () => ({}), current: { property: 'both', minValue: 5000, type: 'both' } as never, lang: 'es' }));
    // the lookup's phone and website lines, on a card
    const { WhoToContact } = await import('@/components/feed/who-to-contact');
    out['card.lookup'] = renderToStaticMarkup(
      createElement(WhoToContact, {
        item: { source: 'arcgis-atlanta-permits', kind: 'permit', city: 'Atlanta', state: 'GA', summary: 'Roof | 1584 ABNER NW' },
        contacts: [{ role: 'contractor', name: 'Peachtree Roofing LLC', listing: { phone: '404-555-0123', website: 'https://peachtreeroofing.example/' } } as never],
        lang: 'es',
      }),
    );
    // the feed notes of the contact gate and the work profile
    const { OpportunityChip } = await import('@/components/feed/opportunity-chip');
    out['chip.background'] = renderToStaticMarkup(createElement(OpportunityChip, { label: 'market_insight', lang: 'es', hold: 'background' }));
    out['chip.below_min'] = renderToStaticMarkup(createElement(OpportunityChip, { label: 'market_insight', lang: 'es', hold: 'below_min' }));

    // A storm list prints its damage line in English AND Spanish for every member, on purpose (round 18 LISTS criterion 1).
    const { DAMAGE_LINE } = await import('@/lib/lists/core');
    for (const [k, html] of Object.entries(out)) {
      const data = k === 'lists.storm' ? [...DATA, DAMAGE_LINE.en] : DATA;
      expect(html.length, k).toBeGreaterThan(40);
      expect(leaks(html, data), k).toEqual([]);
      expect(spanishProblems(without(text(html).replace(/https?:\/\/\S+/g, ' '), data)), k).toEqual([]);
    }
    expect(text(out['lists.storm'])).toContain(DAMAGE_LINE.es);
    expect(text(out['settings.work'])).toContain(es['settings.work.hint']);
    expect(text(out['card.lookup'])).toContain(es['listing.note']);
    expect(text(out['chip.background'])).toContain('Referencia');
    expect(text(out['chip.below_min'])).toContain('Por debajo de su mínimo');
    expect(text(out['lists.storm'])).toContain('1584 ABNER NW');
    expect(text(out['lists.index'])).toContain(es['lists.title']);
  }, 60_000);
});

describe('round 19 integration: the strings that came from r19-metros, for a Spanish reader', () => {
  const DATA = ['Victory Plumbing Company', 'Charge Electrical Services LLC', 'Philadelphia, PA', 'Philadelphia', 'PA', '512-990-7200', 'Austin, TX', 'Austin', 'TX', 'Roof permit in Austin'];

  it('builders panel, waitlist confirm page (all four states) and email, lifecycle chips, the fifth Coming-next feature', async () => {
    const { spanishProblems } = await import('@/lib/i18n/rules');
    const out: Record<string, string> = {};
    const { ActiveBuilders } = await import('@/components/builders/active-builders');
    out['builders'] = renderToStaticMarkup(
      createElement(ActiveBuilders, {
        lang: 'es',
        windowDays: 30,
        builders: [
          { name: 'Victory Plumbing Company', permits: 3, kinds: ['plumbing', 'new home'], newest: NOW.toISOString(), phone: '512-990-7200', relation: 'same-trade' },
          { name: 'Charge Electrical Services LLC', permits: 1, kinds: ['electrical'], newest: NOW.toISOString(), phone: null, relation: 'other' },
        ],
      }),
    );
    vi.doMock('@/lib/waitlist/zip-confirm-deps', () => ({ zipWaitlistConfirmDeps: () => ({}) }));
    const codes = { v: 'confirmed' as string };
    vi.doMock('@/lib/waitlist/zip-confirm', () => ({ confirmWaitlist: async () => ({ code: codes.v }) }));
    vi.resetModules();
    const route = await import('@/app/waitlist/confirm/route');
    const post = async (code: string) => {
      codes.v = code;
      const fd = new FormData();
      fd.set('token', 'abc.def');
      fd.set('lang', 'es');
      return (await route.POST(new Request('https://localholler.com/waitlist/confirm', { method: 'POST', body: fd }))).text();
    };
    out['wl.get'] = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=abc.def&lang=es')).text();
    out['wl.get.bad'] = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=bad&lang=es')).text();
    out['wl.done'] = await post('confirmed');
    out['wl.invalid'] = await post('invalid');
    out['wl.error'] = await post('unavailable');
    const { renderWaitlistConfirm } = await import('@/lib/email/templates');
    const mail = renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=abc.def&lang=es', place: 'Philadelphia, PA', lang: 'es' });
    out['wl.email.subject'] = mail.subject;
    out['wl.email.html'] = mail.html;
    out['wl.email.text'] = mail.text;
    const { renderWelcomeMatches } = await import('@/lib/lifecycle/templates');
    const items = (['act_now', 'coming_soon', 'market_insight'] as const).map((label, i) => ({ title: 'Roof permit in Austin', city: 'Austin', state: 'TX', occurredAt: NOW.toISOString(), kind: 'permit', subtype: 'permit', source: 'socrata-austin-permits', label, severity: i + 1 }));
    const life = renderWelcomeMatches({ businessName: 'Techos Ramírez', feedUrl: 'https://localholler.com/app', plansUrl: 'https://localholler.com/pricing', unsubscribeUrl: 'https://localholler.com/u', total: 3, items, lang: 'es' });
    out['life.html'] = life.html;
    out['life.text'] = life.text;
    const { ComingNext } = await import('@/components/coming-next');
    out['coming-next'] = renderToStaticMarkup(createElement(ComingNext, { page: 'pricing', lang: 'es' }));

    for (const [k, html] of Object.entries(out)) {
      // the support address (email.contact_us) is data, not prose
      const data = [...DATA, 'Techos Ramírez', ...(html.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [])];
      expect(html.length, k).toBeGreaterThan(20);
      expect(leaks(html, data), k).toEqual([]);
      expect(spanishProblems(without(text(html).replace(/https?:\/\/\S+/g, ' '), data)), k).toEqual([]);
    }
    expect(text(out['builders'])).toContain(es['builders.title']);
    expect(text(out['wl.get'])).toContain(es['wl.confirm.title']);
    expect(out['wl.get']).toContain('name="lang" value="es"');
    expect(out['wl.get']).toContain('<html lang="es">');
    expect(text(out['wl.done'])).toContain(es['wl.confirm.done.title']);
    expect(text(out['wl.invalid'])).toContain(es['wl.confirm.inactive.title']);
    expect(text(out['wl.error'])).toContain(es['wl.confirm.error.title']);
    expect(text(out['wl.email.html'])).toContain(es['wl.email.h']);
    for (const chip of ['chip.act_now', 'chip.coming_soon', 'chip.market_insight'] as const) expect(out['life.text'], chip).toContain(es[chip]);
    expect(text(out['coming-next'])).toContain(es['next.f.more-areas.label']);
  }, 60_000);

  // Round 24 (review P3-8): the waitlist words no longer promise an area launch (the list is also for one trade in a city Holler reads).
  it('English is unchanged: the confirm page and email without lang read exactly as round 24 wrote them', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/waitlist/zip-confirm');
    const route = await import('@/app/waitlist/confirm/route');
    const get = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=abc.def')).text();
    expect(get).toContain('<html lang="en">');
    expect(get).toContain('<title>Confirm your email</title>');
    expect(get).toContain('Press the button and we will send you one email when Holler has enough for you in your area. Nothing else.');
    expect(get).not.toContain('name="lang"');
    const bad = await route.GET(new Request('https://localholler.com/waitlist/confirm?token=bad')).text();
    expect(bad).toContain('It may have expired. Check your ZIP code again to get a new link.');
    const { renderWaitlistConfirm } = await import('@/lib/email/templates');
    const m = renderWaitlistConfirm({ confirmUrl: 'https://x.test/c', place: 'Austin, TX' });
    expect(m.subject).toBe('Confirm: tell me when Holler is ready for me near Austin, TX');
    expect(m.text.startsWith('One click and you are on the list\n\nYou asked Holler to tell you when it has enough permits and city requests near Austin, TX for you. Confirm this address and we will send you one email when it does. Nothing else.\n\nConfirm my email: https://x.test/c\n\nThe link works for 7 days.')).toBe(true);
  });
});
