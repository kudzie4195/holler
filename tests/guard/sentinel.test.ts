/**
 * Round 5 FIX-E, the proof that the public side of inspection and USAspending rows is built by construction (review3 P0-1, P0-2 public
 * side, P0-3, P2-4, P2-7). For every inspection dataset config (each Socrata one, and a synthetic ArcGIS layer: no live ArcGIS inspection
 * layer is configured) and for USAspending, EVERY column of the raw record, including columns the code has never heard of, holds a unique
 * sentinel "ZQX<n>PERSON". Only the columns the parser needs to accept the row hold a valid value instead: the id, the date, the
 * coordinates, the numeric score, a known result value, and (USAspending) the state code and NAICS code. Every string anywhere in the
 * public SignalInput (title, summary, data, url, city, state, zip, categories, externalId, every other field) is walked: no sentinel may
 * appear. The one allowed exception is the street NAME inside the block-level address of the summary (a street name is not a person),
 * asserted exactly. `contacts` is private (holler_signal_contacts, service role only) and is excluded from the walk.
 */
import { describe, expect, it } from 'vitest';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import type { ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { contactSpecFields } from '@/lib/contacts/extract';
import type { SignalInput } from '@/lib/signals/types';

const SENTINEL_RE = /ZQX\d+PERSON/g;

function sentinelFactory() {
  let n = 0;
  return () => `ZQX${++n}PERSON`;
}

/** Every string in the public part of a SignalInput, with its path. `contacts` is private and skipped. */
function publicStrings(s: SignalInput): [string, string][] {
  const out: [string, string][] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') out.push([path, v]);
    else if (typeof v === 'number' || typeof v === 'boolean') out.push([path, String(v)]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push([`${path}.<key>`, k]); walk(x, `${path}.${k}`); }
  };
  const { contacts: _c, ...pub } = s as SignalInput & { contacts?: unknown };
  void _c;
  walk(pub, 's');
  return out;
}

/**
 * Assert no sentinel anywhere public. `streetSentinel`, when given, is allowed exactly once: inside the summary, as the street name of
 * the block-level address "<n> block of S <streetSentinel> AVE".
 */
function expectNoSentinel(s: SignalInput, streetSentinel?: string, block?: string) {
  const strings = publicStrings(s);
  if (streetSentinel) {
    const where = strings.filter(([, v]) => v.includes(streetSentinel));
    expect(where.map(([p]) => p), 'the street sentinel appears only in the summary').toEqual(['s.summary']);
    expect(s.summary!.endsWith(block!), `summary ends with the block address: ${s.summary}`).toBe(true);
    expect(s.summary!.split(streetSentinel).length - 1, 'once').toBe(1);
  }
  for (const [path, v] of strings) {
    const rest = streetSentinel && path === 's.summary' ? v.replace(block!, '') : v;
    expect(rest.match(SENTINEL_RE), `${path} = ${JSON.stringify(v)}`).toBeNull();
  }
}

// ---- Socrata inspections ---------------------------------------------------------------------------------------------------------

/** Columns the parser needs valid, per dataset (failure rule inputs and numeric scores). */
const VALID: Record<string, Record<string, string>> = {
  'socrata-chicago-inspections': { results: 'Fail' },
  'socrata-nyc-inspections': { critical_flag: 'Critical', score: '41' },
  'socrata-sf-inspections': { inspection_score: '55' },
  'socrata-austin-inspections': { score: '62' },
};

function socrataColumns(d: SocrataDataset): string[] {
  return [...new Set([
    d.idField, ...(d.idFields ?? []), d.dateField, d.latField, d.lonField, d.locationField, d.latLonTextField, ...d.titleFields, ...d.textFields,
    ...d.summaryFields, ...(d.addressFields ?? []), d.nameField, d.zipField, d.naicsField, d.endDateField,
    ...(d.inspectionSummary ?? []).map((f) => f.field), ...contactSpecFields(d.contacts),
    // columns the code has never heard of
    'aka_name', 'license_', 'risk', 'violations', 'phone', 'owner_name', 'zz_unknown_a', 'zz_unknown_b', 'cuisine_description', 'boro',
  ].filter((x): x is string => Boolean(x)))];
}

/** Address columns: row 'name' puts the sentinel in the street-name position, row 'after' puts it after the street suffix. */
function addressValues(d: SocrataDataset, mode: 'name' | 'after', street: string, next: () => string): Record<string, string> {
  const f = d.addressFields ?? [];
  const streetText = mode === 'name' ? `S ${street} AVE` : `S KOMENSKY AVE ${street}`;
  if (f.length === 1) return { [f[0]]: `5521 ${streetText} ${next()}` };
  // NYC: building, street, boro
  const out: Record<string, string> = { [f[0]]: '5521', [f[1]]: streetText };
  for (const x of f.slice(2)) out[x] = next();
  return out;
}

const inspections = SOCRATA_DATASETS.filter((d) => d.subtype === 'inspection');

describe('sentinel: every Socrata inspection dataset config', () => {
  it('covers every configured inspection dataset', () => {
    expect(inspections.map((d) => d.id).sort()).toEqual(Object.keys(VALID).sort());
  });
  for (const d of inspections) {
    for (const mode of ['name', 'after'] as const) {
      it(`${d.id}: sentinel in the street ${mode === 'name' ? 'name position' : 'after the street suffix'}`, () => {
        const next = sentinelFactory();
        const row: Record<string, unknown> = {};
        for (const c of socrataColumns(d)) row[c] = next();
        const street = next();
        Object.assign(row, addressValues(d, mode, street, next));
        row[d.idField] = '9001';
        row[d.dateField] = '2026-11-10T00:00:00.000';
        if (d.latField) row[d.latField] = '41.792345678';
        if (d.lonField) row[d.lonField] = '-87.723456789';
        Object.assign(row, VALID[d.id]);
        const out = parseSocrata([row], d);
        expect(out, 'the row is accepted').toHaveLength(1);
        const s = out[0];
        expect(s.title).toBe(`Failed inspection in ${d.city}: food establishment`);
        expect([s.lat, s.lon]).toEqual([41.792, -87.723]);
        expect(s.zip).toBeNull();
        if (mode === 'name') expectNoSentinel(s, street, `5500 block of S ${street} AVE`);
        else {
          expectNoSentinel(s);
          expect(s.summary ?? '').toMatch(/5500 block of S KOMENSKY AVE$/);
        }
      });
    }
  }
});

// ---- ArcGIS (synthetic inspection layer) ---------------------------------------------------------------------------------------------

describe('sentinel: an ArcGIS inspection layer', () => {
  const layer: ArcgisDataset = {
    id: 'arcgis-sentinel-inspections', city: 'Testville', state: 'GA', tz: 'America/New_York', layerUrl: 'https://example.test/FeatureServer/0',
    kind: 'civic', subtype: 'inspection', idField: 'oid', dateField: 'insp_date', dateType: 'date', latField: 'lat', lonField: 'lon',
    titleFields: ['est_name', 'title_text'], textFields: ['est_name', 'findings'], summaryFields: ['findings', 'score', 'result'], addressFields: ['street'],
    nameField: 'est_name', zipField: 'zip',
    inspectionSummary: [{ field: 'score', kind: 'score' }, { field: 'result', kind: 'list', values: ['Fail'] }, { field: 'findings', kind: 'list', values: ['Rodents'] }],
    cadenceMinutes: 720, verified: false, verifiedUrl: 'https://example.test', checkedOn: '2026-11-18', fieldSource: 'assumed',
  };
  for (const mode of ['name', 'after'] as const) {
    for (const geometry of [true, false]) {
      it(`sentinel in the street ${mode}, position from ${geometry ? 'geometry' : 'attributes'}`, () => {
        const next = sentinelFactory();
        const a: Record<string, unknown> = {};
        for (const c of ['oid', 'insp_date', 'lat', 'lon', 'est_name', 'title_text', 'findings', 'score', 'result', 'street', 'zip', 'owner', 'zz_unknown']) a[c] = next();
        const street = next();
        a.street = mode === 'name' ? `5521 S ${street} AVE` : `5521 S KOMENSKY AVE ${street}`;
        a.oid = 'OID-1';
        a.insp_date = Date.UTC(2026, 10, 10);
        a.score = 55;
        a.result = 'Fail';
        if (geometry) { a.lat = next(); a.lon = next(); } else { a.lat = 33.7512345; a.lon = -84.3912345; }
        const f = geometry ? { attributes: a, geometry: { x: -84.3912345, y: 33.7512345 } } : { attributes: a };
        const out = parseArcgis({ features: [f] }, layer);
        expect(out).toHaveLength(1);
        const s = out[0];
        expect(s.title).toBe('Failed inspection in Testville: food establishment');
        expect([s.lat, s.lon]).toEqual([33.751, -84.391]);
        if (mode === 'name') {
          expectNoSentinel(s, street, `5500 block of S ${street} AVE`);
          expect(s.summary).toBe(`55 | Fail | 5500 block of S ${street} AVE`);
        } else {
          expectNoSentinel(s);
          expect(s.summary).toBe('55 | Fail | 5500 block of S KOMENSKY AVE');
        }
      });
    }
  }
});

// ---- USAspending ---------------------------------------------------------------------------------------------------------------------

describe('sentinel: USAspending', () => {
  function award(over: (next: () => string) => Record<string, unknown>) {
    const next = sentinelFactory();
    const pop: Record<string, unknown> = {};
    for (const c of ['location_country_code', 'country_name', 'state_code', 'state_name', 'city_name', 'county_code', 'county_name', 'congressional_code', 'zip4', 'zip5', 'zz_unknown']) pop[c] = next();
    const r: Record<string, unknown> = {};
    for (const c of ['Award ID', 'Recipient Name', 'Award Amount', 'Description', 'Start Date', 'Place of Performance City Code', 'Place of Performance State Code',
      'Place of Performance Zip5', 'Awarding Agency', 'Last Modified Date', 'internal_id', 'Contract Award Type', 'zz_unknown']) r[c] = next();
    r['Primary Place of Performance'] = pop;
    r.NAICS = { code: next(), description: next() };
    r.generated_internal_id = 'CONT_AWD_SENTINEL_1';
    r['Last Modified Date'] = '2026-11-01';
    pop.state_code = 'TX';
    Object.assign(r, over(next));
    return parseUsaSpending({ results: [r] });
  }
  it('NAICS code valid (needed for the category), every other column a sentinel', () => {
    const out = award((next) => ({ NAICS: { code: '561730', description: next() } }));
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.title).toBe('Federal contract in TX: Landscaping (NAICS 561730)');
    expect(s.summary).toBe('NAICS 561730');
    expect([s.city, s.zip, s.lat, s.lon]).toEqual([null, null, null, null]);
    expectNoSentinel(s);
  });
  it('NAICS code a sentinel too: the category comes from the Description words, which are never printed', () => {
    const out = award((next) => ({ Description: `${next()} LAWN MOWING ${next()}` }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toMatch(/^Federal contract in TX: (Lawn care|Landscaping|Snow removal)$/);
    expectNoSentinel(out[0]);
  });
  it('a valid amount, a sentinel-free agency and a known city still never carry a sentinel', () => {
    const out = award(() => ({ 'Award Amount': 84000, NAICS: { code: '561730' } }));
    expectNoSentinel(out[0]);
    expect(out[0].title).toBe('Federal contract ($84K) in TX: Landscaping (NAICS 561730)');
  });
});
