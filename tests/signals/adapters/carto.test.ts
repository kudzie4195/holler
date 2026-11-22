/**
 * Philadelphia (Carto SQL API) adapters: carto-phl-permits, carto-phl-violations, carto-phl-business. All on probation.
 *
 * Fixture provenance (tests/fixtures/carto-phl-*.json)
 * - SOURCED: tests/fixtures/carto-phl-{permits,violations,business}.json hold the real sample rows of /home/claude/runlog/recon-phl-nyc.md
 *   (live recon 2026-11-22, newest rows by permitissuedate / casecreateddate / initialissuedate): same ids, dates, addresses, zips, types,
 *   statuses, owners and names. Timestamps were rewritten from the recon's CSV form ("2026-11-21 22:32:57+00") to Carto's JSON form
 *   ("2026-11-21T22:32:57Z"). The recon dropped the geometry columns, so `lat` / `lon` (what ST_Y/ST_X return) are ASSUMED values placed
 *   inside Philadelphia. violationcode and caseresponsibility were split out of the recon's merged text lines (also SOURCED).
 *   The real rows keep opa_owner and the owner/legal-name columns on purpose: the adapter must not pass them on.
 * - ASSUMED: the inline ASSUMED_* rows below. The recon's three newest permits were all Zoning with no company contractor, so building
 *   trade permits (permittype BUILDING / ELECTRICAL / MECHANICAL / PLUMBING), company contractors and repair-worded violation titles are
 *   hand-written to exercise the paths the recon rows did not reach. Their vocabulary has not been seen live.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARTO_DATASETS, PHL_BUSINESS_EXCLUDED_LICENSE_TYPES, phlBusinessTypeFilter, type CartoDataset } from '@/lib/signals/adapters/carto-datasets';
import { adapters, buildCartoAdapter, buildCartoSql, buildCartoUrl, normalizeCartoDate, parseCarto, windowStart } from '@/lib/signals/adapters/carto';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { opportunityTrades } from '@/lib/signals/opportunity';
import { feedCount } from '@/lib/seo/home-live';
import { enabledDatasets } from '@/lib/signals/capabilities';
import type { SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const fx = (n: string): { rows: Row[] } => JSON.parse(readFileSync(join(__dirname, '../../fixtures', `carto-phl-${n}.json`), 'utf8'));
const ds = (id: string): CartoDataset => CARTO_DATASETS.find((d) => d.id === id)!;
const PERMITS = ds('carto-phl-permits');
const VIOLATIONS = ds('carto-phl-violations');
const BUSINESS = ds('carto-phl-business');

const NOW = new Date('2026-11-22T12:00:00Z');
const SINCE = new Date('2026-11-10T00:00:00Z');

// ASSUMED rows (see header).
const permitBase = fx('permits').rows[1];
const assumedPermit = (permitnumber: string, permittype: string, typeofwork: string, approvedscopeofwork: string, contractorname: string | null): Row => ({
  ...permitBase, permitnumber, permittype, typeofwork, approvedscopeofwork, contractorname,
});
const ASSUMED_PERMITS: Row[] = [
  assumedPermit('ASSUMED-B1', 'BUILDING', 'ALTERATION', 'Re-roof of existing two-story attached dwelling', 'ACME ROOFING LLC'),
  assumedPermit('ASSUMED-E1', 'ELECTRICAL', 'ALTERATION', 'Replace electrical service panel', 'Paulette Ahmad'),
  assumedPermit('ASSUMED-M1', 'MECHANICAL', 'REPLACEMENT', 'Install new gas furnace and ductwork', 'Keystone Heating & Cooling Inc'),
];
const violationBase = fx('violations').rows[0];
const assumedViolation = (violationnumber: string, violationcodetitle: string): Row => ({ ...violationBase, violationnumber, violationcodetitle });
const businessBase = fx('business').rows[0];
const ASSUMED_BUSINESS: Row[] = [{ ...businessBase, licensenum: 'ASSUMED-L1', licensetype: 'Commercial Activity', legalname: 'Keystone Property Services LLC', business_name: 'Keystone Property Services LLC', legalentitytype: 'Company' }];
const ASSUMED_VIOLATIONS: Row[] = [assumedViolation('ASSUMED-V1', 'ROOF REPAIR REQUIRED'), assumedViolation('ASSUMED-V2', 'ROOF/FLASHING DEFECTIVE')];

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (out.push(k), strings(x, out)));
  return out;
};

describe('Carto SQL and URL', () => {
  it.each([
    ['carto-phl-permits', 'permits', 'permitissuedate'],
    ['carto-phl-violations', 'violations', 'casecreateddate'],
    ['carto-phl-business', 'business_licenses', 'initialissuedate'],
  ])('%s queries %s newest-first on %s with a NOT NULL filter, since and LIMIT 1000', (id, table, col) => {
    const d = ds(id);
    const sql = buildCartoSql(d, SINCE, NOW);
    expect(sql).toContain(`FROM ${table} WHERE`);
    expect(sql).toContain(`${col} IS NOT NULL`);
    expect(sql).toContain(`${col} > '2026-11-10T00:00:00.000Z'`);
    expect(sql).toMatch(new RegExp(`ORDER BY ${col} DESC LIMIT 1000$`));
    expect(sql).toContain('ST_Y(the_geom) AS lat, ST_X(the_geom) AS lon');
    expect(sql).not.toMatch(/SELECT \*/);
    // private columns are never selected
    expect(sql).not.toMatch(/opa_owner|ownercontact|legalfirstname|legallastname|contractoraddress/);
    const url = buildCartoUrl(d, SINCE, NOW);
    expect(url.startsWith('https://phl.carto.com/api/v2/sql?q=')).toBe(true);
    expect(url.endsWith('&format=json')).toBe(true);
    expect(decodeURIComponent(url.slice('https://phl.carto.com/api/v2/sql?q='.length, -'&format=json'.length))).toBe(sql);
  });

  it('adds the status filters of violations and licences', () => {
    expect(buildCartoSql(VIOLATIONS, SINCE, NOW)).toContain("(violationstatus = 'OPEN')");
    expect(buildCartoSql(BUSINESS, SINCE, NOW)).toContain("licensestatus = 'Active'");
    expect(buildCartoSql(PERMITS, SINCE, NOW)).not.toContain('status');
  });

  it('keeps rental-type licences out of the business dataset (review r13 P2-4), from a small list; other types and null stay', () => {
    expect(PHL_BUSINESS_EXCLUDED_LICENSE_TYPES).toEqual(['Rental', 'Limited Lodging Operator']);
    expect(buildCartoSql(BUSINESS, SINCE, NOW)).toContain("(licensetype IS NULL OR licensetype NOT IN ('Rental', 'Limited Lodging Operator'))");
    expect(phlBusinessTypeFilter(["O'Brien Rental"])).toBe("(licensetype IS NULL OR licensetype NOT IN ('O''Brien Rental'))");
    expect(buildCartoSql(PERMITS, SINCE, NOW)).not.toContain('licensetype');
    expect(buildCartoSql(VIOLATIONS, SINCE, NOW)).not.toContain('licensetype');
  });

  it('uses `since`, but never a window shorter than minLookbackDays (publication lag)', () => {
    expect(windowStart(PERMITS, SINCE, NOW).toISOString()).toBe(SINCE.toISOString());
    const recent = new Date(NOW.getTime() - 3600_000);
    expect(windowStart(PERMITS, recent, NOW).toISOString()).toBe('2026-11-20T12:00:00.000Z');
    expect(windowStart(BUSINESS, recent, NOW).toISOString()).toBe('2026-11-15T12:00:00.000Z');
  });

  it('normalises Carto timestamps (JSON and CSV forms)', () => {
    expect(normalizeCartoDate('2026-11-21T22:32:57Z')).toBe('2026-11-21T22:32:57Z');
    expect(normalizeCartoDate('2026-11-21 22:32:57+00')).toBe('2026-11-21T22:32:57+00:00');
    expect(normalizeCartoDate(null)).toBeNull();
  });
});

describe('row mapping', () => {
  it('permits: the recon Zoning rows carry no trade and are dropped; building trade permits map like Socrata permits', () => {
    expect(parseCarto(fx('permits'), PERMITS)).toEqual([]);
    const out = parseCarto({ rows: [...fx('permits').rows, ...ASSUMED_PERMITS] }, PERMITS);
    expect(out.map((s) => s.externalId)).toEqual(['ASSUMED-B1', 'ASSUMED-E1', 'ASSUMED-M1']);
    for (const s of out) {
      expect(s).toMatchObject({ source: 'carto-phl-permits', kind: 'permit', city: 'Philadelphia', state: 'PA', occurredAt: '2026-11-21T16:32:27.000Z', zip: '19131' });
      expect(s.data).toMatchObject({ subtype: 'permit', domain: 'phl.carto.com' });
      expect(s.title).toMatch(/ permit in Philadelphia$/);
      expect(s.url).toBe(PERMITS.sourceUrl);
      expect(s.lat).toBeCloseTo(39.9754, 4); // permits keep their exact point, as Socrata permits do
    }
    expect(out[1].categories).toEqual(['electrical']);
    expect(out[1].title).toBe('Electrical permit in Philadelphia');
    expect(out[2].categories).toEqual(expect.arrayContaining(['hvac']));
  });

  it('violations: fixed code title, block-level address and 3-decimal position, trades from the Socrata violation rules', () => {
    const out = parseCarto(fx('violations'), VIOLATIONS);
    expect(out.map((s) => s.externalId)).toEqual(['VI-2026-097764', 'VI-2026-097745', 'VI-2022-013781']);
    const [vacant, weeds, plumbing] = out;
    expect(vacant).toMatchObject({ kind: 'civic', city: 'Philadelphia', state: 'PA', zip: '19149', occurredAt: '2026-11-21T19:19:59.000Z' });
    expect(vacant.title).toBe('Code violation in Philadelphia: VACANT STRUCTURE & LAND');
    expect(vacant.categories).toEqual(['general-contractor', 'handyman']);
    expect(vacant.summary).toBe('VACANT STRUCTURE & LAND | OPEN | 1400 block of HIGBEE ST');
    expect([vacant.lat, vacant.lon]).toEqual([40.031, -75.091]);
    expect(weeds.categories).toEqual(['lawn-care', 'landscaping']);
    expect(weeds.summary).toContain('6500 block of TORRESDALE AVE');
    expect(plumbing.categories).toEqual(['plumbing']);
    expect(plumbing.data).toMatchObject({ subtype: 'violation' });
    for (const s of out) expect(s.contacts).toBeUndefined();
  });

  it('business licences: title from the licence type, no street address, position rounded to 2 decimals, new-business trades', () => {
    const out = parseCarto(fx('business'), BUSINESS);
    expect(out.map((s) => s.externalId)).toEqual(['1024919', '1024918', '1024916']);
    expect(out[0]).toMatchObject({ kind: 'civic', city: 'Philadelphia', state: 'PA', zip: '19127', occurredAt: '2026-11-21T22:46:46.000Z' });
    expect(out[0].title).toBe('New business license in Philadelphia: Rental');
    expect(out[0].summary).toBe('Rental | Residential Dwellings');
    expect(out[2].title).toBe('New business license in Philadelphia: Limited Lodging Operator');
    expect(out[0].categories).toEqual(expect.arrayContaining(['signs-printing', 'business-services', 'insurance']));
    expect([out[0].lat, out[0].lon]).toEqual([40.03, -75.22]);
    for (const s of out) expect(s.summary).not.toMatch(/\d{3,}/);
  });
});

describe('privacy', () => {
  const all = (): SignalInput[] => [
    ...parseCarto({ rows: [...fx('permits').rows, ...ASSUMED_PERMITS] }, PERMITS),
    ...parseCarto({ rows: [...fx('violations').rows, ...ASSUMED_VIOLATIONS] }, VIOLATIONS),
    ...parseCarto({ rows: [...fx('business').rows, ...ASSUMED_BUSINESS] }, BUSINESS),
  ];
  const FORBIDDEN = [
    'opa_owner', 'JAMES CARTER', 'ETUX', 'RANDOLPH STANTON', 'KATHRYN', 'STANTON', 'WO HOLDINGS', 'LOPEZ', 'EVELYN', 'ANAS REALTY', 'ETA REALESTATE', 'ROMERO', 'ANGEL',
    'MONI DELAW', 'FALANA', 'ADEBIYI', 'AKANJI', 'REGO', 'LOUIS', 'Hussey', 'DeMaio', 'Dean', 'Robert', 'Paulette', 'Ahmad', 'Webster',
  ];

  it('no owner or person name appears anywhere in any output string (title, summary, data, url, contacts, keys)', () => {
    const out = all();
    expect(out.length).toBeGreaterThan(8);
    const text = strings(out).join('\n');
    for (const f of FORBIDDEN) {
      expect(text.toLowerCase(), `forbidden value ${f}`).not.toContain(f.toLowerCase());
    }
    // and no contact of any kind outside the allowed company contacts
    const names = out.flatMap((s) => (s.contacts ?? []).filter((c) => c.name).map((c) => `${s.source}:${c.role}:${c.name}`)).sort();
    expect(names).toEqual([
      'carto-phl-business:business:Keystone Property Services LLC',
      'carto-phl-permits:contractor:ACME ROOFING LLC',
      'carto-phl-permits:contractor:Keystone Heating & Cooling Inc',
    ]);
  });

  it('permits: a company contractor is kept, a person contractor ("Paulette Ahmad") is dropped; the site address is kept', () => {
    const out = parseCarto({ rows: ASSUMED_PERMITS }, PERMITS);
    const acme = out.find((s) => s.externalId === 'ASSUMED-B1')!;
    expect(acme.contacts!.find((c) => c.role === 'contractor')).toMatchObject({ name: 'ACME ROOFING LLC' });
    expect(acme.contacts!.find((c) => c.role === 'site')).toMatchObject({ address: '5851 MALVERN AVE', city: 'Philadelphia', state: 'PA' });
    const person = out.find((s) => s.externalId === 'ASSUMED-E1')!;
    expect(person.contacts!.map((c) => c.role)).toEqual(['site']);
    expect(person.contacts!.every((c) => !c.name)).toBe(true);
  });

  it('permits: the real person-contractor row, forced to carry a trade, still yields no contractor contact', () => {
    const real = fx('permits').rows[1];
    const out = parseCarto({ rows: [{ ...real, approvedscopeofwork: 'Replace electrical service panel', permittype: 'ELECTRICAL' }] }, PERMITS);
    expect(out).toHaveLength(1);
    expect(strings(out).join('\n')).not.toMatch(/Paulette|Ahmad|Webster/);
    expect(out[0].contacts!.some((c) => c.role === 'contractor')).toBe(false);
  });

  it('business licences: a Company gives one business contact (through cleanOrgName); Individual rows give no contact, no name, no home address', () => {
    const out = parseCarto({ rows: [...fx('business').rows, ...ASSUMED_BUSINESS] }, BUSINESS);
    const co = out.find((s) => s.externalId === 'ASSUMED-L1')!;
    expect(co.contacts!.find((c) => c.role === 'business')).toMatchObject({ name: 'Keystone Property Services LLC' });
    expect(co.contacts!.find((c) => c.role === 'site')).toMatchObject({ address: '159 MARKLE ST', city: 'Philadelphia', state: 'PA' });
    expect(co.contacts!.some((c) => /Hussey|DeMaio/.test(JSON.stringify(c)))).toBe(false);
    for (const id of ['1024918', '1024916']) expect(out.find((s) => s.externalId === id)!.contacts).toBeUndefined();
  });

  it('business licences: the real Company row ("The Moni DeLaw Group LLC") is rejected by the strict organisation check: no contact, and never the owner contacts', () => {
    const co = parseCarto(fx('business'), BUSINESS).find((s) => s.externalId === '1024919')!;
    expect(co.contacts).toBeUndefined();
    expect(strings(co).join('\n')).not.toMatch(/Hussey|DeMaio|Dean|Robert/);
  });

  it('business licences: an Individual whose name looks like a company still gets no contact (entity type decides first)', () => {
    const row = { ...fx('business').rows[1], legalname: 'Falana Rental Properties LLC', business_name: 'Falana Rental Properties LLC' };
    expect(parseCarto({ rows: [row] }, BUSINESS)[0].contacts).toBeUndefined();
  });

  it('violation addresses are block-level and the position is rounded', () => {
    for (const s of parseCarto(fx('violations'), VIOLATIONS)) {
      expect(s.summary).toMatch(/\d00 block of|0-99 block of/);
      expect(s.summary).not.toMatch(/\b1441\b|\b3222\b|\b6501\b/);
      expect(s.summary).not.toMatch(/\b\d{1,4}(?<!00) (?:HIGBEE|TORRESDALE|BROOKDALE)/);
      expect(String(s.lat).split('.')[1].length).toBeLessThanOrEqual(3);
    }
  });
});

describe('adapters', () => {
  it('three adapters, all on probation, with the expected ids, kinds and cadence', () => {
    expect(adapters.map((a) => a.id)).toEqual(['carto-phl-permits', 'carto-phl-violations', 'carto-phl-business']);
    for (const a of adapters) {
      expect(a.probation).toBe(true);
      expect(a.cadenceMinutes).toBe(360);
      expect(ALL_ADAPTERS.find((x) => x.id === a.id)).toBe(a);
      expect(SOURCE_META[a.id]).toMatchObject({ id: a.id, label: a.label, sourceUrl: a.sourceUrl });
    }
    expect(adapters.map((a) => a.kind)).toEqual(['permit', 'civic', 'civic']);
    expect(CARTO_DATASETS.every((d) => d.probation === true)).toBe(true);
  });

  it('fetch calls the Carto URL with since and returns parsed rows; HTTP errors and bad bodies return []', async () => {
    const a = buildCartoAdapter(VIOLATIONS);
    const calls: string[] = [];
    const log: string[] = [];
    const ok = (async (u: string) => (calls.push(u), { ok: true, status: 200, json: async () => fx('violations') })) as unknown as typeof fetch;
    const items = await a.fetch({ since: SINCE, now: NOW, fetch: ok, env: {}, log: (m) => log.push(m) });
    expect(items).toHaveLength(3);
    expect(calls).toEqual([buildCartoUrl(VIOLATIONS, SINCE, NOW)]);
    const bad = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await a.fetch({ since: SINCE, now: NOW, fetch: bad, env: {}, log: (m) => log.push(m) })).toEqual([]);
    const shape = (async () => ({ ok: true, status: 200, json: async () => ({ error: ['boom'] }) })) as unknown as typeof fetch;
    expect(await a.fetch({ since: SINCE, now: NOW, fetch: shape, env: {}, log: (m) => log.push(m) })).toEqual([]);
    const boom = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    expect(await a.fetch({ since: SINCE, now: NOW, fetch: boom, env: {}, log: (m) => log.push(m) })).toEqual([]);
    expect(log.join('\n')).toMatch(/HTTP 500[\s\S]*shape may have changed[\s\S]*network down/);
  });
});

describe('probation: excluded from every coverage list', () => {
  const ids = CARTO_DATASETS.map((d) => d.id);
  it('not in the Socrata or ArcGIS dataset configs, enabledDatasets, feedCount or the guide data sources', async () => {
    for (const id of ids) {
      expect(SOCRATA_DATASETS.some((d) => d.id === id)).toBe(false);
      expect(ARCGIS_DATASETS.some((d) => d.id === id)).toBe(false);
      expect(enabledDatasets().some((d) => d.id === id)).toBe(false);
    }
    expect(feedCount(adapters, {})).toBe(0);
    const { GUIDE_DATA_SPECS } = await import('@/lib/seo/guide-data');
    const sources = Object.values(GUIDE_DATA_SPECS).flatMap((s) => s.sources);
    for (const id of ids) expect(sources).not.toContain(id);
  });
});

describe('opportunity replay of the fixtures', () => {
  const op = (s: SignalInput) => opportunityTrades({ ...s, subtype: String((s.data as { subtype?: unknown })?.subtype ?? '') });

  it('a violation naming a roof repair is act for roofing; weeds are act for lawn care; vacant structure is act for handyman', () => {
    const out = parseCarto({ rows: [...fx('violations').rows, ...ASSUMED_VIOLATIONS] }, VIOLATIONS);
    const by = (id: string) => out.find((s) => s.externalId === id)!;
    expect(op(by('ASSUMED-V1')).roofing).toBe('act');
    expect(op(by('ASSUMED-V2')).roofing).toBe('act');
    expect(op(by('VI-2026-097745'))['lawn-care']).toBe('act');
    expect(op(by('VI-2026-097764')).handyman).toBe('act');
  });

  it('building trade permits are competitor intel for their own trade, never act', () => {
    const out = parseCarto({ rows: ASSUMED_PERMITS }, PERMITS);
    expect(op(out.find((s) => s.externalId === 'ASSUMED-E1')!).electrical).toBe('intel');
    expect(op(out.find((s) => s.externalId === 'ASSUMED-M1')!).hvac).toBe('intel');
  });

  it('every fixture row gets a known label set (no throw, no unknown family)', () => {
    const out = [...parseCarto(fx('violations'), VIOLATIONS), ...parseCarto(fx('business'), BUSINESS)];
    for (const s of out) expect(Object.values(op(s)).every((l) => ['act', 'soon', 'intel'].includes(l as string))).toBe(true);
  });
});
