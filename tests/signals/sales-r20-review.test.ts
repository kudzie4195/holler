// Round 20 SALES, review fixes (/home/claude/gates/r20/review/review-SALES.md, coordinator decisions). Hand-written rows, no portal.
//  1. A residential sale is stored and shown at BLOCK level only (no house number, no unit), on every display path; a commercial one
//     keeps its street address. The outreach plan never offers a residential sale a site block, a letter or a door-to-door kit.
//  3. The scorecard reads a sale as 'property-sale'.
//  4. One deed, one card (Cook County PINs, NYC lots: the first residential lot, else the first lot); Miami codes padded; NYC codes as
//     published; id parts are digits.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { sanitizeSample } from '@/lib/signals/samples';
import { SALES_DATASETS, cookClassOf, miamiClassOf, nycClassOf, NYC_PROPERTY_TYPES, type SaleDataset } from '@/lib/signals/adapters/sales-datasets';
import { PAGE2_MIN_LEFT_MS, SALE_BUDGET_MS, fetchSaleRows, parseSaleRows, saleBlock } from '@/lib/signals/adapters/sales';
import { summaryForCard, cardBrief, briefFor, NEXT_STEP, SALE_COMMERCIAL_NEXT } from '@/lib/signals/brief';
import { cardBriefLang, briefForLang } from '@/lib/signals/brief-i18n';
import { outreachPlan, recordClass, mayHaveContacts, hasBlock } from '@/lib/outreach/plan';
import { renderDigest } from '@/lib/email/templates';
import { buildNotification } from '@/lib/push/notify';
import { isListablePermit } from '@/lib/lists/core';
import { sectionFor } from '@/lib/seo/sections';
import { summarize } from '@/lib/seo/summarize';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { recordTypeOf } from '@/lib/signals/trade-needs';
import type { SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const ds = (id: string) => SALES_DATASETS.find((d) => d.id === id)!;
const IDS = SALES_DATASETS.map((d) => d.id);

/** A residential row per source at "3412 N LAKEWOOD AVE", unit 2B, so a house number or unit that leaks is easy to see. */
const HOUSE = /\b3412\b|\b2B\b|\bUNIT\b|Unit 2/;
const RESIDENTIAL_ROW: Record<string, Record<string, unknown>> = {
  'socrata-nyc-acris-sales': {
    document_id: '2026111000999001', doc_type: 'DEED', recorded_datetime: '2026-11-10T00:00:00.000', document_amt: '640000',
    borough: '4', block: '100', lot: '7', property_type: 'SC', street_number: '3412', street_name: 'N LAKEWOOD AVE', unit: '2B',
  },
  'socrata-cook-sales': {
    pin: '14211130250000', doc_no: '2631512345', sale_date: '2026-10-15T00:00:00.000', sale_price: '412000', class: '299',
    year: '2026', prop_address_full: '3412 N LAKEWOOD AVE UNIT 2B', prop_address_city_name: 'CHICAGO', prop_address_zipcode_1: '60657',
  },
  'carto-phl-sales': {
    document_id: '54012399', recording_date: '2026-11-18T00:00:00Z', total_consideration: 380000, street_address: '3412 N LAKEWOOD AVE UNIT 2B',
    zip_code: '19133', category_code_description: 'SINGLE FAMILY', lat: 39.9901, lon: -75.1302,
  },
  'arcgis-miamidade-sales': {
    FOLIO: '0141370000999', DATEOFSALE_UTC: Date.parse('2026-11-05T00:00:00Z'), PRICE_1: 990000, DOR_CODE_CUR: '0101', CONDO_FLAG: 'N',
    TRUE_SITE_ADDR_NO_UNIT: '3412 N LAKEWOOD AVE', TRUE_SITE_UNIT: '2B', TRUE_SITE_CITY: 'MIAMI', TRUE_SITE_ZIP_CODE: '33137', __lat: 25.81, __lon: -80.19,
  },
};
const COMMERCIAL_PHL = { ...RESIDENTIAL_ROW['carto-phl-sales'], document_id: '54012400', street_address: '1520 SPRUCE ST', category_code_description: 'COMMERCIAL', total_consideration: 2_500_000 };

const recordOf = (id: string, row: Record<string, unknown> = RESIDENTIAL_ROW[id]): SignalInput => {
  const items = parseSaleRows([row], ds(id), NOW).items;
  expect(items, id).toHaveLength(1);
  return items[0];
};

// ---- 1. storage -------------------------------------------------------------------------------------------------------------------

describe('review 1: a residential sale is stored at block level only', () => {
  it.each(IDS)('%s: the stored sample has the block and no house number, no unit, no contact', (id) => {
    const s = recordOf(id);
    const stored = JSON.stringify(sanitizeSample(s));
    expect(stored).not.toMatch(HOUSE);
    expect(s.summary).toMatch(/\| 3400 block of N Lakewood Ave$/);
    expect(s.contacts ?? []).toEqual([]);
  });

  it('a commercial sale keeps its street address, as a nameless site contact and in the summary', () => {
    const s = recordOf('carto-phl-sales', COMMERCIAL_PHL);
    expect(s.title).toBe('Commercial property sold in Philadelphia, PA');
    expect(s.summary).toBe('Price band: over $1M | Commercial property | 1520 SPRUCE ST');
    expect(s.contacts).toEqual([{ role: 'site', name: '', address: '1520 SPRUCE ST', city: 'Philadelphia', state: 'PA', zip: '19133' }]);
  });

  it('the block rule: hundreds, the 0-99 block, no unit, no block when there is no house number', () => {
    expect(saleBlock('3412 N LAKEWOOD AVE')).toBe('3400 block of N Lakewood Ave');
    expect(saleBlock('45 W 47TH ST')).toBe('0-99 block of W 47th St');
    expect(saleBlock('1000 BRICKELL AVE APT 1204')).toBe('1000 block of Brickell Ave');
    expect(saleBlock('LAKEWOOD AVE')).toBeNull();
  });

  it('a residential row whose address gives no block is dropped (nothing vaguer or sharper is stored)', () => {
    expect(parseSaleRows([{ ...RESIDENTIAL_ROW['carto-phl-sales'], street_address: 'REAR LAKEWOOD AVE' }], ds('carto-phl-sales'), NOW).items).toEqual([]);
  });
});

// ---- 1. every display path --------------------------------------------------------------------------------------------------------

describe('review 1: every display path shows a home at block level only, with no door-to-door outreach', () => {
  const home = recordOf('socrata-cook-sales');
  const card = { source: home.source, kind: home.kind, subtype: 'sale', title: home.title, summary: home.summary, url: home.url, occurredAt: home.occurredAt, label: 'coming_soon' as const, trade: 'painting' };

  it('feed card (web): summary, brief and outreach plan (en and es)', () => {
    expect(summaryForCard(card)).toBe('Price band: $250k–$500k | Condo | 3400 block of N Lakewood Ave');
    for (const b of [cardBrief(card), cardBriefLang(card, 'es')]) {
      const text = JSON.stringify(b);
      expect(text).not.toMatch(HOUSE);
      expect(text).not.toMatch(/check the address|revise la dirección|new owner|nuevo dueño/i);
    }
    expect(recordClass(home.source, home.kind)).toBe('sale');
    expect(hasBlock(home.source, home.kind)).toBe(false);
    expect(mayHaveContacts(home.source, home.kind)).toBe(true); // a commercial sale's site row; a home stores none
    // No block for a home, even if a stale full-address site row were passed in: no map pin, no letter, no door hanger.
    const stale = [{ role: 'site' as const, name: '', address: '3412 N LAKEWOOD AVE UNIT 2B', city: 'Chicago', state: 'IL', zip: '60657' }];
    for (const lang of ['en', 'es'] as const) {
      expect(outreachPlan({ ...home, kind: home.kind, title: home.title }, stale, lang)).toBeNull();
      expect(outreachPlan({ ...home, kind: home.kind, title: home.title }, [], lang)).toBeNull();
    }
  });

  it('feed card (web): a commercial sale gets a site block with a map, never a letter or a door kit', () => {
    const com = recordOf('carto-phl-sales', COMMERCIAL_PHL);
    const plan = outreachPlan({ ...com, title: com.title }, com.contacts as never, 'en');
    expect(plan).toMatchObject({ type: 'site', address: '1520 SPRUCE ST, Philadelphia, PA 19133', letter: null });
  });

  it('brief next step: never "check the address"; the home and the commercial sentences, en and es', () => {
    expect(NEXT_STEP.sale).toBe('A home on this block sold; homes often need work in the first months.');
    expect(briefFor({ ...card }).next).toBe(NEXT_STEP.sale);
    expect(briefFor({ ...card, title: 'Commercial property sold in Philadelphia, PA' }).next).toBe(SALE_COMMERCIAL_NEXT);
    expect(briefForLang({ ...card }, 'es').next).toBe('Se vendió una vivienda en esta cuadra; suelen necesitar trabajos al inicio.');
    expect(briefForLang({ ...card, title: 'Commercial property sold in Philadelphia, PA' }, 'es').next).toBe('Se vendió una propiedad comercial aquí; suelen seguir limpieza y seguridad.');
    for (const n of [NEXT_STEP.sale, SALE_COMMERCIAL_NEXT]) expect(n).not.toMatch(/address|owner|\bopen\b/i);
  });

  it('alert email (digest)', () => {
    const mail = renderDigest({
      businessName: 'Acme Painting', appUrl: 'https://holler.test/app', unsubscribeUrl: 'https://holler.test/u', now: NOW,
      items: [{ kind: home.kind, source: home.source, subtype: 'sale', title: home.title, summary: home.summary, occurredAt: home.occurredAt, label: 'coming_soon', trade: 'painting' }],
    });
    for (const out of [mail.html, mail.text, mail.subject]) {
      expect(out).not.toMatch(HOUSE);
      expect(out).not.toMatch(/check the address/i);
    }
  });

  it('push', () => {
    const n = buildNotification({ count: 1, top: { signalId: 1, title: home.title, city: home.city ?? null, source: home.source } }, 'Chicago');
    expect(JSON.stringify(n)).not.toMatch(HOUSE);
  });

  it('address lists take permits only', () => {
    expect(isListablePermit({ source: home.source, kind: home.kind, subtype: 'sale', projectOf: null } as never)).toBe(false);
  });

  it('public city pages never list or count a sale', () => {
    for (const id of IDS) expect(sectionFor('civic', id, 'Home sold in Brooklyn, NY', 'sale')).toBeNull();
    const row = { id: 1, source: home.source, kind: 'civic', title: home.title, summary: home.summary, url: home.url, categories: home.categories, severity: 1, occurred_at: home.occurredAt, expires_at: null, subtype: 'sale' };
    const page = summarize('chicago-il', [row as never], NOW.toISOString());
    expect(JSON.stringify(page.sections)).not.toMatch(/sold in/);
  });

  it('mobile API (buildAlerts): no house number in anything it returns', async () => {
    const m: MatchRow = {
      id: 1, status: 'new', distance_mi: 2, draft: null, created_at: NOW.toISOString(),
      signal: { id: 1, source: home.source, kind: home.kind, title: home.title, summary: home.summary ?? null, url: home.url ?? null, city: home.city ?? null, state: home.state ?? null, county: null, zip: home.zip ?? null, occurred_at: home.occurredAt, expires_at: null, subtype: 'sale', categories: home.categories },
    };
    for (const locked of [true, false]) {
      const out = await buildAlerts([m], { userId: 'u1', locked, db: { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) }) } as never, admin: null, siteUrl: 'https://holler.test', now: NOW.getTime(), trades: ['painting'] });
      expect(JSON.stringify(out)).not.toMatch(HOUSE);
    }
  });

  it('Spanish summary: the block reads "cuadra 3400 de ..."', () => {
    expect(localizeSummary(home.summary, 'es', home.source)).toBe('Rango de precio: $250k–$500k | Condominio | cuadra 3400 de N Lakewood Ave');
    expect(localizeTitle(home.title, 'es', home.source)).toBe('Condominio vendido en Chicago, IL');
    // review P3: an inherited object key is never read as a class
    expect(localizeSummary('Foo | constructor', 'es', 'socrata-chicago-permits')).toBe('Foo | constructor');
  });
});

// ---- 3. scorecard record type ------------------------------------------------------------------------------------------------------

describe('review 3: the scorecard reads a sale as property-sale', () => {
  it.each(IDS)('%s', (id) => {
    expect(recordTypeOf({ source: id, kind: 'civic', data: { subtype: 'sale' } })).toBe('property-sale');
  });
});

// ---- 4. one deed, one card; codes; ids ---------------------------------------------------------------------------------------------

describe('review 4: one deed makes one record', () => {
  it('Cook County: a deed over three PINs is one record with the deed band, from the first residential PIN', () => {
    const base = RESIDENTIAL_ROW['socrata-cook-sales'];
    const rows = [
      { ...base, pin: '14211130250001', class: '517', sale_price: '900000', prop_address_full: '3500 N BROADWAY' },
      { ...base, pin: '14211130250002', class: '203', sale_price: '900000', prop_address_full: '3412 N LAKEWOOD AVE' },
      { ...base, pin: '14211130250003', class: '203', sale_price: '900000', prop_address_full: '3416 N LAKEWOOD AVE' },
    ];
    const items = parseSaleRows(rows, ds('socrata-cook-sales'), NOW).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: '2631512345', title: 'Home sold in Chicago, IL', summary: 'Price band: $500k–$1M | Single-family home | 3400 block of N Lakewood Ave' });
  });

  it('Cook County through the adapter: the query orders by date, deed and PIN, and three PIN rows give one sample', async () => {
    const sale = { pin: '', doc_no: '2631512345', sale_date: '2026-10-15T00:00:00.000', sale_price: '900000', class: '203' };
    const urls: string[] = [];
    const doFetch = (async (u: string) => {
      urls.push(String(u));
      if (String(u).includes('wvhk-k5uv')) return Response.json(['14211130250001', '14211130250002', '14211130250003'].map((pin) => ({ ...sale, pin })));
      return Response.json(['14211130250001', '14211130250002', '14211130250003'].map((pin, i) => ({ pin, year: '2026', prop_address_full: `${3412 + i * 2} N LAKEWOOD AVE`, prop_address_city_name: 'CHICAGO', prop_address_zipcode_1: '60657' })));
    }) as typeof fetch;
    const got = await fetchSaleRows(ds('socrata-cook-sales'), doFetch, NOW);
    expect(decodeURIComponent(urls[0].replace(/\+/g, ' '))).toContain('$order=sale_date DESC, doc_no, pin');
    expect(parseSaleRows(got.rows, ds('socrata-cook-sales'), NOW).items).toHaveLength(1);
  });

  it('NYC: a deed over several lots uses the first residential lot (borough, block, lot order), else the first lot', async () => {
    const master = { document_id: '2026111000777001', doc_type: 'DEED', recorded_datetime: '2026-11-10T00:00:00.000', document_amt: '1200000' };
    const lot = (n: string, type: string, num: string) => ({ document_id: master.document_id, borough: '1', block: '1400', lot: n, property_type: type, street_number: num, street_name: 'E 66TH ST', unit: '' });
    const run = async (legals: Record<string, unknown>[]) => {
      const doFetch = (async (u: string) => Response.json(String(u).includes('bnx9-e6tj') ? [master] : legals)) as typeof fetch;
      const got = await fetchSaleRows(ds('socrata-nyc-acris-sales'), doFetch, NOW);
      return parseSaleRows(got.rows, ds('socrata-nyc-acris-sales'), NOW).items;
    };
    // the portal sends the lots out of order: parking (lot 1002) and the condo (lot 1011), plus a storage room (lot 1001)
    const condo = await run([lot('1011', 'SC', '200'), lot('1002', 'PS', '200'), lot('1001', 'SR', '200')]);
    expect(condo).toHaveLength(1);
    expect(condo[0].title).toBe('Condo sold in Manhattan, NY');
    // no residential lot: the first lot decides (two commercial buildings: one card, at the first lot's block... street address)
    const com = await run([lot('20', 'CR', '310'), lot('10', 'CR', '300')]);
    expect(com).toHaveLength(1);
    expect(com[0].summary).toBe('Price band: over $1M | Commercial property | 300 E 66TH ST');
    // the first lot maps to no class: dropped, never relabelled
    expect(await run([lot('1', 'PS', '200'), lot('2', 'SR', '200')])).toEqual([]);
  });

  it('a Philadelphia document repeated in the rows is one record', () => {
    const r = RESIDENTIAL_ROW['carto-phl-sales'];
    expect(parseSaleRows([r, r], ds('carto-phl-sales'), NOW).items).toHaveLength(1);
  });
});

describe('review 4: class codes as published', () => {
  it('Miami-Dade codes are padded to 4 digits before the first two are read (303 is multi-family, 410 a condo, never commercial)', () => {
    expect(['303', '410', '101', 101 as unknown as string, '0101', '0407', '0803', '1100', '4800', '1000', '4000', '12345', 'abc', ''].map((c) => miamiClassOf(String(c)))).toEqual([
      'multi_family', 'condo', 'residential_single', 'residential_single', 'residential_single', 'condo', 'multi_family', 'commercial', 'commercial', null, null, null, null, null,
    ]);
  });

  it('NYC codes are the ones in the city table 94g4-w6xz: F1 is homes over a store, SR is a storage room, MR a maid\'s room', () => {
    expect(nycClassOf('F1')).toBe('multi_family');
    for (const gone of ['SR', 'MR', 'PS', 'SP', 'MP', 'VL', 'VR', 'GR', 'MU', 'BS', 'TS', '1F', '2F', 'CM', 'ST', 'IP', 'constructor']) expect(nycClassOf(gone), gone).toBeNull();
    // every mapped code is one the table lists
    const PUBLISHED = 'CA FS F5 F1 F4 D1 D2 D3 D4 D5 D6 SC MC SP MP CC AP OF IB RB VL MU OT PA MR SR PS BS RS CK RE R1 R2 RP GR NA EA UT VR VN CP CR TS RG RV SA SM HC VI'.split(' ');
    for (const k of Object.keys(NYC_PROPERTY_TYPES)) expect(PUBLISHED, k).toContain(k);
  });

  it('Cook County classes as in the Assessor\'s definitions: land and minor improvements drop', () => {
    expect(['202', '210', '295', '299', '211', '212', '313', '399', '517', '599', '500', '550', '590', '213', '241', '397'].map(cookClassOf)).toEqual([
      'residential_single', 'residential_single', 'residential_single', 'condo', 'multi_family', 'multi_family', 'multi_family', 'multi_family',
      'commercial', 'commercial', null, null, null, null, null, null,
    ]);
  });
});

describe('review P3: ids, error text, time budget', () => {
  it('an id part must be digits (NYC FT_ / BK_ prefix allowed): a word in an id column makes no record', () => {
    const cook = { ...RESIDENTIAL_ROW['socrata-cook-sales'] };
    expect(parseSaleRows([{ ...cook, doc_no: 'QUIMBY' }], ds('socrata-cook-sales'), NOW).items).toEqual([]);
    expect(parseSaleRows([{ ...RESIDENTIAL_ROW['socrata-nyc-acris-sales'], document_id: 'FT_1234567890' }], ds('socrata-nyc-acris-sales'), NOW).items).toHaveLength(1);
  });

  it('a portal error body is never logged: the HTTP status only', async () => {
    const doFetch = (async () => Response.json({ message: 'JOHN Q SMITHERSON is not a column' }, { status: 400 })) as unknown as typeof fetch;
    const got = await fetchSaleRows(ds('socrata-cook-sales'), doFetch, NOW);
    expect(got.logs.join(' ')).not.toMatch(/SMITHERSON/);
    expect(got.logs[0]).toBe('error: schema mismatch: the portal refused the column list (socrata-cook-sales: HTTP 400)');
  });

  it('a second page starts only with 6.5 s of the 10 s budget left', () => {
    expect(PAGE2_MIN_LEFT_MS).toBe(6_500);
    expect(SALE_BUDGET_MS).toBe(10_000);
  });

  it('the registry still builds every sale adapter on probation', () => {
    for (const id of IDS) expect(ALL_ADAPTERS.find((a) => a.id === id)?.probation, id).toBe(true);
  });
});

describe('review 2: LAUNCH.md asks the owner to sign off privacy before any promotion edit', () => {
  it('the sign-off checkbox comes before the promotion edits', () => {
    const md = readFileSync('LAUNCH.md', 'utf8');
    const signOff = md.indexOf('- [ ] Round 20 sales: PRIVACY SIGN-OFF');
    const promote = md.indexOf('- [ ] Round 20 sales: to promote one (only after the sign-off above)');
    expect(signOff).toBeGreaterThan(0);
    expect(promote).toBeGreaterThan(signOff);
    expect(md.slice(signOff, promote)).toMatch(/block level only/);
  });
});

// keep the type import used
export type _D = SaleDataset;
