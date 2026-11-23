/**
 * Round 15 integration (unit I): the five branches' card additions render together, once each.
 *   routing    label chip, deadline, routed "Why it matters" sentence, score order
 *   newsources "Managed by" / "Owner company" line (NYC heat)
 *   contacts   "Job value on the permit" and "Contractor license number"
 *   health     coverage notice in the feed header (tests/signals/ship-page.test.ts renders the real page)
 *   sources    new source ids (no card field)
 * Cards are built by the real parsers and matcher (ship-fixtures.ts). Writes the pages for the screenshots when HOLLER_SHOTS_DIR is set.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));
vi.mock('server-only', () => ({}));

// The mobile builder reads contacts through the member loader; here it returns the contacts the real parser produced for the case.
const contactStore = new Map<number, Record<string, unknown>[]>();
vi.mock('@/lib/outreach/loader', () => ({
  loadMemberContacts: async ({ signalIds }: { signalIds: number[] }) =>
    new Map(signalIds.filter((id) => contactStore.has(id)).map((id) => [id, contactStore.get(id)!.map((c) => ({ ...c, signalId: id }))])),
}));
vi.mock('@/lib/feedback/service', () => ({ loadFeedback: async () => new Map() }));

import { Feed } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { CoverageNoticeLine } from '@/components/coverage-notice';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { cardBrief } from '@/lib/signals/brief';
import { NOW, iso } from './brief-fixtures';
import { shipCases, shipDigestItem, shipFeedItem, type ShipCase } from './ship-fixtures';

let cases: ShipCase[];
beforeAll(async () => {
  cases = await shipCases();
  for (const c of cases) if (c.contacts?.length) contactStore.set(c.signal.id, c.contacts as unknown as Record<string, unknown>[]);
});

const count = (hay: string, needle: string | RegExp) => (typeof needle === 'string' ? hay.split(needle).length - 1 : (hay.match(needle) ?? []).length);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const caseNamed = (re: RegExp) => cases.find((c) => re.test(c.name))!;

function webCards(): { c: ShipCase; html: string }[] {
  const raw = renderToStaticMarkup(createElement(Feed, { items: cases.map(shipFeedItem), cityPage: null }));
  const parts = raw.split('<li><article').slice(1);
  expect(parts.length).toBe(cases.length);
  // the feed orders cards by label; match each chunk back to its case by the signal title (two cases share the no-heat title: the one with a company is told apart by its name)
  const used = new Set<ShipCase>();
  return parts.map((html) => {
    const same = cases.filter((c) => !used.has(c) && (html.includes(c.signal.title) || html.includes(c.signal.title.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'))));
    const c = same.find((k) => (k.managerName ? html.includes(k.managerName) : !/(Managed by|Owner company):/.test(html))) ?? same[0];
    used.add(c);
    return { html, c };
  });
}

describe('web card: every part once, on every card', () => {
  it('each card has one label chip, one brief (why, next, source, uncertain) and none of the additive lines twice', () => {
    for (const { c, html } of webCards()) {
      expect(c, 'card matched back to its fixture').toBeTruthy();
      const t = text(html);
      expect(count(html, 'data-testid="brief"'), c.name).toBe(1);
      for (const part of ['brief-why', 'brief-next', 'brief-source', 'brief-uncertain']) expect(count(html, `data-testid="${part}"`), `${c.name} ${part}`).toBe(1);
      expect(count(t, 'Why it matters:'), c.name).toBe(1);
      expect(count(t, 'Next step:'), c.name).toBe(1);
      expect(count(t, 'What is uncertain:'), c.name).toBe(1);
      expect(count(t, /Job value on the permit/g), `${c.name} value line`).toBeLessThanOrEqual(1);
      expect(count(t, /(Managed by|Owner company):/g), `${c.name} manager line`).toBeLessThanOrEqual(1);
      expect(count(t, /Contractor license number/g), `${c.name} licence`).toBeLessThanOrEqual(1);
      // a deadline sentence appears at most once
      expect(count(t, /Deadline: /g), `${c.name} deadline`).toBeLessThanOrEqual(1);
    }
  });

  it('the NYC heat card shows the registered company once, between "Next step" and "Source", and no contact block repeats it', () => {
    const c = caseNamed(/registered company/);
    const { html } = webCards().find((w) => w.c === c)!;
    const t = text(html);
    expect(count(t, /(Managed by|Owner company):/g)).toBe(1);
    expect(t).toMatch(/(Managed by|Owner company): .+ \(from the city's building registration\)/);
    expect(html.indexOf('data-testid="brief-next"')).toBeLessThan(html.indexOf('data-testid="brief-managed"'));
    expect(html.indexOf('data-testid="brief-managed"')).toBeLessThan(html.indexOf('data-testid="brief-source"'));
    expect(t).not.toContain('Contractor license number');
    expect(t).not.toContain('Job value on the permit');
    expect(count(t, c.managerName!)).toBe(1);
  });

  it('the Raleigh permit shows the value above "Why it matters" and the licence number in the contact block, each once', () => {
    const c = caseNamed(/Raleigh/);
    const { html } = webCards().find((w) => w.c === c)!;
    const t = text(html);
    expect(count(t, 'Job value on the permit: $12,500')).toBe(1);
    expect(html.indexOf('data-testid="brief-value"')).toBeLessThan(html.indexOf('data-testid="brief-why"'));
    expect(count(t, 'Contractor license number: 75000')).toBe(1);
    expect(t).not.toMatch(/Managed by|Owner company/);
    // the company and phone come with the licence
    expect(t).toContain('SUMMIT ROOFING & SIDING INC');
  });

  it('a permit whose value is only in its summary prints it once (the Chicago roof permit)', () => {
    const c = caseNamed(/own-trade permit/);
    const { html } = webCards().find((w) => w.c === c)!;
    expect(count(text(html), /Job value on the permit: \$14,500/g)).toBe(1);
  });

  it('chip, deadline and brief on an Act Now card with a deadline (federal bid)', () => {
    const c = caseNamed(/federal bid/);
    const { html } = webCards().find((w) => w.c === c)!;
    const t = text(html);
    expect(t).toContain('Act now');
    expect(t).toContain('Nov 30, 2026'); // the bid's response date is the day 2026-11-30 (stored as midnight UTC), not the evening before
    expect(count(html, 'data-testid="brief"')).toBe(1);
  });

  it('a routed (downstream) permit card is Coming soon with the one fixed sentence', () => {
    const c = caseNamed(/new-home permit for a mover/);
    expect(c.label).toBe('coming_soon');
    const { html } = webCards().find((w) => w.c === c)!;
    expect(text(html)).toContain('A new-home permit was filed nearby; people may move in once it is built.');
  });

  it('a locked member gets none of the additive lines (value, company, licence) on any card', () => {
    const items = cases.map(shipFeedItem).map((i) => ({ ...i, jobValue: null, managerName: null, managerRole: null, contacts: undefined, summary: null }));
    const html = renderToStaticMarkup(createElement(Feed, { items, cityPage: null }));
    expect(text(html)).not.toMatch(/Managed by|Owner company|Contractor license number/);
  });
});

describe('both branches changed cardBrief: both lines, each only on its own record family', () => {
  const both = { jobValue: 12500, managerName: 'PRESTIGE MANAGEMENT INC.', managerRole: 'agent' };
  it('a permit given manager fields prints the value and no manager line', () => {
    const b = cardBrief({ source: 'arcgis-raleigh-permits', kind: 'permit', subtype: 'permit', title: 'Roof permit in Raleigh', label: 'market_insight', trade: 'roofing', ...both });
    expect(b.valueLine).toBe('Job value on the permit: $12,500');
    expect(b.managedBy).toBeNull();
  });
  it('a no-heat 311 given a job value prints the company and no value line', () => {
    const b = cardBrief({ source: 'socrata-nyc-311', kind: 'permit', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', label: 'act_now', trade: 'hvac', ...both });
    expect(b.managedBy).toBe("Managed by: PRESTIGE MANAGEMENT INC. (from the city's building registration)");
    expect(b.valueLine).toBeNull();
  });
  it('the routed sentence (routing branch) and the value line (contacts branch) come out of the same call', () => {
    const b = cardBrief({
      source: 'arcgis-atlanta-permits', kind: 'permit', subtype: 'permit', title: 'New home permit in Atlanta', label: 'coming_soon', trade: 'moving',
      jobValue: 250000, managerName: both.managerName, managerRole: both.managerRole,
    });
    expect(b.why).toContain('new-home permit');
    expect(b.valueLine).toBe('Job value on the permit: $250,000');
    expect(b.managedBy).toBeNull();
  });
});

describe('mobile DTO carries every additive field', () => {
  const row = (c: ShipCase, i: number): MatchRow => {
    const d = (c.signal.data ?? {}) as Record<string, unknown>;
    return {
      id: i + 1, status: 'new', distance_mi: c.match.distance_mi, draft: null, created_at: iso(-3_600_000),
      signal: {
        id: c.signal.id, source: c.signal.source, kind: c.signal.kind, subtype: (d.subtype as string | undefined) ?? null, title: c.signal.title,
        summary: c.signal.summary ?? null, url: c.signal.url ?? null, city: c.signal.city ?? null, state: c.signal.state ?? null, county: null, zip: null,
        severity: c.signal.severity, categories: c.signal.categories, occurred_at: c.signal.occurredAt, expires_at: c.signal.expiresAt ?? null,
        dueDate: (d.dueDate as string | undefined) ?? null, bidBuyer: (d.buyer as string | undefined) ?? null,
        jobValue: d.jobValue === undefined ? null : String(d.jobValue), managerName: (d.managerName as string | undefined) ?? null,
        managerRole: (d.managerRole as string | undefined) ?? null,
      },
    } as unknown as MatchRow;
  };
  const build = (locked: boolean) =>
    buildAlerts(cases.map(row), { userId: 'u1', locked, db: {} as never, admin: {} as never, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: undefined });

  it('label, deadline, brief (5 parts), managedBy, valueLine and the licence number are all there for the cards that have them', async () => {
    const out = await build(false);
    const heat = out.find((a) => /HEAT/.test(a.title) && a.brief.managedBy)!;
    expect(heat.brief.managedBy).toMatch(/^(Managed by|Owner company): .+ \(from the city's building registration\)$/);
    expect(heat.label).toBe('act_now');
    const raleigh = out.find((a) => a.source === 'arcgis-raleigh-permits')!;
    expect(raleigh.brief.valueLine).toBe('Job value on the permit: $12,500');
    expect(raleigh.contacts.find((c) => c.role === 'contractor')?.license).toBe('75000');
    expect(raleigh.brief.managedBy).toBeUndefined();
    const bid = out.find((a) => /Roof Replacement/.test(a.title))!;
    expect(bid.deadline).toBeTruthy();
    for (const a of out) {
      expect(a.label, a.title).toBeTruthy();
      for (const k of ['why', 'next', 'uncertain', 'confidence'] as const) expect(a.brief[k], `${a.title} ${k}`).toBeTruthy();
      expect(a.brief.source.label, a.title).toBeTruthy();
    }
  });

  it('a locked member gets no value line, no company and no licence', async () => {
    const out = await build(true);
    for (const a of out) {
      expect(a.brief.valueLine ?? null, a.title).toBeNull();
      expect(a.brief.managedBy, a.title).toBeUndefined();
      expect(a.contacts, a.title).toEqual([]);
    }
  });
});

describe('a permit prints its job value exactly once, on web, mobile and digest', () => {
  const sumOf = (c: ShipCase) => c.signal.summary ?? '';
  const mobile = async (list: ShipCase[]) => {
    const rows = list.map((c, i) => {
      const d = (c.signal.data ?? {}) as Record<string, unknown>;
      return {
        id: i + 1, status: 'new', distance_mi: c.match.distance_mi, draft: null, created_at: iso(-3_600_000),
        signal: {
          id: c.signal.id, source: c.signal.source, kind: c.signal.kind, subtype: (d.subtype as string | undefined) ?? null, title: c.signal.title, summary: c.signal.summary ?? null,
          url: c.signal.url ?? null, city: c.signal.city ?? null, state: c.signal.state ?? null, county: null, zip: null, severity: c.signal.severity, categories: c.signal.categories,
          occurred_at: c.signal.occurredAt, expires_at: null, jobValue: d.jobValue === undefined ? null : String(d.jobValue),
        },
      } as unknown as MatchRow;
    });
    return buildAlerts(rows, { userId: 'u1', locked: false, db: {} as never, admin: {} as never, siteUrl: 'https://localholler.com', now: NOW.getTime() });
  };

  it.each([
    ['Raleigh permit (data.jobValue)', /Raleigh/, '$12,500'],
    ['Chicago roof permit (data.jobValue)', /own-trade permit/, '$14,500'],
  ])('%s: the value is in the brief line only', async (_n, re, money) => {
    const c = caseNamed(re);
    expect(sumOf(c)).toContain(`${money} job value`); // the stored summary is untouched
    // web
    const { html } = webCards().find((w) => w.c === c)!;
    const t = text(html);
    expect(count(t, money), 'web: the amount appears once').toBe(1);
    expect(count(t, 'Job value on the permit:')).toBe(1);
    expect(t).not.toContain('job value');
    // mobile
    const a = (await mobile([c]))[0];
    expect(a.brief.valueLine).toBe(`Job value on the permit: ${money}`);
    expect(a.summary ?? '').not.toContain('job value');
    expect(count(JSON.stringify(a), money), 'mobile: the whole alert prints the amount once').toBe(1);
    // digest
    const { html: dh, text: dt } = renderDigest({ businessName: 'X', items: [shipDigestItem(c)], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
    expect(count(text(dh), money)).toBe(1);
    expect(count(dt, money)).toBe(1);
  });

  it('the stored summary keeps its other parts (type, class, street) after the value part is left out', () => {
    const c = caseNamed(/Raleigh/);
    const { html } = webCards().find((w) => w.c === c)!;
    expect(text(html)).toContain('Residential Building | Alteration | 100 TEST ST');
  });

  it('a mobile alert keeps the street and type parts of the summary', async () => {
    const a = (await mobile([caseNamed(/Raleigh/)]))[0];
    expect(a.summary).toBe('Residential Building | Alteration | 100 TEST ST');
  });

  it('a card with no parsed value shows its summary unchanged on web and mobile (new-home permit; a "$1 job value" placeholder; a non-permit)', async () => {
    const mover = caseNamed(/new-home permit for a mover/);
    const hail = caseNamed(/hail report/);
    for (const c of [mover, hail]) {
      const { html } = webCards().find((w) => w.c === c)!;
      if (c.signal.summary) expect(html).toContain(c.signal.summary.replace(/&/g, '&amp;'));
      const a = (await mobile([c]))[0];
      expect(a.summary).toBe(c.signal.summary ?? null);
      expect(a.brief.valueLine ?? null).toBeNull();
    }
    // a placeholder value is not a job value (below the minimum): no line, and the summary part stays
    const raleigh = caseNamed(/Raleigh/);
    const placeholder: ShipCase = { ...raleigh, jobValue: null, signal: { ...raleigh.signal, summary: 'Residential Building | Alteration | $1 job value | 100 TEST ST', data: { ...(raleigh.signal.data ?? {}), jobValue: undefined } } };
    const items = [placeholder].map(shipFeedItem);
    const html = renderToStaticMarkup(createElement(Feed, { items, cityPage: null }));
    expect(text(html)).toContain('Residential Building | Alteration | $1 job value | 100 TEST ST');
    expect(text(html)).not.toContain('Job value on the permit');
    const a = (await mobile([placeholder]))[0];
    expect(a.summary).toBe('Residential Building | Alteration | $1 job value | 100 TEST ST');
  });
});

describe('digest html and text carry the same additions, once', () => {
  const d = () => renderDigest({ businessName: 'Fixture members', items: cases.map(shipDigestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });

  it('html: value line before "Why it matters", company after "Next step", each once for its card', () => {
    const { html } = d();
    const t = text(html);
    expect(count(t, 'Job value on the permit: $12,500')).toBe(1);
    expect(count(t, 'Job value on the permit: $14,500')).toBe(1);
    expect(count(t, /(Managed by|Owner company):/g)).toBe(1);
    const items = html.split('<li ').slice(1);
    for (const li of items) {
      expect(count(li, 'Job value on the permit')).toBeLessThanOrEqual(1);
      expect(count(li, /Managed by:|Owner company:/g)).toBeLessThanOrEqual(1);
      expect(count(li, 'Why it matters:')).toBe(1);
      expect(count(li, 'Source:')).toBe(1);
    }
  });

  it('text: same lines, same order', () => {
    const { text: tx } = d();
    expect(count(tx, 'Job value on the permit: $12,500')).toBe(1);
    expect(count(tx, /(Managed by|Owner company): /g)).toBe(1);
    const blocks = tx.split('\n\n').filter((b) => b.includes('Why it matters:'));
    for (const b of blocks) {
      if (b.includes('Job value on the permit')) expect(b.indexOf('Job value on the permit')).toBeLessThan(b.indexOf('Why it matters:'));
      if (/Managed by|Owner company/.test(b)) expect(b.indexOf('Next step:')).toBeLessThan(b.search(/Managed by|Owner company/));
    }
  });
});

describe.skipIf(!process.env.HOLLER_SHOTS_DIR)('write the pages for the screenshots', () => {
  it('feed.html', () => {
    const dir = process.env.HOLLER_SHOTS_DIR!;
    mkdirSync(dir, { recursive: true });
    const css = process.env.HOLLER_SHOTS_CSS ?? '/_next/static/css/app.css';
    const items = cases.map(shipFeedItem);
    // the card order the page gives: Act now, Coming soon, Market insight (lib/signals/lead-rules orderByLabel)
    const rank = { act_now: 0, coming_soon: 1, market_insight: 2, context: 3 } as const;
    const ordered = [...items].sort((a, b) => (rank[a.label ?? 'coming_soon'] ?? 1) - (rank[b.label ?? 'coming_soon'] ?? 1));
    const body = renderToStaticMarkup(createElement(Feed, { items: ordered, cityPage: null }));
    // the real notice, built by the real coverageNotice() from a source-state snapshot (assumed values: Atlanta permits last updated 9 hours ago)
    const line = coverageNotice({
      lat: 33.75, lon: -84.39, radiusMi: 25, trades: ['roofing'], now: NOW.getTime(),
      states: { 'arcgis-atlanta-permits': { state: 'delayed', lastRecordAt: iso(-9 * 3_600_000) } } as never,
    })?.line ?? null;
    expect(line).toContain('Atlanta permits are delayed');
    const notice = `<div style="margin:16px 0">${renderToStaticMarkup(createElement(CoverageNoticeLine, { line }))}</div>`;
    writeFileSync(
      join(dir, 'feed.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Feed, round 15</title><link rel="stylesheet" href="${css}"></head><body class="bg-canvas"><main class="mx-auto max-w-3xl px-4 py-6"><h1 class="text-5xl text-ink">Your matches</h1>${notice}${body}</main></body></html>`,
    );
    expect(body).toContain('data-testid="brief"');
  });
});
