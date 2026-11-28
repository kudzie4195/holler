/**
 * Round 35: Gwinnett County's own open solicitation list (lib/signals/adapters/gwinnett-site.ts).
 *
 * Fixture tests/signals/__data__/gwinnett-bids-2026-11-28.html: the 23 entries the live page listed on 2026-11-28 (codes, PDF paths, titles,
 * opening dates as read through WebFetch), in markup that stands in for the county's own (the sandbox cannot reach the host; the header of the
 * file says exactly what is real). Buyer e-mails and meeting links are placeholders: the fixture has no personal data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CITY_BIDS_R35_FLAG,
  GWINNETT_AGENCY,
  GWINNETT_LIST_URL,
  GWINNETT_SITE_ID,
  alreadyHeld,
  cityBidsR35Enabled,
  entriesOf,
  gwinnettSiteAdapter,
  noticeUrl,
  parseGwinnett,
  sameAgency,
  solKey,
} from '@/lib/signals/adapters/gwinnett-site';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { missingEnvFor } from '@/lib/signals/run';
import { BIDS_FLAG, BID_SOURCE_IDS, isBidSignal } from '@/lib/signals/bid-sources';
import { labelFor } from '@/lib/signals/lead-rules';
import { bidCardLine } from '@/lib/signals/bid-card';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { sourcePlaces } from '@/lib/admin/metros';
import { ENV_KEYS } from '@/lib/env';
import type { AdapterContext, SignalInput } from '@/lib/signals/types';
import type { Db } from '@/lib/signals/store';

const HTML = readFileSync('tests/signals/__data__/gwinnett-bids-2026-11-28.html', 'utf8');
const NOW = new Date('2026-11-28T17:00:00Z');
const ROBOTS = [
  'User-agent: *',
  'Crawl-delay: 5',
  'Disallow: /*redirect=',
  'Disallow: /*p_p_id=',
  'Disallow: /c/',
  'Disallow: /search',
  '',
  'User-agent: ClaudeBot',
  'Disallow: /',
  '',
  'User-agent: GPTBot',
  'Disallow: /',
].join('\n');

/** The seven numbers that route to a trade on the live list of 2026-11-28 (the same seven the Firecrawl source holds in production). */
const ROUTED: Record<string, string[]> = {
  'BL137-26': ['roofing'],
  'BL153-26': ['fencing'],
  'BL138-26': ['tree-service'],
  'BL099-26': ['concrete-paving'],
  'BL154-26': ['roofing'],
  'BL136-26': ['fencing'],
  'BL160-26': ['electrical'],
};

type Call = { url: string; init?: RequestInit };
function fakeFetch(opts: { robots?: string | number; page?: string; pageStatus?: number; pageType?: string; location?: string } = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/robots.txt')) {
      const r = opts.robots ?? ROBOTS;
      if (typeof r === 'number') return new Response('', { status: r });
      return new Response(r, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    const status = opts.pageStatus ?? 200;
    const headers: Record<string, string> = { 'content-type': opts.pageType ?? 'text/html; charset=utf-8' };
    if (opts.location) headers.location = opts.location;
    return new Response(status >= 300 && status < 400 ? null : (opts.page ?? HTML), { status, headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function ctxFor(f: typeof fetch, env: Record<string, string | undefined>, extra: Partial<AdapterContext> = {}): AdapterContext & { logs: string[] } {
  const logs: string[] = [];
  return { since: new Date(NOW.getTime() - 86_400_000), now: NOW, fetch: f, env, log: (m) => logs.push(m), logs, ...extra };
}

/** A read-only stand-in for the one dedupe query: records the filters and answers with the given rows. */
function stubDb(rows: Array<Record<string, unknown>>, fail = false) {
  const calls: Array<[string, ...unknown[]]> = [];
  const q = {
    select(cols: string) { calls.push(['select', cols]); return q; },
    like(c: string, v: string) { calls.push(['like', c, v]); return q; },
    neq(c: string, v: string) { calls.push(['neq', c, v]); return q; },
    or(v: string) { calls.push(['or', v]); return Promise.resolve(fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }); },
    update() { calls.push(['update']); return q; },
    insert() { calls.push(['insert']); return q; },
    upsert() { calls.push(['upsert']); return q; },
    delete() { calls.push(['delete']); return q; },
  };
  const db = { from: (t: string) => { calls.push(['from', t]); return q; } } as unknown as Db;
  return { db, calls };
}

const ON = { [BIDS_FLAG]: '1', [CITY_BIDS_R35_FLAG]: '1' };

beforeEach(() => resetRobotsCache());
afterEach(() => {
  vi.unstubAllEnvs();
  resetRobotsCache();
});

describe('parse', () => {
  it('reads every entry of the saved page: code, title, opening date, notice link', () => {
    const e = entriesOf(HTML);
    expect(e).toHaveLength(23);
    expect(e[0]).toMatchObject({
      number: 'BL002-27',
      prefix: 'BL',
      title: 'Purchase and Start-Up of Submersible Pumps for Wastewater Pump Stations',
      dueIso: '2027-01-06T20:00:00.000Z',
      url: 'https://www.gwinnettcounty.com/static/upload/bid/802560/BL002-27%20NOT.pdf',
    });
    // 2:00 PM Eastern, not 3:00.
    expect(e.find((x) => x.number === 'BL007-27')?.dueIso).toBe('2026-12-17T19:00:00.000Z');
    // Informal quotes keep their space; the NOT/INV suffix is never part of the number.
    expect(e.map((x) => x.number)).toContain('IWQ 141936');
    expect(e.every((x) => !/\b(?:NOT|INV)$/.test(x.number))).toBe(true);
    // An addendum link or the meeting link is never taken as an entry or a title.
    expect(e.every((x) => !/addend|virtual|buyer|exhibit|cost template/i.test(x.title))).toBe(true);
  });

  it('builds a bid card per routed entry with the agency, due date and public source link', () => {
    const r = parseGwinnett(HTML, NOW);
    expect(r).toMatchObject({ entries: 23, shapeOk: 23, closed: 0, cancelled: 0, noDue: 0, noTrade: 16, duplicates: 0 });
    const it0 = r.items.find((i) => i.data?.solicitationId === 'BL160-26') as SignalInput;
    expect(it0).toMatchObject({
      source: GWINNETT_SITE_ID,
      externalId: 'bids-gwinnett-site:bl16026',
      kind: 'contract',
      title: 'Open bid in Gwinnett County: Gwinnett County Public Library - Dacula Branch Lighting Replacement Project',
      summary: 'Gwinnett County Purchasing | BL160-26 | due 2026-11-30',
      url: 'https://www.gwinnettcounty.com/static/upload/bid/802547/BL160-26%20NOT.pdf',
      city: 'Lawrenceville',
      state: 'GA',
      zip: null,
      expiresAt: '2026-11-30T20:00:00.000Z',
    });
    expect(it0.data).toMatchObject({ bidType: 'Invitation to Bid', subtype: 'bid', buyer: GWINNETT_AGENCY, dueDate: '2026-11-30', loc: 'approx', approxLocation: true, linkKind: 'solicitation' });
    // City level: the county seat's point, the same for every card.
    expect(new Set(r.items.map((i) => `${i.lat},${i.lon}`)).size).toBe(1);
    expect(typeof it0.lat).toBe('number');
    expect(isBidSignal(it0)).toBe(true);
  });

  it('stores no contact detail: no e-mail, no meeting link, no person', () => {
    const r = parseGwinnett(HTML, NOW);
    const text = JSON.stringify(r.items);
    expect(text).not.toMatch(/@|mailto|teams\.microsoft|buyer contact|example\.invalid/i);
    // Even a page whose buyer line holds a real-looking address and phone gives the same cards.
    const withContacts = HTML.replace(/buyer@example\.invalid/g, 'Jane.Doe@gwinnettcounty.com (770) 555-0100');
    expect(JSON.stringify(parseGwinnett(withContacts, NOW).items)).toBe(text);
  });

  it('only accepts notice PDFs on the county host as the link', () => {
    expect(noticeUrl('https://www.gwinnettcounty.com/static/upload/bid/802547/BL160-26 NOT.pdf')).toBe('https://www.gwinnettcounty.com/static/upload/bid/802547/BL160-26%20NOT.pdf');
    expect(noticeUrl('/static/upload/bid/802547/BL160-26%20NOT.pdf')).toBe('https://www.gwinnettcounty.com/static/upload/bid/802547/BL160-26%20NOT.pdf');
    expect(noticeUrl('http://www.gwinnettcounty.com/static/upload/bid/802547/x.pdf')).toBeNull();
    expect(noticeUrl('https://evil.example/static/upload/bid/802547/x.pdf')).toBeNull();
    expect(noticeUrl('https://www.gwinnettcounty.com/static/upload/bid/802547/x.pdf?utm_source=a')).toBeNull();
    expect(noticeUrl('https://www.gwinnettcounty.com/government/x.pdf')).toBeNull();
  });

  it('never throws on junk and reads a different markup of the same text', () => {
    expect(parseGwinnett('', NOW).items).toEqual([]);
    expect(parseGwinnett('<a href="x">', NOW).entries).toBe(0);
    const table = `<table><tr><td><a href="/static/upload/bid/900001/BL200-26 INV.pdf">BL200-26 INV</a></td>
      <td>Janitorial Services for County Buildings</td><td>Opening Date : 12/09/2026 2:00 PM</td></tr></table>`;
    const r = parseGwinnett(table, NOW);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ expiresAt: '2026-12-09T19:00:00.000Z', categories: ['janitorial-commercial', 'cleaning'] });
  });
});

describe('open only', () => {
  it('drops entries whose opening date has passed, keeps the rest', () => {
    const r = parseGwinnett(HTML, new Date('2026-12-08T00:00:00Z'));
    // Open after Dec 8 00:00 UTC: BL137-26, BL153-26, BL138-26 still route; BL099-26 (Dec 7), BL154-26, BL136-26, BL160-26 closed.
    expect(r.items.map((i) => i.data?.solicitationId).sort()).toEqual(['BL137-26', 'BL138-26', 'BL153-26']);
    expect(r.closed).toBe(9);
  });

  it('a bid closes at its opening time, not at the end of the day', () => {
    const before = parseGwinnett(HTML, new Date('2026-11-30T19:59:00Z'));
    const after = parseGwinnett(HTML, new Date('2026-11-30T20:00:00Z'));
    expect(before.items.some((i) => i.data?.solicitationId === 'BL160-26')).toBe(true);
    expect(after.items.some((i) => i.data?.solicitationId === 'BL160-26')).toBe(false);
  });

  it('drops a cancelled entry, an entry without a date, a placeholder date and a repeated number', () => {
    const page = `
      <div><a href="/static/upload/bid/1001/BL300-26 NOT.pdf">BL300-26 NOT</a><p>Roof Replacement at Station 9</p><p>This solicitation has been cancelled.</p><p>Opening Date : 2026-12-20 15:00:00.0 EST</p></div>
      <div><a href="/static/upload/bid/1002/BL301-26 NOT.pdf">BL301-26 NOT</a><p>Roof Repair at Station 10</p><p>Opening Date : TBD</p></div>
      <div><a href="/static/upload/bid/1003/BL302-26 NOT.pdf">BL302-26 NOT</a><p>Roof Repair at Station 11</p><p>Opening Date : 2099-12-31 15:00:00.0 EST</p></div>
      <div><a href="/static/upload/bid/1004/BL303-26 NOT.pdf">BL303-26 NOT</a><p>Roof Repair at Station 12</p><p>Opening Date : 2026-12-20 15:00:00.0 EST</p></div>
      <div><a href="/static/upload/bid/1005/BL303-26 INV.pdf">BL303-26 INV</a><p>Roof Repair at Station 12</p><p>Opening Date : 2026-12-20 15:00:00.0 EST</p></div>`;
    const r = parseGwinnett(page, NOW);
    expect(r.items.map((i) => i.data?.solicitationId)).toEqual(['BL303-26']);
    expect(r).toMatchObject({ cancelled: 1, noDue: 2, duplicates: 1 });
  });
});

describe('trade routing', () => {
  it('routes through the shared bid table: seven of 23 on the live list, the rest are goods, design or utility work', () => {
    const r = parseGwinnett(HTML, NOW);
    const got = Object.fromEntries(r.items.map((i) => [i.data?.solicitationId, i.categories]));
    expect(got).toEqual(ROUTED);
    const per: Record<string, number> = {};
    for (const i of r.items) for (const c of i.categories) per[c] = (per[c] ?? 0) + 1;
    expect(per).toEqual({ roofing: 2, fencing: 2, 'tree-service': 1, 'concrete-paving': 1, electrical: 1 });
    // "Purchase of Milk" and "Transportation Consultant" stay out (supply and paper rules).
    expect(Object.keys(got)).not.toContain('BL156-26');
    expect(Object.keys(got)).not.toContain('RP001-27');
  });

  it('cards label as act now, like every bid with a due date', () => {
    const r = parseGwinnett(HTML, NOW);
    const s = r.items[0];
    expect(labelFor({ source: s.source, kind: s.kind, subtype: 'bid', title: s.title, summary: s.summary ?? '' }, s.categories[0])).toBe('act_now');
  });
});

describe('dedupe against other bid sources', () => {
  const items = () => parseGwinnett(HTML, NOW).items;
  const firecrawlRow = (sol: string, extra: Record<string, unknown> = {}) => ({ source: 'bids-gwinnett', sol, buyer: 'Gwinnett County Purchasing', expires_at: '2026-12-20T20:00:00+00:00', retired: null, ...extra });

  it('drops a number another source holds open for the same agency (suffix and spelling ignored)', async () => {
    const { db, calls } = stubDb([
      firecrawlRow('BL160-26 NOT'),
      firecrawlRow('bl 137-26'),
      { source: 'bids-manual', sol: 'BL153-26', buyer: 'Gwinnett County', expires_at: '2026-12-15T20:00:00+00:00', retired: null },
    ]);
    const held = await alreadyHeld(db, items(), NOW);
    expect([...held].sort()).toEqual(['bids-gwinnett-site:bl13726', 'bids-gwinnett-site:bl15326', 'bids-gwinnett-site:bl16026']);
    // One read, bids only, never its own rows, and no write of any kind.
    expect(calls.filter((c) => c[0] === 'from')).toHaveLength(1);
    expect(calls).toContainEqual(['like', 'source', 'bids-%']);
    expect(calls).toContainEqual(['neq', 'source', GWINNETT_SITE_ID]);
    expect(calls.some((c) => ['update', 'insert', 'upsert', 'delete'].includes(c[0]))).toBe(false);
  });

  it('does not drop for another agency, a retired record or a closed one', async () => {
    const { db } = stubDb([
      firecrawlRow('BL160-26', { buyer: 'City of Atlanta Procurement' }),
      firecrawlRow('BL137-26', { retired: '2026-11-27T00:00:00Z' }),
      firecrawlRow('BL153-26', { expires_at: '2026-11-01T20:00:00+00:00' }),
    ]);
    expect((await alreadyHeld(db, items(), NOW)).size).toBe(0);
  });

  it('the adapter leaves held numbers out, and keeps nothing when the read fails', async () => {
    const all = Object.keys(ROUTED).map((n) => firecrawlRow(n));
    const f1 = fakeFetch();
    const ok = ctxFor(f1.fn, ON, { db: stubDb(all.slice(0, 5)).db });
    const kept = await gwinnettSiteAdapter.fetch(ok);
    expect(kept.map((i) => i.data?.solicitationId).sort()).toEqual(['BL136-26', 'BL160-26']);
    expect(ok.logs.join('\n')).toMatch(/23 listed, 23 readable, 7 open with a trade, 5 already in Holler from another source, 2 kept/);

    resetRobotsCache();
    const f2 = fakeFetch();
    const bad = ctxFor(f2.fn, ON, { db: stubDb([], true).db });
    expect(await gwinnettSiteAdapter.fetch(bad)).toEqual([]);
    expect(bad.logs.join('\n')).toMatch(/could not check other bid sources/);
  });

  it('agency and number helpers', () => {
    expect(solKey('BL160-26 NOT')).toBe(solKey('bl16026'));
    expect(solKey('IWQ 141936 INV')).toBe('iwq141936');
    expect(sameAgency('Gwinnett County', GWINNETT_AGENCY)).toBe(true);
    expect(sameAgency('Cobb County', GWINNETT_AGENCY)).toBe(false);
  });
});

describe('switches and requests', () => {
  it('makes no request at all with either switch off', async () => {
    for (const env of [{}, { [BIDS_FLAG]: '1' }, { [CITY_BIDS_R35_FLAG]: '1' }, { [BIDS_FLAG]: '1', [CITY_BIDS_R35_FLAG]: 'no' }]) {
      vi.unstubAllEnvs();
      vi.stubEnv(BIDS_FLAG, '');
      vi.stubEnv(CITY_BIDS_R35_FLAG, '');
      const f = fakeFetch();
      const ctx = ctxFor(f.fn, env);
      expect(await gwinnettSiteAdapter.fetch(ctx)).toEqual([]);
      expect(f.calls).toHaveLength(0);
      expect(ctx.logs[0]).toMatch(/skipped, HOLLER_(?:CITY_BIDS_R35|BIDS)_ENABLED is off/);
    }
  });

  it('the scan names both switches while they are off (default off)', () => {
    vi.stubEnv(BIDS_FLAG, '');
    vi.stubEnv(CITY_BIDS_R35_FLAG, '');
    expect(cityBidsR35Enabled()).toBe(false);
    expect(missingEnvFor(gwinnettSiteAdapter, {})).toEqual([BIDS_FLAG, CITY_BIDS_R35_FLAG]);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(missingEnvFor(gwinnettSiteAdapter, {})).toEqual([CITY_BIDS_R35_FLAG]);
    vi.stubEnv(CITY_BIDS_R35_FLAG, 'on');
    expect(missingEnvFor(gwinnettSiteAdapter, {})).toEqual([]);
  });

  it('on: robots.txt, then ONE page request with the Holler agent, no redirect following', async () => {
    const f = fakeFetch();
    const ctx = ctxFor(f.fn, ON);
    const items = await gwinnettSiteAdapter.fetch(ctx);
    expect(items).toHaveLength(7);
    expect(f.calls.map((c) => c.url)).toEqual(['https://www.gwinnettcounty.com/robots.txt', GWINNETT_LIST_URL]);
    const page = f.calls[1].init as RequestInit;
    expect((page.headers as Record<string, string>)['User-Agent']).toMatch(/^Holler\/1\.0 \(\+https:\/\/localholler\.com\/bot\)$/);
    expect(page.redirect).toBe('manual');
    expect(ctx.logs.join('\n')).toMatch(/no database in this run/);
  });

  it('robots.txt disallowing Holler, or unreadable, means no page request', async () => {
    for (const robots of ['User-agent: Holler\nDisallow: /', 'User-agent: *\nDisallow: /government/', 503]) {
      resetRobotsCache();
      const f = fakeFetch({ robots });
      const ctx = ctxFor(f.fn, ON);
      expect(await gwinnettSiteAdapter.fetch(ctx)).toEqual([]);
      expect(f.calls.map((c) => c.url)).toEqual(['https://www.gwinnettcounty.com/robots.txt']);
      expect(ctx.logs[0]).toMatch(/not fetched, robots\.txt/);
    }
  });

  it('a redirect, an error status, a non-HTML answer or a changed page is logged, not guessed at', async () => {
    const cases: Array<[Parameters<typeof fakeFetch>[0], RegExp]> = [
      [{ pageStatus: 301, location: 'https://www.gwinnettcounty.com/elsewhere' }, /HTTP 301 redirect not followed/],
      [{ pageStatus: 503 }, /HTTP 503/],
      [{ pageType: 'application/pdf' }, /answered application\/pdf/],
      [{ page: '<html><body><p>New design</p></body></html>' }, /parsed 0 solicitations/],
    ];
    for (const [o, re] of cases) {
      resetRobotsCache();
      const f = fakeFetch(o);
      const ctx = ctxFor(f.fn, ON);
      expect(await gwinnettSiteAdapter.fetch(ctx)).toEqual([]);
      expect(f.calls.filter((c) => c.url === GWINNETT_LIST_URL)).toHaveLength(1);
      expect(ctx.logs.join('\n')).toMatch(re);
    }
  });
});

describe('card copy (EN and ES)', () => {
  it('shows like every agency bid: buyer, due day, Spanish title and summary', () => {
    const s = parseGwinnett(HTML, NOW).items.find((i) => i.data?.solicitationId === 'BL160-26') as SignalInput;
    const row = { buyer: GWINNETT_AGENCY, dueDate: '2026-11-30', expiresAt: s.expiresAt, source: s.source };
    expect(bidCardLine(row, NOW, 'en')).toMatch(/^Buyer: Gwinnett County Purchasing\. Due Nov 30, 2026/);
    expect(bidCardLine(row, NOW, 'es')).not.toMatch(/Buyer|Due /);
    expect(localizeTitle(s.title, 'es', s.source)).toMatch(/Gwinnett/);
    expect(localizeTitle(s.title, 'es', s.source)).toMatch(/^Licitación abierta en Gwinnett County: /);
    expect(localizeSummary(s.summary ?? '', 'es', s.source)).toBe('Gwinnett County Purchasing | BL160-26 | vence el 30 nov 2026');
  });
});

describe('wiring', () => {
  it('registered once, daily, as a bid source with its label, metro and switch', () => {
    expect(ALL_ADAPTERS.filter((a) => a.id === GWINNETT_SITE_ID)).toHaveLength(1);
    expect(gwinnettSiteAdapter.cadenceMinutes).toBe(1440);
    expect(BID_SOURCE_IDS).toContain(GWINNETT_SITE_ID);
    expect(getSourceMeta(GWINNETT_SITE_ID)?.sourceUrl).toBe(GWINNETT_LIST_URL);
    expect(sourceLabelLang(GWINNETT_SITE_ID, 'en')).toBe('Gwinnett County purchasing: open solicitations (county site)');
    expect(sourceLabelLang(GWINNETT_SITE_ID, 'es')).toBe('Compras del condado de Gwinnett: licitaciones abiertas (sitio del condado)');
    expect(sourcePlaces().get(GWINNETT_SITE_ID)).toBe(sourcePlaces().get('bids-gwinnett'));
    expect(ENV_KEYS).toContain(CITY_BIDS_R35_FLAG);
  });
});
