/**
 * Fixture provenance
 * - tests/fixtures/usaspending-awards.json: top-level shape (results[], page_metadata.hasNext, field names such as "Award ID",
 *   "Place of Performance State Code", "generated_internal_id") is SOURCED from
 *   https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award.md.
 *   The nested shapes of "Primary Place of Performance" ({state_code, city_name}) and "NAICS" ({code, description}) are ASSUMED;
 *   the second fixture row uses a bare string NAICS to cover the other possibility.
 * - tests/fixtures/sam-opportunities.json: top-level keys and item field names are SOURCED from https://open.gsa.gov/api/get-opportunities-public-api/.
 *   placeOfPerformance.city/state as {code,name} objects and totalRecords are ASSUMED.
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
