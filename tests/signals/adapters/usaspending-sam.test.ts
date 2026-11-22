/**
 * Fixture provenance (re-checked 2026-11-17)
 * - tests/fixtures/usaspending-awards.json: SOURCED. Top-level keys (spending_level, limit, results, page_metadata) and field names from
 *   https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award.md.
 *   The nested shapes ARE now confirmed from the row builder in
 *   https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/search/v2/views/spending_by_award.py:
 *   NAICS = {code, description}; "Primary Place of Performance" = {location_country_code, country_name, state_code, state_name, city_name,
 *   county_code, county_name, congressional_code, zip4, zip5}. The flat "Place of Performance ..." keys in the fixture follow the contract md but are NOT
 *   row keys in that code path, so the parser reads the nested object first. The second row's bare-string NAICS is a tolerance case, not the real shape.
 *   Request: date_type "last_modified_date" is a listed member in api_contracts/search_filters.md; naics_codes {require,exclude} in the same file;
 *   2/4/6 digit NAICS only. No verbatim POST response was captured (WebFetch is GET only), values are invented.
 * - tests/fixtures/sam-opportunities.json: SOURCED from https://open.gsa.gov/api/get-opportunities-public-api/ (fetched 2026-11-17): totalRecords, limit,
 *   offset, opportunitiesData, item keys, placeOfPerformance.city {code,name} and state {code}, postedDate YYYY-MM-DD, naicsCode string, uiLink, description as a URL.
 *   fullParentPathName is the shape of the docs' second example. Values are invented. ASSUMED: `offset` is a page index in production (the docs say "Page index").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters as usaAdapters, NAICS_PREFIXES, buildUsaSpendingBody, naicsToCategories, parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { adapters as samAdapters, buildSamUrl, parseSam } from '@/lib/signals/adapters/sam';

const fx = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'));

describe('NAICS mapping', () => {
  const cases: [string, string[]][] = [
    ['561720', ['janitorial-commercial', 'cleaning']],
    ['561730', ['landscaping', 'lawn-care']],
    ['238160', ['roofing']],
    ['238220', ['plumbing', 'hvac']],
    ['238210', ['electrical']],
    ['238990', ['general-contractor']],
    ['236220', ['general-contractor']],
    ['562111', ['junk-removal']],
    ['561612', ['security']],
    ['722511', ['food-truck', 'catering']],
    ['511210', []],
    ['', []],
  ];
  for (const [code, expected] of cases) {
    it(`${code || '(empty)'} -> ${expected.join('+') || 'none'}`, () => expect(naicsToCategories(code)).toEqual(expected));
  }
  it('3-digit family 238 does not resolve to a specific trade', () => expect(naicsToCategories('238')).toEqual(['general-contractor']));
});

describe('parseUsaSpending', () => {
  const out = parseUsaSpending(fx('usaspending-awards.json'));
  it('returns the 3 in-scope awards and drops the software contract', () => {
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.kind === 'contract' && s.source === 'usaspending')).toBe(true);
  });
  it('resolves Atlanta, GA to coordinates and maps janitorial NAICS; >= $1M is severity 2', () => {
    const a = out.find((s) => s.externalId.startsWith('CONT_AWD_W912EF26P0042'))!;
    expect(a.city).toBe('Atlanta');
    expect(a.state).toBe('GA');
    expect(a.lat).toBeCloseTo(33.75, 0);
    expect(a.categories).toEqual(['janitorial-commercial', 'cleaning']);
    expect(a.severity).toBe(2);
    expect(a.title).toContain('$2.5M');
    expect(a.url).toContain('https://www.usaspending.gov/award/CONT_AWD_W912EF26P0042');
    expect(a.occurredAt).toBe('2026-11-05T00:00:00.000Z'); // Last Modified Date wins over Start Date (2026-11-03)
  });
  it('handles bare-string NAICS and small awards (severity 1)', () => {
    const l = out.find((s) => s.externalId.startsWith('CONT_AWD_47PA0126F0007'))!;
    expect(l.categories).toContain('landscaping');
    expect(l.severity).toBe(1);
    expect(l.city).toBe('Austin');
  });
  it('request body: contract codes, NAICS require list, 100 results', () => {
    const body = buildUsaSpendingBody(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-16T00:00:00Z'));
    expect(body.filters.award_type_codes).toEqual(['A', 'B', 'C', 'D']);
    expect(body.filters.naics_codes.require).toContain('561720');
    expect(body.filters.time_period[0]).toEqual({ start_date: '2026-11-10', end_date: '2026-11-16', date_type: 'last_modified_date' });
    expect(body.limit).toBe(100);
  });
  it('every NAICS code sent is 2, 4 or 6 digits (the API rejects other lengths with HTTP 400)', () => {
    const codes = buildUsaSpendingBody(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-16T00:00:00Z')).filters.naics_codes.require;
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) {
      expect(c).toMatch(/^\d+$/);
      expect([2, 4, 6]).toContain(c.length);
    }
    expect(NAICS_PREFIXES).toEqual(codes);
  });
  it('every trade rule the mapper uses is reachable from a requested code', () => {
    for (const full of ['236118', '236220', '238160', '238220', '238910', '562111', '562910', '722330', '722511']) {
      const covered = NAICS_PREFIXES.some((p) => full.startsWith(p));
      expect(covered, full).toBe(true);
      expect(naicsToCategories(full).length, full).toBeGreaterThan(0);
    }
  });
  it('occurredAt uses the last modified date (recent activity), not the contract start', () => {
    const old = parseUsaSpending({
      results: [{ 'Award ID': 'OLD1', generated_internal_id: 'CONT_OLD1', Description: 'ROOF REPAIR', 'Start Date': '2019-03-01',
        'Last Modified Date': '2026-11-14 08:30:00', NAICS: { code: '238160' }, 'Primary Place of Performance': { state_code: 'GA', city_name: 'ATLANTA' } }],
    });
    expect(old[0].occurredAt).toBe('2026-11-14T08:30:00.000Z');
  });
  it('adapter POSTs to the spending_by_award endpoint', async () => {
    let method = '';
    let url = '';
    const f = (async (u: string, init?: RequestInit) => {
      url = u;
      method = init?.method ?? '';
      return new Response(JSON.stringify(fx('usaspending-awards.json')), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await usaAdapters[0].fetch({ since: new Date(), fetch: f, env: {}, log: () => {} });
    expect(res.length).toBe(3);
    expect(method).toBe('POST');
    expect(url).toBe('https://api.usaspending.gov/api/v2/search/spending_by_award/');
  });
});

describe('parseSam', () => {
  const out = parseSam(fx('sam-opportunities.json'));
  it('keeps 2 solicitations and drops the award notice', () => {
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.kind === 'contract' && s.source === 'sam-gov')).toBe(true);
  });
  it('maps janitorial and roofing NAICS, resolves city coordinates, sets deadline as expiresAt', () => {
    const j = out.find((s) => s.title.includes('Janitorial'))!;
    expect(j.categories).toEqual(['janitorial-commercial', 'cleaning']);
    expect(j.city).toBe('Atlanta');
    expect(j.lat).not.toBeNull();
    expect(j.expiresAt).toBe('2026-12-01T22:00:00.000Z');
    expect(j.url).toBe('https://sam.gov/opp/a1b2c3d4e5f60718293a4b5c6d7e8f90/view');
    const r = out.find((s) => s.title.includes('Roof'))!;
    expect(r.categories).toEqual(['roofing']);
    expect(r.state).toBe('TX');
    expect(r.city).toBe('Fort Worth');
  });
  it('requires SAM_API_KEY and builds MM/dd/yyyy dates', async () => {
    expect(samAdapters[0].requiresEnv).toEqual(['SAM_API_KEY']);
    const u = buildSamUrl('k', new Date('2026-11-14T00:00:00Z'), new Date('2026-11-16T00:00:00Z'));
    expect(u).toContain('postedFrom=11%2F14%2F2026');
    expect(u).toContain('postedTo=11%2F16%2F2026');
    expect(u).toContain('limit=1000');
    const logs: string[] = [];
    const none = await samAdapters[0].fetch({ since: new Date(), fetch: (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch, env: {}, log: (m) => logs.push(m) });
    expect(none).toEqual([]);
    expect(logs[0]).toContain('SAM_API_KEY');
  });
});

const ERROR_LIKE = /\b(error|failed|failure|timeout|timed out|http\s?[45]\d\d|status\s?[45]\d\d)\b/i; // same pattern as lib/signals/run.ts

async function run(a: (typeof usaAdapters)[number], f: (url: string, init?: RequestInit) => Response | Promise<Response>, env: Record<string, string> = {}) {
  const logs: string[] = [];
  const urls: string[] = [];
  const fetchImpl = (async (u: unknown, init?: RequestInit) => {
    urls.push(String(u));
    return f(String(u), init);
  }) as unknown as typeof fetch;
  const out = await a.fetch({ since: new Date('2026-11-16T00:00:00Z'), fetch: fetchImpl, env, log: (m) => logs.push(m) });
  return { out, logs, urls };
}
const htmlPage = () => new Response('<html><body>Maintenance</body></html>', { status: 200 });

describe('USAspending failure modes', () => {
  it('parses the fixture with no error log', async () => {
    const r = await run(usaAdapters[0], () => new Response(JSON.stringify(fx('usaspending-awards.json')), { status: 200 }));
    expect(r.out).toHaveLength(3);
    expect(r.logs).toEqual([]);
  });
  it('reads the zip from Primary Place of Performance.zip5 when the flat key is absent', () => {
    const out = parseUsaSpending({ results: [{ generated_internal_id: 'CONT_X', Description: 'ROOF REPAIR', NAICS: { code: '238160' }, 'Primary Place of Performance': { state_code: 'GA', city_name: 'ATLANTA', zip5: '30303' } }] });
    expect(out[0].zip).toBe('30303');
  });
  for (const status of [400, 401, 403, 422, 429, 500, 503]) {
    it(`HTTP ${status} logs an error-like line and returns []`, async () => {
      const r = await run(usaAdapters[0], () => new Response('{"detail":"bad"}', { status }));
      expect(r.out).toEqual([]);
      expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes(String(status)))).toBe(true);
    });
  }
  it('an HTML page with 200 logs an error', async () => {
    const r = await run(usaAdapters[0], htmlPage);
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('a changed wrapper key logs an error', async () => {
    const r = await run(usaAdapters[0], () => new Response(JSON.stringify({ awards: [{ id: 1 }] }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => /no results array/.test(l) && ERROR_LIKE.test(l))).toBe(true);
  });
  it('N rows and 0 parsed logs the silent-empty error', async () => {
    const r = await run(usaAdapters[0], () => new Response(JSON.stringify({ results: [{ internal_id: 1 }, { internal_id: 2, 'Award ID': 'A' }] }), { status: 200 }));
    expect(r.out).toEqual([]);
    expect(r.logs).toContain('error: parsed 0 of 2 rows, shape may have changed');
  });
  it('an empty results array is a quiet day', async () => {
    const r = await run(usaAdapters[0], () => new Response('{"results":[],"page_metadata":{"page":1,"hasNext":false}}', { status: 200 }));
    expect(r.logs).toEqual([]);
  });
});

describe('SAM failure modes and paging', () => {
  const env = { SAM_API_KEY: 'k' };
  it('parses the fixture with no error log', async () => {
    const r = await run(samAdapters[0], () => new Response(JSON.stringify(fx('sam-opportunities.json')), { status: 200 }), env);
    expect(r.out).toHaveLength(2);
    expect(r.logs).toEqual([]);
    expect(r.urls).toHaveLength(1); // totalRecords 3 fits in one page
  });
  for (const status of [400, 401, 403, 429, 500]) {
    it(`HTTP ${status} logs an error-like line and returns []`, async () => {
      const r = await run(samAdapters[0], () => new Response('{"message":"x"}', { status }), env);
      expect(r.out).toEqual([]);
      expect(r.logs.some((l) => ERROR_LIKE.test(l) && l.includes(String(status)))).toBe(true);
    });
  }
  it('404 "No Data found" is a quiet empty window, any other 404 is an error', async () => {
    const quiet = await run(samAdapters[0], () => new Response('No Data found', { status: 404 }), env);
    expect(quiet.logs).toEqual([]);
    const bad = await run(samAdapters[0], () => new Response('Not Found', { status: 404 }), env);
    expect(bad.logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('an HTML page with 200 logs an error', async () => {
    const r = await run(samAdapters[0], htmlPage, env);
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => ERROR_LIKE.test(l))).toBe(true);
  });
  it('a changed wrapper key logs an error', async () => {
    const r = await run(samAdapters[0], () => new Response(JSON.stringify({ totalRecords: 5, opportunities: [{ noticeId: 'a' }] }), { status: 200 }), env);
    expect(r.out).toEqual([]);
    expect(r.logs.some((l) => /no opportunitiesData array/.test(l) && ERROR_LIKE.test(l))).toBe(true);
  });
  it('rows with no noticeId/title log the silent-empty error', async () => {
    const r = await run(samAdapters[0], () => new Response(JSON.stringify({ totalRecords: 2, opportunitiesData: [{ id: 'a' }, { id: 'b' }] }), { status: 200 }), env);
    expect(r.logs).toContain('error: parsed 0 of 2 rows, shape may have changed');
  });
  it('25 or more well-formed notices that all fall outside our trades is an error; a handful is quiet', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ noticeId: `n${i}`, title: 'Software license renewal', type: 'Solicitation', naicsCode: '511210', postedDate: '2026-11-14', placeOfPerformance: { state: { code: 'VA' } } }));
    const big = await run(samAdapters[0], () => new Response(JSON.stringify({ totalRecords: 30, opportunitiesData: mk(30) }), { status: 200 }), env);
    expect(big.logs.some((l) => /parsed 0 of 30 rows/.test(l))).toBe(true);
    const small = await run(samAdapters[0], () => new Response(JSON.stringify({ totalRecords: 3, opportunitiesData: mk(3) }), { status: 200 }), env);
    expect(small.logs).toEqual([]);
  });
  it('offset is a page index: pages 0, 1, 2 for a 2500 record window, then stops', async () => {
    const page = (n: number) => ({ totalRecords: 2500, limit: 1000, offset: n, opportunitiesData: [] });
    let i = 0;
    const r = await run(samAdapters[0], () => new Response(JSON.stringify(page(i++)), { status: 200 }), env);
    expect(r.urls.map((u) => new URL(u).searchParams.get('offset'))).toEqual(['0', '1', '2']);
  });
  it('a 7 day window at most, MM/dd/yyyy, api_key param', () => {
    const u = new URL(buildSamUrl('KEY', new Date('2026-10-01T00:00:00Z'), new Date('2026-11-16T00:00:00Z')));
    expect(u.searchParams.get('api_key')).toBe('KEY');
    expect(u.searchParams.get('postedFrom')).toBe('11/09/2026');
    expect(u.searchParams.get('postedTo')).toBe('11/16/2026');
    expect(u.searchParams.get('offset')).toBe('0');
  });
});

import { isSupplyBuy } from '@/lib/signals/adapters/sam';
describe('SAM supply buys are dropped', () => {
  it('goods NAICS and numeric supply classes are supply buys', () => {
    expect(isSupplyBuy('333995', '36--GENERATOR,OXYGEN-NITRO')).toBe(true);
    expect(isSupplyBuy('335931', 'REPAIR KIT,ELECTRICAL')).toBe(true);
    expect(isSupplyBuy(null, '16--GENERATOR CONTROL U, IN REPAIR/MO')).toBe(true);
    expect(isSupplyBuy('423610', 'Wire and cable')).toBe(true);
  });
  it('service and construction notices are kept', () => {
    expect(isSupplyBuy('238220', 'Z1DA--NRM CONST - Replace Boiler')).toBe(false);
    expect(isSupplyBuy('561720', 'S--BGNDRF CUSTODIAL SERVICES')).toBe(false);
    expect(isSupplyBuy('811310', 'Repair HVAC Seedling Cooler')).toBe(false);
    expect(isSupplyBuy(null, 'J026--Pneumatic Tube System Preventive Maintenance')).toBe(false);
  });
});

describe('SAM location and snow (final review)', () => {
  const base = { noticeId: 'n1', type: 'Solicitation', naicsCode: '561730', postedDate: '2026-11-20', fullParentPathName: 'DEFENSE.AIR FORCE' };
  it('never places a bid at the contracting office', () => {
    const rows = parseSam({ opportunitiesData: [{ ...base, title: 'Grounds maintenance', officeAddress: { city: 'MOBILE', state: 'AL' }, placeOfPerformance: {} }] });
    expect(rows).toHaveLength(0);
    const fl = parseSam({ opportunitiesData: [{ ...base, title: 'Grounds maintenance', officeAddress: { city: 'MOBILE', state: 'AL' }, placeOfPerformance: { state: { code: 'FL' } } }] });
    expect(fl[0].state).toBe('FL');
    expect(fl[0].title).toMatch(/^Federal bid in FL:/);
  });
  it('a snow removal title goes to snow removal whatever the NAICS', () => {
    const rows = parseSam({ opportunitiesData: [{ ...base, title: 'DOI-NPS Snow Removal Services', placeOfPerformance: { state: { code: 'VA' } } }] });
    expect(rows[0].categories).toEqual(['snow-removal']);
  });
});
