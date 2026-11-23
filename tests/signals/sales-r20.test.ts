// Round 20 SALES: property sale and deed feeds (NYC ACRIS, Cook County, Philadelphia RTT, Miami-Dade), all ON PROBATION. Every row below is
// HAND-WRITTEN from the column names in /home/claude/gates/r20/SALES-research.md (tags [O], [3P], [A]); no row was ever pulled from a portal,
// so these prove the privacy and fail-safe behaviour of the code, not the live schemas.
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { runScan, PROBATION_TIMEOUT_MS } from '@/lib/signals/run';
import { sanitizeSample } from '@/lib/signals/samples';
import {
  MIN_SALE_PRICE, NYC_ACRIS_PARTIES, SALES_DATASETS, cookClassOf, miamiClassOf, nycClassOf, phlClassOf, saleRequestColumns, type SaleDataset,
} from '@/lib/signals/adapters/sales-datasets';
import {
  PARTY_COLUMN_RE, PRICE_BANDS, SALE_BUDGET_MS, SALE_TRADES, assertSafeColumn, buildArcgisSaleQuery, buildCartoSaleSql, buildSocrataJoinQuery,
  buildSocrataSaleQuery, fetchSaleRows, parseSaleRows, priceBand, saleRequestUrls, saleSummary, saleTitle,
} from '@/lib/signals/adapters/sales';
import { PROBATION_SOURCE_IDS, SALE_SOURCE_IDS, isProbationSource, probationCheck, probationOverview, type ProbationHealthLite, type ProbationRunLite } from '@/lib/signals/probation';
import { coverageProbeSourceIds, runCoverageProbe } from '@/lib/signals/coverage-probe';
import { sourcePlaces } from '@/lib/admin/metros';
import { PROPOSED_LABELS, proposedLabelOf } from '@/lib/signals/proposed-labels';
import { SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { localizeTitle, rebuildEnglishTitle } from '@/lib/signals/title-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { enabledDatasets } from '@/lib/signals/capabilities';
import type { Db } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const MS = (iso: string) => Date.parse(iso);
const asDb = (f: FakeDb) => f as unknown as Db;
const ds = (id: string) => SALES_DATASETS.find((d) => d.id === id)!;
const adapterOf = (id: string) => ALL_ADAPTERS.find((a) => a.id === id)!;
const IDS = SALES_DATASETS.map((d) => d.id);

/** Names planted in every column a portal could send. None may ever reach a stored record, a log, a probe answer or a request. */
const PLANTED = ['JOHN Q SMITHERSON', 'MARIA LOPEZ-GARRIDO', 'OKONKWO FAMILY TRUST'];
const PLANTED_RE = /SMITHERSON|LOPEZ-GARRIDO|OKONKWO/i;
/** Party columns a portal might send even when not asked (it ignores $select / outFields). */
const PARTY_EXTRAS: Record<string, string> = {
  buyer_name: PLANTED[0], seller_name: PLANTED[1], grantors: PLANTED[0], grantees: PLANTED[1], owner_1: PLANTED[2], owner_2: PLANTED[0],
  owner_address_name: PLANTED[2], mail_address_name: PLANTED[0], party_name: PLANTED[1], name: PLANTED[2], TRUE_OWNER1: PLANTED[0],
  TRUE_OWNER2: PLANTED[1], TRUE_MAILING_ADDR1: PLANTED[2], attention: PLANTED[0],
};

// ---- hand-written rows -------------------------------------------------------------------------------------------------------------------

const NYC_MASTER = { document_id: '2026111000123001', doc_type: 'DEED', recorded_datetime: '2026-11-10T00:00:00.000', document_amt: '850000' };
const NYC_LEGAL = { document_id: '2026111000123001', borough: '3', property_type: 'D1', street_number: '245', street_name: 'PROSPECT PL', unit: '' };
const COOK_SALE = { pin: '14211130250000', doc_no: '2631512345', sale_date: '2026-10-15T00:00:00.000', sale_price: '412000', class: '203' };
const COOK_ADDR = { pin: '14211130250000', year: '2026', prop_address_full: '3400 N LAKEWOOD AVE', prop_address_city_name: 'CHICAGO', prop_address_zipcode_1: '60657' };
const PHL_ROW = {
  document_id: '54012345', recording_date: '2026-11-18T00:00:00Z', total_consideration: 1250000, street_address: '1520 SPRUCE ST', zip_code: '19102',
  category_code_description: 'COMMERCIAL', lat: 39.94671, lon: -75.16723,
};
const MIA_ATTR = {
  FOLIO: '0141370000100', DATEOFSALE_UTC: MS('2026-11-05T00:00:00Z'), PRICE_1: 210000, DOR_CODE_CUR: '0407', CONDO_FLAG: 'Y',
  TRUE_SITE_ADDR_NO_UNIT: '1000 BRICKELL AVE', TRUE_SITE_UNIT: '1204', TRUE_SITE_CITY: 'MIAMI', TRUE_SITE_ZIP_CODE: '33131',
};
const MIA_FIELDS = [...ds('arcgis-miamidade-sales').columns, 'TRUE_OWNER1', 'TRUE_OWNER2', 'TRUE_MAILING_ADDR1'].map((n) => ({
  name: n, type: n === 'DATEOFSALE_UTC' ? 'esriFieldTypeDate' : n === 'PRICE_1' ? 'esriFieldTypeDouble' : 'esriFieldTypeString',
}));

/** The joined row the parser sees for each source (main + join columns). */
const JOINED: Record<string, Record<string, unknown>> = {
  'socrata-nyc-acris-sales': { ...NYC_LEGAL, ...NYC_MASTER },
  'socrata-cook-sales': { ...COOK_ADDR, ...COOK_SALE },
  'carto-phl-sales': { ...PHL_ROW },
  'arcgis-miamidade-sales': { ...MIA_ATTR, __lat: 25.7617, __lon: -80.1918 },
};

type Route = (url: string) => { status?: number; body?: unknown; text?: string; hang?: boolean } | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake portal for all four sources. Every response also carries the party columns, as if the portal ignored the column list. */
function portal(over: Route = () => undefined, rows: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  const urls: string[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    const o = over(url);
    if (o?.hang) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('aborted', 'AbortError')));
      });
    }
    if (o?.text !== undefined) return new Response(o.text, { status: o.status ?? 200 });
    if (o) return json(o.body, o.status ?? 200);
    const withParties = (r: Record<string, unknown>) => ({ ...r, ...PARTY_EXTRAS });
    if (url.includes('/resource/bnx9-e6tj.json')) return json((rows.nycMaster ?? [NYC_MASTER]).map(withParties));
    if (url.includes('/resource/8h5j-fqxa.json')) return json((rows.nycLegal ?? [NYC_LEGAL]).map(withParties));
    if (url.includes('/resource/wvhk-k5uv.json')) return json((rows.cookSale ?? [COOK_SALE]).map(withParties));
    if (url.includes('/resource/3723-97qp.json')) return json((rows.cookAddr ?? [COOK_ADDR]).map(withParties));
    if (url.includes('/api/views/')) return json({ columns: [] });
    if (url.startsWith('https://phl.carto.com/')) {
      const r = (rows.phl ?? [PHL_ROW]).map(withParties);
      return json({ rows: r, fields: Object.fromEntries(Object.keys(r[0] ?? PHL_ROW).map((k) => [k, { type: 'string' }])) });
    }
    if (url.includes('PaGISView_gdb')) {
      if (url.endsWith('?f=json')) return json({ fields: MIA_FIELDS });
      if (url.includes('returnCountOnly')) return json({ count: 1 });
      return json({ features: (rows.mia ?? [MIA_ATTR]).map((a) => ({ attributes: withParties(a), geometry: { x: -80.1918, y: 25.7617 } })) });
    }
    return json({ error: 'not found' }, 404);
  }) as typeof fetch;
  return { fetch: doFetch, urls };
}

const PROFILES = [
  { user_id: 'u000001', categories: ['moving', 'cleaning', 'security', 'janitorial-commercial'], lat: 40.71, lon: -74.0, state: 'NY', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z' },
  { user_id: 'u000002', categories: ['moving', 'cleaning', 'security', 'janitorial-commercial'], lat: 41.88, lon: -87.63, state: 'IL', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z' },
  { user_id: 'u000003', categories: ['moving', 'cleaning', 'security', 'janitorial-commercial'], lat: 39.95, lon: -75.16, state: 'PA', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z' },
  { user_id: 'u000004', categories: ['moving', 'cleaning', 'security', 'janitorial-commercial'], lat: 25.77, lon: -80.19, state: 'FL', radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z' },
];

const decoded = (u: string) => decodeURIComponent(u.replace(/\+/g, ' '));
/** A request names a party column: any column-shaped token that matches the party pattern (the dataset id of Parties counts too). */
function namesParty(url: string): string | null {
  const d = decoded(url);
  if (d.includes(NYC_ACRIS_PARTIES)) return NYC_ACRIS_PARTIES;
  for (const tok of d.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (/^(https|http|com|gov|us|json|api|resource|views|services|arcgis|rest|FeatureServer|query|ArcGIS|phl|carto|sql|data|cityofnewyork|datacatalog|cookcountyil)$/i.test(tok)) continue;
    if (PARTY_COLUMN_RE.test(tok)) return tok;
  }
  return null;
}

// ---- configuration ---------------------------------------------------------------------------------------------------------------------

describe('round 20 sales: every source is on probation, schema-unverified and placed under its metro', () => {
  it('four sources: NYC, Chicago, Philadelphia and Miami', () => {
    expect(SALES_DATASETS.map((d) => [d.id, d.metro])).toEqual([
      ['socrata-nyc-acris-sales', 'new-york'],
      ['socrata-cook-sales', 'chicago'],
      ['carto-phl-sales', 'philadelphia'],
      ['arcgis-miamidade-sales', 'miami'],
    ]);
  });

  it.each(IDS)('%s: probation, schemaUnverified, registered, in the probation set and the probe list, never advertised as live', (id) => {
    const d = ds(id);
    expect(d.probation).toBe(true);
    expect(d.schemaUnverified).toBe(true);
    expect(adapterOf(id).probation).toBe(true);
    expect(PROBATION_SOURCE_IDS.has(id)).toBe(true);
    expect(isProbationSource(id)).toBe(true);
    expect(SALE_SOURCE_IDS).toContain(id);
    expect(coverageProbeSourceIds()).toContain(id);
    expect(enabledDatasets().map((x) => x.id)).not.toContain(id);
    expect(SOURCE_DEFAULTS[id], 'promotion adds the label, not this unit').toBeUndefined();
  });

  it('/api/admin/metros lists each under its metro', () => {
    const places = sourcePlaces();
    for (const d of SALES_DATASETS) expect(places.get(d.id), d.id).toBe(d.metro);
  });

  it('the overview offers the probe and names the sales config as the place to promote', () => {
    const rows = probationOverview(ALL_ADAPTERS, [], () => null);
    for (const id of IDS) {
      const r = rows.find((x) => x.id === id)!;
      expect(r.probe).toBe(`/api/admin/coverage-probe?source=${id}`);
      expect(r.promote).toContain('lib/signals/adapters/sales-datasets.ts');
      expect(r.promote).toContain('schemaUnverified');
    }
  });

  it('promotion needs both flags: no sale source is live with an unchecked schema', () => {
    for (const d of SALES_DATASETS) if (!d.probation) expect(d.schemaUnverified, d.id).toBe(false);
  });

  it('the adapter stops itself inside the probation time limit', () => {
    expect(SALE_BUDGET_MS).toBeLessThan(PROBATION_TIMEOUT_MS);
  });

  it('labels read in both languages', () => {
    expect(sourceLabelLang('carto-phl-sales', 'en')).toBe('Philadelphia open data: property sales');
    expect(sourceLabelLang('carto-phl-sales', 'es')).toBe('Datos abiertos de Philadelphia: ventas de propiedades');
  });
});

// ---- privacy: the query ---------------------------------------------------------------------------------------------------------------

describe('privacy in the query: no request ever names a buyer, seller, grantor, grantee, party, owner, mailing or attention column', () => {
  it.each(IDS)('%s: config columns and every request URL the source can build', (id) => {
    const d = ds(id);
    for (const c of saleRequestColumns(d)) expect(() => assertSafeColumn(c), c).not.toThrow();
    for (const u of saleRequestUrls(d, NOW)) {
      expect(namesParty(u), u).toBeNull();
      expect(decoded(u)).not.toMatch(/\$select=\*|outFields=\*|SELECT \*/);
    }
  });

  it.each(IDS)('%s: every request a full scan run actually sent', async (id) => {
    const { fetch: doFetch, urls } = portal();
    const out = await adapterOf(id).fetch({ since: NOW, now: NOW, fetch: doFetch, env: {}, log: () => {} });
    expect(out.length, id).toBe(1);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(namesParty(u), u).toBeNull();
  });

  it('the NYC Parties dataset (names and addresses) is never requested', async () => {
    const { fetch: doFetch, urls } = portal();
    await adapterOf('socrata-nyc-acris-sales').fetch({ since: NOW, now: NOW, fetch: doFetch, env: {}, log: () => {} });
    expect(urls.some((u) => u.includes(NYC_ACRIS_PARTIES))).toBe(false);
  });

  it.each(['buyer_name', 'seller_name', 'grantors', 'grantees', 'r.grantees', 'owner_1', 'o.owner_1', 'TRUE_OWNER1', 'TRUE_MAILING_ADDR1', 'owner_address_name', 'mail_address_name', 'party_name', 'attention', 'taxpayer', 'name', 'condo_name'])(
    'assertSafeColumn refuses %s', (col) => {
      expect(() => assertSafeColumn(col)).toThrow(/could name a party/);
    },
  );

  it('a config that names a party column cannot even build its query (every platform)', () => {
    const nyc: SaleDataset = { ...ds('socrata-nyc-acris-sales'), columns: [...ds('socrata-nyc-acris-sales').columns, 'grantee_name'] };
    expect(() => buildSocrataSaleQuery(nyc, NOW)).toThrow(/could name a party/);
    const cook = ds('socrata-cook-sales');
    const cookJoin: SaleDataset = { ...cook, join: { ...cook.join!, columns: [...cook.join!.columns, 'mail_address_name'] } };
    expect(() => buildSocrataJoinQuery(cookJoin, ['1'])).toThrow(/could name a party/);
    const mia: SaleDataset = { ...ds('arcgis-miamidade-sales'), columns: [...ds('arcgis-miamidade-sales').columns, 'TRUE_OWNER1'] };
    expect(() => buildArcgisSaleQuery(mia, NOW, null)).toThrow(/could name a party/);
    const phl: SaleDataset = { ...ds('carto-phl-sales'), cartoSelect: { ...ds('carto-phl-sales').cartoSelect, who: 'r.grantees' } };
    expect(() => buildCartoSaleSql(phl, NOW)).toThrow(/could name a party/);
  });
});

// ---- privacy: what is stored --------------------------------------------------------------------------------------------------------------

describe('privacy in what is stored: names planted in every column never reach a record', () => {
  it.each(IDS)('%s: a name in each column in turn (and every party column) is never stored', (id) => {
    const d = ds(id);
    const cols = [...saleRequestColumns(d), ...Object.keys(PARTY_EXTRAS)];
    for (const c of cols) {
      for (const name of PLANTED) {
        const row = { ...JOINED[id], ...PARTY_EXTRAS, [c]: name };
        const items = parseSaleRows([row], d, NOW).items;
        const stored = JSON.stringify([...items, ...items.map(sanitizeSample)]);
        expect(stored, `${id} ${c}`).not.toMatch(PLANTED_RE);
      }
    }
  });

  it.each(IDS)('%s: a row with a name in EVERY column makes no record', (id) => {
    const d = ds(id);
    const row = Object.fromEntries([...saleRequestColumns(d), ...Object.keys(PARTY_EXTRAS)].map((c) => [c, PLANTED[0]]));
    expect(parseSaleRows([row], d, NOW).items).toEqual([]);
  });

  it.each(IDS)('%s: a scan writes samples only, with no name, no price and no party value', async (id) => {
    const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
    const { fetch: doFetch } = portal();
    const r = await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
    const src = r.sources.find((s) => s.id === id)!;
    expect(src.status, JSON.stringify(src)).toBe('ok');
    expect(f.tables.holler_source_samples.map((s) => s.source)).toEqual([id]);
    for (const t of ['holler_signals', 'holler_signal_contacts', 'holler_matches', 'holler_alert_log', 'holler_notifications']) expect(f.tables[t] ?? [], t).toEqual([]);
    const stored = JSON.stringify(f.tables.holler_source_samples) + JSON.stringify(f.tables.holler_scan_runs ?? []) + JSON.stringify(f.tables.holler_source_health ?? []);
    expect(stored).not.toMatch(PLANTED_RE);
    // the price itself is never stored, only its band
    expect(stored).not.toMatch(/850000|412000|1250000|210000/);
  });

  it('a home keeps only its block (in the summary, no contact), the date, the band and the class', () => {
    const [s] = parseSaleRows([JOINED['socrata-nyc-acris-sales']], ds('socrata-nyc-acris-sales'), NOW).items;
    expect(s).toMatchObject({
      title: 'Home sold in Brooklyn, NY',
      summary: 'Price band: $500k–$1M | Single-family home | 200 block of Prospect Pl',
      occurredAt: '2026-11-10T05:00:00.000Z',
      state: 'NY',
      data: { subtype: 'sale', recordKind: 'property-sale', saleClass: 'residential_single', priceBand: '$500k–$1M', approxLocation: true },
    });
    expect(s.contacts).toBeUndefined();
    expect(JSON.stringify(sanitizeSample(s))).not.toMatch(/\b245\b/);
    expect(Object.keys(s.data!).sort()).toEqual(['approxLocation', 'priceBand', 'recordKind', 'saleClass', 'subtype']);
  });

  it('a commercial sale keeps its street address (summary and a nameless site contact)', () => {
    const [s] = parseSaleRows([JOINED['carto-phl-sales']], ds('carto-phl-sales'), NOW).items;
    expect(s.summary).toBe('Price band: over $1M | Commercial property | 1520 SPRUCE ST');
    expect(s.contacts).toEqual([{ role: 'site', name: '', address: '1520 SPRUCE ST', city: 'Philadelphia', state: 'PA', zip: '19102' }]);
  });

  it('an address column that holds a name drops the row; a city column that holds a name prints the dataset place', () => {
    const cook = ds('socrata-cook-sales');
    expect(parseSaleRows([{ ...JOINED['socrata-cook-sales'], prop_address_full: 'JOHN Q SMITHERSON' }], cook, NOW).items).toEqual([]);
    const [s] = parseSaleRows([{ ...JOINED['socrata-cook-sales'], prop_address_city_name: 'MARIA LOPEZ' }], cook, NOW).items;
    expect(s.title).toBe('Home sold in Cook County, IL');
    const [e] = parseSaleRows([{ ...JOINED['socrata-cook-sales'], prop_address_city_name: 'EVANSTON' }], cook, NOW).items;
    expect(e.title).toBe('Home sold in Evanston, IL');
  });

  it('a point is rounded to a block (3 decimals)', () => {
    const [p] = parseSaleRows([JOINED['carto-phl-sales']], ds('carto-phl-sales'), NOW).items;
    expect([p.lat, p.lon]).toEqual([39.947, -75.167]);
  });
});

// ---- wording -------------------------------------------------------------------------------------------------------------------------

describe('titles, summaries, bands and classes', () => {
  it('title shapes per class, summary = band, class and (when given) the block or street', () => {
    expect(saleTitle('residential_single', 'Brooklyn', 'NY')).toBe('Home sold in Brooklyn, NY');
    expect(saleTitle('commercial', 'Chicago', 'IL')).toBe('Commercial property sold in Chicago, IL');
    expect(saleTitle('condo', 'Miami', 'FL')).toBe('Condo sold in Miami, FL');
    expect(saleTitle('multi_family', 'Philadelphia', 'PA')).toBe('Multi-family building sold in Philadelphia, PA');
    expect(saleSummary('condo', 'under $250k')).toBe('Price band: under $250k | Condo');
  });

  it('every record of every source: no banned words, never "new owner", never "they need you"', () => {
    for (const id of IDS) {
      for (const s of parseSaleRows([JOINED[id]], ds(id), NOW).items) {
        const text = `${s.title} ${s.summary}`;
        expect(text).not.toMatch(/\blead(s)?\b|new owner|they need you|guaranteed|you will win|official record/i);
      }
    }
  });

  it('the four sources make the four expected records', () => {
    const out = IDS.map((id) => parseSaleRows([JOINED[id]], ds(id), NOW).items[0]);
    expect(out.map((s) => [s.title, s.summary])).toEqual([
      ['Home sold in Brooklyn, NY', 'Price band: $500k–$1M | Single-family home | 200 block of Prospect Pl'],
      ['Home sold in Chicago, IL', 'Price band: $250k–$500k | Single-family home | 3400 block of N Lakewood Ave'],
      ['Commercial property sold in Philadelphia, PA', 'Price band: over $1M | Commercial property | 1520 SPRUCE ST'],
      ['Condo sold in Miami, FL', 'Price band: under $250k | Condo | 1000 block of Brickell Ave'],
    ]);
    expect(out[2].categories).toEqual(['janitorial-commercial', 'security']);
    expect(out[0].categories).toEqual([...SALE_TRADES.residential_single]);
    expect(out[0].categories).not.toContain('pool-spa'); // pool service in Miami only
  });

  it('price bands and the market-sale floor', () => {
    expect([249_999, 250_000, 499_999, 500_000, 999_999, 1_000_000].map(priceBand)).toEqual([
      PRICE_BANDS[0], PRICE_BANDS[1], PRICE_BANDS[1], PRICE_BANDS[2], PRICE_BANDS[2], PRICE_BANDS[3],
    ]);
    const d = ds('carto-phl-sales');
    expect(parseSaleRows([{ ...PHL_ROW, total_consideration: MIN_SALE_PRICE - 1 }], d, NOW).items).toEqual([]);
    expect(parseSaleRows([{ ...PHL_ROW, total_consideration: '$1,250,000' }], d, NOW).items).toHaveLength(1);
  });

  it('class tables: residential, condo, multi-family, commercial; vacant and unknown codes drop', () => {
    expect(['D1', 'D3', 'SC', 'CR', 'VL', 'zz'].map(nycClassOf)).toEqual(['residential_single', 'multi_family', 'condo', 'commercial', null, null]);
    expect(['203', '2-99', '211', '517', '100', ''].map(cookClassOf)).toEqual(['residential_single', 'condo', 'multi_family', 'commercial', null, null]);
    expect(['SINGLE FAMILY', 'MULTI FAMILY', 'MIXED USE', 'VACANT LAND'].map(phlClassOf)).toEqual(['residential_single', 'multi_family', null, null]);
    expect(['0101', '0407', '0803', '1111', '0000', '8080'].map(miamiClassOf)).toEqual(['residential_single', 'condo', 'multi_family', 'commercial', null, null]);
  });

  it('Spanish: titles and summaries are rebuilt, the place is kept', () => {
    expect(localizeTitle('Home sold in Brooklyn, NY', 'es', 'socrata-nyc-acris-sales')).toBe('Vivienda vendida en Brooklyn, NY');
    expect(localizeTitle('Commercial property sold in Chicago, IL', 'es', 'socrata-cook-sales')).toBe('Propiedad comercial vendida en Chicago, IL');
    expect(localizeTitle('Condo sold in Miami, FL', 'es')).toBe('Condominio vendido en Miami, FL');
    expect(localizeTitle('Multi-family building sold in Philadelphia, PA', 'es')).toBe('Edificio multifamiliar vendido en Philadelphia, PA');
    expect(rebuildEnglishTitle('Home sold in Brooklyn, NY')).toBe('Home sold in Brooklyn, NY');
    expect(localizeSummary('Price band: under $250k | Condo', 'es', 'arcgis-miamidade-sales')).toBe('Rango de precio: menos de $250k | Condominio');
    expect(localizeSummary('Price band: over $1M | Commercial property', 'es', 'carto-phl-sales')).toBe('Rango de precio: más de $1M | Propiedad comercial');
    expect(localizeSummary('Price band: $250k–$500k | Single-family home', 'es', 'socrata-cook-sales')).toBe('Rango de precio: $250k–$500k | Vivienda unifamiliar');
    expect(localizeSummary('Price band: $500k–$1M | Multi-family building', 'en')).toBe('Price band: $500k–$1M | Multi-family building');
  });
});

// ---- fail safe -------------------------------------------------------------------------------------------------------------------------

/** The error string run.ts records for an empty run whose logs look like errors (fetchOne). */
async function runOnce(id: string, route: Route, rows: Parameters<typeof portal>[1] = {}) {
  const f = new FakeDb({ holler_profiles: PROFILES, holler_source_samples: [] });
  const { fetch: doFetch, urls } = portal(route, rows);
  const r = await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
  const health = f.tables.holler_source_health.find((x) => x.source === id) as unknown as ProbationHealthLite | undefined;
  const run = (f.tables.holler_scan_runs ?? []).find((x) => x.source === id) as unknown as ProbationRunLite | undefined;
  return { r, f, urls, src: r.sources[0], health, run };
}

describe('fail safe: each failure is its own check state, never "ok"', () => {
  it('schema mismatch: the portal refuses the column list (Socrata 400)', async () => {
    const { src, health } = await runOnce('socrata-cook-sales', (u) => (u.includes('wvhk-k5uv') ? { status: 400, body: { message: 'No such column: sale_price' } } : undefined));
    expect(src.status).toBe('error');
    expect(src.error).toMatch(/^error: schema mismatch: the portal refused the column list \(socrata-cook-sales: HTTP 400\)/);
    expect(probationCheck(health)).toBe('schema_mismatch');
  });

  it('schema mismatch: the layer lacks a required column (ArcGIS field list), and no query is sent', async () => {
    const fields = MIA_FIELDS.filter((f) => f.name !== 'PRICE_1');
    const { src, health, urls } = await runOnce('arcgis-miamidade-sales', (u) => (u.endsWith('?f=json') ? { body: { fields } } : undefined));
    expect(src.error).toMatch(/schema mismatch: expected PRICE_1/);
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
    expect(probationCheck(health)).toBe('schema_mismatch');
  });

  it('schema mismatch: rows come back without the id or date column', async () => {
    const { src, health } = await runOnce('carto-phl-sales', () => undefined, { phl: [{ doc_id: '1', rec_date: '2026-11-18', total_consideration: 500000 }] });
    expect(src.error).toMatch(/^error: schema mismatch: expected document_id, recording_date \(carto-phl-sales: 0 of 1 rows parsed/);
    expect(src.error).not.toMatch(PLANTED_RE);
    expect(probationCheck(health)).toBe('schema_mismatch');
  });

  it('schema mismatch: the join matches no key', async () => {
    const { src, health } = await runOnce('socrata-nyc-acris-sales', () => undefined, { nycLegal: [{ ...NYC_LEGAL, document_id: 'X999999' }] });
    expect(src.error).toMatch(/schema mismatch: join 8h5j-fqxa matched none of 1 keys on document_id/);
    expect(probationCheck(health)).toBe('schema_mismatch');
  });

  it('not JSON: an HTML page with status 200', async () => {
    const { src, health } = await runOnce('carto-phl-sales', (u) => (u.startsWith('https://phl.carto.com/') ? { text: '<html>maintenance</html>' } : undefined));
    expect(src.error).toBe('error: carto-phl-sales: response was not JSON (HTTP 200)');
    expect(probationCheck(health)).toBe('not_json');
  });

  it('no recent rows: the window is empty and the newest row is old', async () => {
    const route: Route = (u) => {
      if (!u.includes('wvhk-k5uv')) return undefined;
      return decoded(u).includes('$limit=1') ? { body: [{ sale_date: '2026-06-30T00:00:00.000' }] } : { body: [] };
    };
    const { src, health } = await runOnce('socrata-cook-sales', route);
    expect(src.error).toBe('error: socrata-cook-sales: no rows in the last 60 days: newest is 2026-06-30');
    expect(probationCheck(health)).toBe('no_recent_rows');
  });

  it('row cap: a full page is read, the run works, and the note says older rows were not read', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...PHL_ROW, document_id: String(54000000 + i) }));
    const { src, run, health } = await runOnce('carto-phl-sales', () => undefined, { phl: many });
    expect(src.status).toBe('ok');
    expect(run?.error).toMatch(/^probation note: row cap reached: 1000 rows read \(limit 1000\)/);
    expect(probationCheck(health, run)).toBe('row_cap');
  });

  it('timeout: a hung portal is cut off inside the budget and reads as "timeout"', async () => {
    const { fetch: doFetch } = portal(() => ({ hang: true }));
    const got = await fetchSaleRows(ds('carto-phl-sales'), doFetch, NOW, { budgetMs: 600 });
    expect(got.logs).toEqual(['error: carto-phl-sales: timeout']);
    expect(probationCheck({ source: 'carto-phl-sales', last_run_at: NOW.toISOString(), last_success_at: null, last_error: got.logs[0] })).toBe('timeout');
    // the scan's own limit writes exactly "timeout"
    expect(probationCheck({ source: 'x', last_run_at: NOW.toISOString(), last_success_at: null, last_error: 'timeout' })).toBe('timeout');
    expect(probationCheck({ source: 'x', last_run_at: NOW.toISOString(), last_success_at: null, last_error: 'error: x: HTTP 503' })).toBe('error');
  });

  it('a join that fails stores nothing (rows without an address are never kept)', async () => {
    const { src, f } = await runOnce('socrata-cook-sales', (u) => (u.includes('3723-97qp') ? { status: 503, body: { message: 'busy' } } : undefined));
    expect(src.status).toBe('error');
    expect(src.error).toMatch(/socrata-cook-sales: join 3723-97qp: HTTP 503/);
    expect(f.tables.holler_source_samples).toEqual([]);
  });
});

// ---- the owner's probe -------------------------------------------------------------------------------------------------------------------

describe('/api/admin/coverage-probe works for the sale ids', () => {
  it.each(IDS)('%s: ok, mapped rows, no name anywhere in the answer', async (id) => {
    const { fetch: doFetch, urls } = portal();
    const res = await runCoverageProbe(id, doFetch, NOW);
    expect(res.status).toBe('ok');
    expect(res.schema, JSON.stringify(res)).toBe('ok');
    expect(res.freshness).toBe('ok');
    expect(res.mapped).toHaveLength(1);
    // a home has no contact at all; a commercial sale one nameless site row
    expect(res.mapped[0].contacts).toEqual(id === 'carto-phl-sales' ? [expect.objectContaining({ role: 'site', name: '' })] : []);
    expect(res.wroteNothing).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(PLANTED_RE);
    for (const u of urls) expect(namesParty(u), u).toBeNull();
  });

  it('a stale feed reads as stale with its newest date', async () => {
    const route: Route = (u) => (u.includes('bnx9-e6tj') ? (decoded(u).includes('$limit=1') && !decoded(u).includes('count(') ? { body: [{ recorded_datetime: '2026-09-08T00:00:00.000' }] } : { body: [] }) : undefined);
    const res = await runCoverageProbe('socrata-nyc-acris-sales', portal(route).fetch, NOW);
    expect(res.freshness).toBe('stale');
    expect(res.newestDate?.slice(0, 10)).toBe('2026-09-08');
  });

  it('a missing ArcGIS column is a mismatch with the column named', async () => {
    const fields = MIA_FIELDS.filter((f) => f.name !== 'DOR_CODE_CUR');
    const res = await runCoverageProbe('arcgis-miamidade-sales', portal((u) => (u.endsWith('?f=json') ? { body: { fields } } : undefined)).fetch, NOW);
    expect(res.schema).toBe('mismatch');
    expect(res.schemaProblem).toMatch(/expected DOR_CODE_CUR/);
  });
});

// ---- proposed labels -------------------------------------------------------------------------------------------------------------------

describe('proposed labels (for the scorecard projection only)', () => {
  // Review fix 5: the trades that plausibly act on a deed published weeks after closing.
  const RESIDENTIAL_KEEP = ['cleaning', 'landscaping', 'lawn-care', 'painting', 'flooring', 'fencing', 'security', 'pest-control', 'handyman', 'hvac'];
  const REMOVED = ['moving', 'locksmith', 'signs-printing'];

  it.each(IDS)('%s: a residential entry with no call path and a commercial entry with one; heads-up only', (id) => {
    const res = PROPOSED_LABELS[id];
    const com = PROPOSED_LABELS[`${id}:commercial`];
    for (const p of [res, com]) {
      expect(p).toBeDefined();
      expect(p.recordKind).toBe('property-sale');
      expect(p.metros).toEqual([ds(id).metro]);
      expect(p.expectedRowsPerWeekPerMetro).toBeGreaterThan(0);
      expect(['O', '3P', 'A']).toContain(p.volumeEvidence.tag);
      for (const v of Object.values(p.labels)) {
        const l = proposedLabelOf(v)!;
        expect(l.label).toBe('coming_soon');
        expect(l.share).toBeGreaterThan(0);
        expect(l.share).toBeLessThanOrEqual(1);
      }
      for (const t of REMOVED) expect(p.labels[t as keyof typeof p.labels], `${id} ${t}`).toBeUndefined();
    }
    expect(res.callPath, 'a home is block level only: no call path').toBe(false);
    expect(com.callPath, 'a commercial sale keeps its street address').toBe(true);
    for (const t of RESIDENTIAL_KEEP) expect(proposedLabelOf(res.labels[t as keyof typeof res.labels])?.label, `${id} ${t}`).toBe('coming_soon');
    expect(res.labels['janitorial-commercial']).toBeUndefined();
    expect(Object.keys(com.labels).sort()).toEqual(['janitorial-commercial', 'security']);
    expect(res.labels['pool-spa'] !== undefined, `${id} pool-spa`).toBe(ds(id).metro === 'miami');
  });

  it('a sale is never an urgent card and never sets SOURCE_DEFAULTS', () => {
    for (const id of IDS) expect(SOURCE_DEFAULTS[id]).toBeUndefined();
  });
});

// keep the type import used
export type _S = SignalInput;
