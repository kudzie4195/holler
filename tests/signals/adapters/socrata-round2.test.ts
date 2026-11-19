/**
 * Fixture provenance (tests/fixtures/socrata-*.json added in round 2)
 * - Column NAMES: sourced from https://<domain>/api/views/<id>.json on 2026-11-17 (see verifiedUrl in socrata-datasets.ts).
 * - Value VOCABULARIES (Chicago application_type ISSUE, Austin case descriptions, NYC event types, Orlando worktype, KC issue_type,
 *   Oakland reqcategory, Cambridge permit_type, Norfolk type/work_type, Buffalo aptype): sourced from live group-by queries the same day.
 * - Row values (names, addresses, ids, coordinates): assumed, hand written. Owner/person columns are included on purpose to prove they never reach output.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSocrataAdapter, buildSocrataQuery, parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', n), 'utf8'));
const ds = (id: string): SocrataDataset => {
  const d = SOCRATA_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const run = (id: string) => parseSocrata(fx(`${id}.json`), ds(id));
const BUSINESS_TRADES = ['signs-printing', 'business-services', 'insurance', 'janitorial-commercial', 'security', 'cleaning', 'locksmith'];

describe('business parsers', () => {
  it('Chicago: license type only (no name, no address); food gets pest-control + hvac; no owner names', () => {
    const out = run('socrata-chicago-business');
    expect(out).toHaveLength(3);
    const cafe = out.find((s) => s.externalId === '3011111-20261112')!;
    expect(cafe.kind).toBe('civic');
    expect(cafe.data?.subtype).toBe('business');
    expect(cafe.title).toBe('New business license in Chicago: Retail Food Establishment');
    expect(cafe.summary).not.toMatch(/WINDY CITY|N CLARK|CLARK ST/i);
    expect(cafe.categories).toEqual(expect.arrayContaining([...BUSINESS_TRADES, 'pest-control', 'hvac']));
    expect(out.find((s) => s.externalId === '3011112-20261113')!.categories).not.toContain('pest-control');
    expect(out.find((s) => s.externalId === '3011113-20261113')!.title).toMatch(/^New business license in Chicago: Regulated/);
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE OWNER|JANE Q SAMPLE/);
  });
  it('a roofing business name does not make a roofing lead', () => {
    const d = ds('socrata-chicago-business');
    const out = parseSocrata([{ id: 'x1', doing_business_as_name: 'ACME ROOFING', license_description: 'Limited Business License', date_issued: '2026-11-12T00:00:00.000' }], d);
    expect(out[0].categories).not.toContain('roofing');
  });
  it('SF, LA, NYC, Orlando parse; owner fields never appear', () => {
    const sf = run('socrata-sf-business');
    expect(sf).toHaveLength(2);
    expect(sf[0].lat).toBe(37.76); // business points are rounded to 2 decimals
    expect(sf[0].categories).toContain('pest-control');
    const la = run('socrata-la-business');
    expect(la).toHaveLength(2);
    expect(la[0].title).toMatch(/^New business license in Los Angeles: /);
    expect(JSON.stringify(la)).not.toMatch(/SUNSET PIZZA/);
    expect(la[1].title).toMatch(/^New business license in Los Angeles: Administrative/);
    const nyc = run('socrata-nyc-business');
    expect(nyc).toHaveLength(2);
    expect(nyc[1].data?.approxLocation).toBe(true);
    const orl = run('socrata-orlando-business');
    expect(orl).toHaveLength(2);
    expect(orl[0].categories).toContain('hvac');
    expect(orl[0].lat).toBe(28.55);
    const all = JSON.stringify([...sf, ...la, ...nyc, ...orl]);
    expect(all).not.toMatch(/SAMPLE OWNER|ANOTHER OWNER|JOHN SAMPLE|JANE SAMPLE|SAMPLE PERSON|ANOTHER PERSON|PRIVATE OWNER|example\.com/);
  });
  it('business queries: ISSUE filter, capped at now, 14 day lookback (NYC 30)', () => {
    const now = new Date('2026-11-17T18:00:00Z');
    const w = buildSocrataQuery(ds('socrata-chicago-business'), now).get('$where')!;
    expect(w).toContain("date_issued > '2026-11-03T12:00:00'");
    expect(w).toContain("date_issued <= '2026-11-17T12:00:00'");
    expect(w).toContain("application_type = 'ISSUE'");
    expect(buildSocrataQuery(ds('socrata-nyc-business'), now).get('$where')).toContain("license_creation_date > '2026-10-18T14:00:00'");
  });
});

describe('violation parsers', () => {
  it('Chicago: trades from violation text, elevator and inspection codes dropped, no inspector comments', () => {
    const out = run('socrata-chicago-violations');
    expect(out.map((s) => s.externalId).sort()).toEqual(['13001', '13003', '13005']);
    expect(out.find((s) => s.externalId === '13001')!.categories).toEqual(expect.arrayContaining(['general-contractor', 'handyman']));
    expect(out.find((s) => s.externalId === '13005')!.categories).toEqual(expect.arrayContaining(['pest-control', 'junk-removal']));
    expect(out[0].title).toMatch(/^Code violation in Chicago: /);
    expect(out[0].kind).toBe('civic');
    expect(JSON.stringify(out)).not.toMatch(/JOHN DOE|NOTIFIED/);
  });
  it('Austin: abatement, structure, no-permit map; land use dropped; inspector hidden', () => {
    const out = run('socrata-austin-violations');
    expect(out).toHaveLength(3);
    expect(out.find((s) => s.externalId === '2026-401001')!.categories).toEqual(expect.arrayContaining(['junk-removal', 'lawn-care', 'landscaping']));
    expect(out.find((s) => s.externalId === '2026-401002')!.categories).toContain('handyman');
    expect(out.find((s) => s.externalId === '2026-401004')!.categories).toContain('general-contractor');
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE INSPECTOR/);
  });
});

describe('event permit parsers', () => {
  it('NYC: kind event, trades, approx location, expiresAt from end, event_name not used', () => {
    const out = run('socrata-nyc-events');
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('event');
    expect(out[0].categories).toEqual(expect.arrayContaining(['food-truck', 'catering', 'event-services', 'security', 'cleaning']));
    expect(out[0].expiresAt).toBe('2026-11-21T21:00:00.000Z');
    expect(out[0].data?.approxLocation).toBe(true);
    expect(out[0].title).toMatch(/^Permitted event in New York City: Street Event at 5 AVENUE/);
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE HOST/);
  });
  it('Chicago parks: composite id, no requestor or organization', () => {
    const out = run('socrata-chicago-events');
    expect(out).toHaveLength(2);
    expect(out[0].externalId).toBe('1042:2026-11-21T00:00:00.000:Permit - Event 1 Cluster 3');
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE REQUESTOR|PRIVATE ORG|gathering/);
  });
  it('event windows look forward 14 days and back 1', () => {
    const w = buildSocrataQuery(ds('socrata-nyc-events'), new Date('2026-11-17T15:00:00Z')).get('$where')!;
    expect(w).toContain("start_date_time > '2026-11-16T10:00:00'");
    expect(w).toContain("start_date_time <= '2026-12-01T10:00:00'");
    expect(w).toContain("NOT IN ('Sport - Youth'");
  });
});

describe('new 311 and permit cities', () => {
  it('Kansas City 311', () => {
    const out = run('socrata-kansascity-311');
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.externalId === 'WO-5001')!.categories).toContain('junk-removal');
    expect(out.find((s) => s.externalId === 'WO-5002')!.categories).toEqual(expect.arrayContaining(['lawn-care', 'general-contractor']));
  });
  it('Cambridge 311 ignores free text; Oakland 311 reads location object', () => {
    const c = run('socrata-cambridge-311');
    expect(c).toHaveLength(2);
    expect(JSON.stringify(c)).not.toMatch(/Bob/);
    const o = run('socrata-oakland-311');
    expect(o.map((s) => s.externalId).sort()).toEqual(['600001', '600002']);
    expect(o[0].lat).toBeCloseTo(37.76, 2);
  });
  it('Cambridge, Norfolk, Buffalo, Montgomery, Orlando permits', () => {
    expect(run('socrata-cambridge-permits').map((s) => s.categories[0]).sort()).toEqual(['electrical', 'roofing']);
    const n = run('socrata-norfolk-permits');
    expect(n).toHaveLength(2);
    expect(n.find((s) => s.externalId === 'MEC-26-2002')!.categories).toContain('hvac');
    const b = run('socrata-buffalo-permits');
    expect(b).toHaveLength(2);
    expect(b.find((s) => s.externalId === 'BF-26-7001')!.categories).toEqual(expect.arrayContaining(['fencing', 'concrete-paving']));
    const m = run('socrata-montgomery-permits');
    expect(m).toHaveLength(2);
    expect(m[0].categories).toEqual(expect.arrayContaining(['windows-doors', 'siding-gutters']));
    expect(m[1].categories).toContain('flooring');
    const o = run('socrata-orlando-permits');
    // Round 7: the engineering lot grading permit is site work for a general contractor (it used to be dropped).
    expect(o).toHaveLength(3);
    expect(o.find((s) => s.externalId === 'ENG2026-10003')!.categories).toEqual(['general-contractor']);
    expect(o.find((s) => s.externalId === 'BLD2026-10002')!.categories).toContain('fencing');
    expect(JSON.stringify(o)).not.toMatch(/PRIVATE OWNER/);
  });
});

describe('silent-empty rule and config', () => {
  const ctx = (f: typeof fetch, logs: string[]) => ({ since: new Date(), fetch: f, env: {}, log: (m: string) => logs.push(m) });
  const respond = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it('rows with the wrong shape log an error; quiet rows do not', async () => {
    const d = ds('socrata-chicago-violations');
    const a = buildSocrataAdapter(d);
    const logs: string[] = [];
    expect(await a.fetch(ctx(respond([{ foo: 1 }, { foo: 2 }]), logs))).toEqual([]);
    expect(logs.join('|')).toMatch(/error: parsed 0 of 2 rows, shape may have changed/);
    const quiet: string[] = [];
    await a.fetch(ctx(respond([{ id: '1', violation_date: '2026-11-14T00:00:00.000', violation_description: 'ARRANGE PREMISE INSPECTION' }]), quiet));
    expect(quiet.join('|')).not.toMatch(/error/i);
    const obj: string[] = [];
    await a.fetch(ctx(respond({ error: true, message: 'bad' }), obj));
    expect(obj.join('|')).toMatch(/error/);
    const empty: string[] = [];
    await a.fetch(ctx(respond([]), empty));
    expect(empty).toEqual([]);
  });
  it('every dataset has a valid tz; enabled ones record a verifiedUrl; ids unique', () => {
    for (const d of SOCRATA_DATASETS) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: d.tz })).not.toThrow();
      expect(d.verifiedUrl).toMatch(/^https:\/\/.+\/api\/views\/[a-z0-9]{4}-[a-z0-9]{4}\.json$/);
      if (d.verified) expect(d.fieldSource).toBe('sourced');
    }
    expect(new Set(SOCRATA_DATASETS.map((d) => d.id)).size).toBe(SOCRATA_DATASETS.length);
    for (const sub of ['business', 'violation', 'event-permit'] as const) expect(SOCRATA_DATASETS.some((d) => d.subtype === sub && d.verified)).toBe(true);
  });
});
