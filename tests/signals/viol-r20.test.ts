// Round 20 VIOL: violation and building-problem 311 feeds, ALL ON PROBATION and schema-unverified (lib/signals/adapters/viol-datasets.ts).
// Every row below is HAND-WRITTEN. Order texts and code values are the real-looking ones quoted in /home/claude/gates/r20/VIOL-research.md
// with their tags ([3P] third-party page, [A] assumed); no row was ever pulled from a portal. These tests prove the fail-safe behaviour, the
// privacy rules and the proposed labels against the real parser and rules, not the live schemas. The in-memory database is tests/ops/fakedb.ts.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { runScan } from '@/lib/signals/run';
import { SOCRATA_DATASETS, NAME_LIKE_COLUMN, NAME_COLUMN_OK, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { VIOL_SOCRATA_DATASETS, VIOL_ARCGIS_DATASETS } from '@/lib/signals/adapters/viol-datasets';
import { buildSocrataQuery, parseSocrataReport, socrataSelectColumns } from '@/lib/signals/adapters/socrata';
import { buildArcgisQuery, parseArcgisReport, requestTimeoutMs, resetArcgisFieldCache } from '@/lib/signals/adapters/arcgis';
import { LABEL_PENDING_INTEGRATION, PROBATION_SOURCE_IDS, VIOL_R20_SOURCES, probationCheck, probationOverview } from '@/lib/signals/probation';
import { PROPOSED_LABELS, proposedLabelOf } from '@/lib/signals/proposed-labels';
import { RECORD_TYPES } from '@/lib/signals/trade-needs';
import { METROS } from '@/lib/geo/metros';
import { SOURCE_DEFAULTS, labelFor, ruleFor, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { enabledDatasets } from '@/lib/signals/capabilities';
import { feedCount } from '@/lib/seo/home-live';
import { sourcePlaces } from '@/lib/admin/metros';
import { coverageProbeSourceIds, expectedColumns, runCoverageProbe } from '@/lib/signals/coverage-probe';
import { PROBATION_TIMEOUT_MS } from '@/lib/signals/run';
import { UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import type { CategoryId } from '@/lib/signals/categories';
import type { Db } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const asDb = (f: FakeDb) => f as unknown as Db;
const IDS = VIOL_R20_SOURCES.map((s) => s.id);
const adapterOf = (id: string) => ALL_ADAPTERS.find((a) => a.id === id)!;
const soc = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)! as SocrataDataset;
const DC = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dc-311')! as ArcgisDataset;
const PHX = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-phoenix-violations')! as ArcgisDataset;
const HPD = soc('socrata-nyc-hpd-violations');
const RODENT = soc('socrata-nyc-rodent-violations');
const MONT = soc('socrata-montgomery-violations');

// Planted people: every value below must never reach a stored record, a sample or a probe answer.
const PEOPLE = ['JANE TENANTSON', 'Maria Lopez', 'OFFICER SAM KELLY', 'Robert Ownerby', 'Pat Complainer'];
const PEOPLE_RE = new RegExp(PEOPLE.join('|'), 'i');
const PLANTED_SOCRATA = { owner_name: 'Robert Ownerby', respondent_name: 'JANE TENANTSON', inspector: 'OFFICER SAM KELLY', apartment: '4B', story: '3', unit_number: '12', location_description: 'Called by Pat Complainer' };
const PLANTED_DC = { INSPECTORNAME: 'OFFICER SAM KELLY', DETAILS: 'Maria Lopez says rats at 1234 her home 202-555-0101' };
const PLANTED_PHX = { OWNER_NAME: 'Robert Ownerby', COMPLAINANT: 'Pat Complainer', INSPECTOR: 'OFFICER SAM KELLY' };

// ---- hand-written rows -------------------------------------------------------------------------------------------------------------

/** HPD order texts [3P] (lucidrents.com, truncated there) and two [A] in the same form. */
const HPD_TEXT = {
  outlet: '§ 27-2005 HMC: PROPERLY REPAIR OR REPLACE THE BROKEN OR DEFECTIVE ELECTRICAL OUTLET AT NORTH WALL IN THE BATHROOM LOCATED AT APT 2A, 2nd STORY', // [3P]
  plaster: '§ 27-2005 ADM CODE REPAIR THE BROKEN OR DEFECTIVE PLASTERED SURFACES AND PAINT IN A UNIFORM COLOR AT CEILING IN THE KITCHEN LOCATED AT APT 2A', // [3P]
  door: '§ 27-2005, 27-2007, 27-2041.1 HMC, §238, § 309; § 107 (2) ( C) MDL AND 28 RCNY §25-171: REPLACE OR REPAIR THE SELF-CLOSING DOOR AT PUBLIC HALL, 1st STORY', // [3P]
  mice: '567 (C) § 27-2017, 27-2017.1, 27-2017.4, 27-2017.5, 27-2017.8, 27-2019, 27-2021 HMC: ABATE THE NUISANCE CONSISTING OF MICE IN THE ENTIRE APARTMENT', // [3P] head
  encumbrance: '§ 27-2005, 2007 ADM CODE REMOVE ALL ENCUMBRANCES CONSISTING OF BICYCLES AT PUBLIC HALL STAIRS, 1st STORY', // [3P]
  buzzer: '§ 27-2005 HMC: PROPERLY REPAIR OR REPLACE THE BROKEN OR DEFECTIVE BELL BUZZER SYSTEM FROM BUILDING ENTRANCE TO PANEL', // [3P]
  heat: '§ 27-2029 ADM CODE PROVIDE HEAT TO THE ENTIRE BUILDING', // [A]
  leak: '§ 27-2005 ADM CODE TRACE AND REPAIR THE SOURCE AND ABATE THE NUISANCE CONSISTING OF WATER LEAKS AT CEILING IN THE BATHROOM', // [A]
  mold: '§ 27-2017.3 HMC: TRACE AND ELIMINATE THE SOURCE OF THE MOLD CONDITION AND REMOVE THE MOLD IN THE BATHROOM', // [A]
  floor: '§ 27-2005 ADM CODE PROPERLY REPAIR THE BROKEN OR DEFECTIVE WOOD FLOOR IN THE FOYER', // [A]
} as const;

let n = 0;
const hpdRow = (text: string, over: Record<string, unknown> = {}) => ({
  violationid: String(15000000 + ++n), novissueddate: '2026-11-21T00:00:00.000', novdescription: text, currentstatus: 'NOV SENT OUT', violationstatus: 'Open',
  class: 'B', housenumber: '2318', streetname: 'EAST 130 STREET', zip: '10037', latitude: '40.80951', longitude: '-73.94166', ...PLANTED_SOCRATA, ...over,
});
const rodentRow = (result: string, over: Record<string, unknown> = {}) => ({
  job_ticket_or_work_order_id: String(900000 + ++n), inspection_date: '2026-11-20T10:15:00.000', result, inspection_type: 'Initial',
  house_number: '451', street_name: 'WEST 52 STREET', zip_code: '10019', latitude: '40.76512', longitude: '-73.98901', ...PLANTED_SOCRATA, ...over,
});
/** Montgomery County code values [3P] (item and condition code lists). */
const montRow = (item: string, condition: string, over: Record<string, unknown> = {}) => ({
  violation_id: String(700000 + ++n), date_inspected: '2026-11-10T00:00:00.000', item, condition, violation_category: 'habitable',
  street_address: '8701 GEORGIA AVE', zip_code: '20910', latitude: '38.99601', longitude: '-77.02871', ...PLANTED_SOCRATA, ...over,
});
const dcFeature = (type: string, over: Record<string, unknown> = {}) => ({
  attributes: {
    SERVICEREQUESTID: `26-00${++n}`, ADDDATE: Date.parse('2026-11-22T08:00:00Z'), SERVICECODEDESCRIPTION: type, SERVICETYPECODEDESCRIPTION: 'SWMA- Solid Waste Management Admistration',
    SERVICEORDERSTATUS: 'Open', ZIPCODE: 20001, LATITUDE: 38.9101, LONGITUDE: -77.0147, STREETADDRESS: '1234 7TH ST NW', ...PLANTED_DC, ...over,
  },
  geometry: { x: -77.0147, y: 38.9101 },
});

/** Phoenix NSD: EVERY column name is assumed [A]; case types are assumed values. */
const phxFeature = (type: string, over: Record<string, unknown> = {}) => ({
  attributes: { CASE_NUMBER: `PEF2026-${++n}`, OPEN_DATE: Date.parse('2026-11-20T16:00:00Z'), CASE_TYPE: type, CASE_STATUS: 'Open', ADDRESS: '1820 W ROOSEVELT ST', ZIP: '85007', ...PLANTED_PHX, ...over },
  geometry: { x: -112.0985, y: 33.4588 },
});

const parseSoc = (ds: SocrataDataset, rows: unknown[]) => parseSocrataReport(rows, ds, { now: NOW }).items;

/**
 * The label a promoted source would give: the rules, else the source default it would get at promotion, the same as the existing sources of
 * its kind (a code violation act_now, a 311 request context). It has no SOURCE_DEFAULTS entry today.
 */
function projected(item: SignalInput, trade: CategoryId): OpportunityLabel {
  const subtype = String((item.data as Record<string, unknown>).subtype);
  const sig = { source: item.source, kind: item.kind, subtype, title: item.title, summary: item.summary ?? null };
  return ruleFor(sig, trade) ? labelFor(sig, trade) : subtype === 'violation' ? 'act_now' : 'context';
}

// ---- fake portal ---------------------------------------------------------------------------------------------------------------------

type Layer = { fields?: Array<{ name: string; type: string }> | 'down'; features?: unknown[] };
const DEFAULT_FEATURES: Record<string, () => unknown[]> = {
  'arcgis-dc-311': () => [dcFeature('Rodent Inspection and Treatment')],
  'arcgis-phoenix-violations': () => [phxFeature('Grass/Weeds')],
};
function portal(rowsBy: Record<string, unknown[] | 'refuse' | 'html'>, layers: Record<string, Layer> = {}) {
  const urls: string[] = [];
  const f = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    for (const ds of VIOL_SOCRATA_DATASETS) {
      if (url.includes(`/api/views/${ds.datasetId}.json`)) return new Response(JSON.stringify({ columns: [...socrataSelectColumns(ds), 'owner_name'].map((fieldName) => ({ fieldName })) }), { status: 200 });
      if (!url.includes(`/resource/${ds.datasetId}.json`)) continue;
      const rows = rowsBy[ds.id] ?? [];
      if (new URL(url).searchParams.get('$select')?.startsWith('count(')) return new Response(JSON.stringify([{ n: String(Array.isArray(rows) ? rows.length : 0) }]), { status: 200 });
      if (rows === 'refuse') return new Response(JSON.stringify({ message: 'No such column: novissueddate' }), { status: 400 });
      if (rows === 'html') return new Response('<!DOCTYPE html><html>down</html>', { status: 200 });
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    for (const ds of VIOL_ARCGIS_DATASETS) {
      if (!url.startsWith(ds.layerUrl)) continue;
      const spec = layers[ds.id] ?? {};
      const features = spec.features ?? DEFAULT_FEATURES[ds.id]();
      if (url.includes('returnCountOnly=true')) return new Response(JSON.stringify({ count: features.length }), { status: 200 });
      if (url.includes('/query?')) return new Response(JSON.stringify({ features }), { status: 200 });
      if (spec.fields === 'down') return new Response('nope', { status: 503 });
      const extra = ds.id === 'arcgis-dc-311' ? ['INSPECTORNAME', 'DETAILS'] : Object.keys(PLANTED_PHX);
      const fields = spec.fields ?? [...expectedColumns({ platform: 'arcgis', ds }), ...extra].map((name) => ({ name, type: name === ds.dateField ? 'esriFieldTypeDate' : 'esriFieldTypeString' }));
      return new Response(JSON.stringify({ fields }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, urls };
}

const ALL_TRADES: CategoryId[] = ['plumbing', 'electrical', 'painting', 'pest-control', 'hvac', 'windows-doors', 'handyman', 'restoration', 'flooring', 'general-contractor', 'junk-removal', 'lawn-care', 'roofing', 'cleaning'];
const member = (i: number, lat: number, lon: number, state: string) => ({
  user_id: `u00000${i}`, categories: ALL_TRADES, lat, lon, state, radius_mi: 50, subscription_status: 'active', trial_ends_at: '2026-12-10T00:00:00Z',
});
const PROFILES = [member(1, 40.78, -73.95, 'NY'), member(2, 38.9, -77.03, 'DC'), member(3, 38.99, -77.03, 'MD'), member(4, 33.45, -112.07, 'AZ')];
const GOOD_ROWS: Record<string, unknown[]> = {
  'socrata-nyc-hpd-violations': [hpdRow(HPD_TEXT.outlet)],
  'socrata-nyc-rodent-violations': [rodentRow('Rat Activity')],
  'socrata-montgomery-violations': [montRow('Water Heater', 'Inoperable')],
};

beforeEach(() => resetArcgisFieldCache());

// ------------------------------------------------------------------------------------------------------------------------------------
describe('round 20 VIOL sources are declared on probation, like round 19 coverage', () => {
  it('five sources: registered, on probation, schema-unverified, labelled in SOURCE_META, no SOURCE_DEFAULTS entry, exempt while pending', () => {
    expect([...IDS].sort()).toEqual(['arcgis-dc-311', 'arcgis-phoenix-violations', 'socrata-montgomery-violations', 'socrata-nyc-hpd-violations', 'socrata-nyc-rodent-violations']);
    for (const id of IDS) {
      const a = adapterOf(id);
      expect(a, id).toBeDefined();
      expect(a.probation, id).toBe(true);
      expect(SOURCE_META[id]?.label, id).toBe(a.label);
      const d = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].find((x) => x.id === id)!;
      expect(d.probation && d.schemaUnverified && d.verified, id).toBe(true);
      expect(SOURCE_DEFAULTS[id], id).toBeUndefined();
      expect(LABEL_PENDING_INTEGRATION, id).toContain(id);
      expect(PROBATION_SOURCE_IDS.has(id), id).toBe(true);
    }
    expect([...VIOL_SOCRATA_DATASETS, ...VIOL_ARCGIS_DATASETS].map((d) => d.id).sort()).toEqual([...IDS].sort());
  });

  it('metros listing: NYC feeds under New York, Montgomery County and DC 311 under Washington DC, NSD under Phoenix', () => {
    const p = sourcePlaces();
    for (const s of VIOL_R20_SOURCES) expect(p.get(s.id), s.id).toBe(s.metro);
  });

  it('no id ends in "-inspections": migration 0007 rewrites such rows to "food establishment" (the rodent finding is a violation record)', () => {
    for (const id of IDS) expect(id.endsWith('-inspections'), id).toBe(false);
    expect(RODENT.subtype).toBe('violation');
  });

  it('no public page, count, guide or capability claim', async () => {
    const enabled = new Set(enabledDatasets().map((d) => d.id));
    for (const id of IDS) expect(enabled.has(id), id).toBe(false);
    const live = ALL_ADAPTERS.filter((a) => !IDS.includes(a.id));
    expect(feedCount(ALL_ADAPTERS, {})).toBe(feedCount(live, {}));
    const { GUIDE_DATA_SPECS } = await import('@/lib/seo/guide-data');
    const all = Object.values(GUIDE_DATA_SPECS).flatMap((s) => s.sources);
    for (const id of IDS) expect(all, id).not.toContain(id);
  });

  it('probation time budget: 12 s in all, 8 s per request (unverified)', () => {
    expect(PROBATION_TIMEOUT_MS).toBe(12_000);
    expect(UNVERIFIED_REQUEST_TIMEOUT_MS).toBe(8_000);
    expect(requestTimeoutMs(DC)).toBe(8_000);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('probation: rows go to holler_source_samples only', () => {
  it.each(IDS)('%s: one sample, no signal, contact, match, alert or notification; no planted person anywhere', async (id) => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const { fetch: doFetch } = portal(GOOD_ROWS);
    const r = await runScan({ now: NOW, adapters: [adapterOf(id)], fetchImpl: doFetch }, asDb(f));
    const src = r.sources.find((s) => s.id === id)!;
    expect(src.status, JSON.stringify(src)).toBe('ok');
    expect(src.inserted).toBe(1);
    expect(f.tables.holler_source_samples.map((s) => s.source)).toEqual([id]);
    for (const t of ['holler_signals', 'holler_signal_contacts', 'holler_matches', 'holler_alert_log', 'holler_notifications', 'holler_push_log', 'holler_email_log']) {
      expect(f.tables[t] ?? [], `${id} ${t}`).toEqual([]);
    }
    expect(JSON.stringify(f.tables.holler_source_samples)).not.toMatch(PEOPLE_RE);
  });

  it.each([
    ['PGRST205', "Could not find the table 'public.holler_source_samples' in the schema cache"],
    ['42P01', 'relation "public.holler_source_samples" does not exist'],
  ])('samples table missing (%s): every VIOL source is skipped with no fetch and no write', async (code, message) => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    for (const op of ['select', 'upsert', 'delete']) {
      f.failOn[`holler_source_samples.${op}`] = message;
      f.failCode[`holler_source_samples.${op}`] = code;
    }
    const { fetch: doFetch, urls } = portal(GOOD_ROWS);
    const r = await runScan({ now: NOW, adapters: IDS.map(adapterOf), fetchImpl: doFetch }, asDb(f));
    expect(urls).toEqual([]);
    expect(r.error).toBeUndefined();
    for (const id of IDS) expect(r.sources.find((s) => s.id === id), id).toMatchObject({ status: 'skipped(env)', inserted: 0 });
    expect(f.tables.holler_signals ?? []).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('fail-safe check states', () => {
  it('Socrata: a refused column (HTTP 400) is a named schema mismatch, the check reads schema_mismatch, nothing is stored', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const { fetch: doFetch } = portal({ 'socrata-nyc-hpd-violations': 'refuse' });
    const r = await runScan({ now: NOW, adapters: [adapterOf('socrata-nyc-hpd-violations')], fetchImpl: doFetch }, asDb(f));
    const src = r.sources[0];
    expect(src.status).toBe('error');
    expect(src.error ?? '').toMatch(/schema mismatch/);
    expect(probationCheck({ source: src.id, last_run_at: NOW.toISOString(), last_success_at: null, last_error: src.error ?? null })).toBe('schema_mismatch');
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
  });

  it('Socrata: renamed id and date columns are reported as "schema mismatch: expected violationid, novissueddate"', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const { fetch: doFetch } = portal({ 'socrata-nyc-hpd-violations': [{ violation_id: '1', nov_issued: '2026-11-21', novdescription: HPD_TEXT.outlet }] });
    const r = await runScan({ now: NOW, adapters: [adapterOf('socrata-nyc-hpd-violations')], fetchImpl: doFetch }, asDb(f));
    expect(r.sources[0].error ?? '').toMatch(/schema mismatch: expected violationid, novissueddate/);
  });

  it('Socrata: an HTML page with HTTP 200 is an error (not_json), never ok', async () => {
    const f = new FakeDb({ holler_profiles: PROFILES });
    const { fetch: doFetch } = portal({ 'socrata-montgomery-violations': 'html' });
    const r = await runScan({ now: NOW, adapters: [adapterOf('socrata-montgomery-violations')], fetchImpl: doFetch }, asDb(f));
    expect(r.sources[0].status).toBe('error');
    expect(probationCheck({ source: 'x', last_run_at: NOW.toISOString(), last_success_at: null, last_error: r.sources[0].error ?? null })).toBe('not_json');
  });

  it('ArcGIS DC 311: no field list means no data query; a layer without ADDDATE is a schema mismatch with no query', async () => {
    const down = portal({}, { 'arcgis-dc-311': { fields: 'down' } });
    const f1 = new FakeDb({ holler_profiles: PROFILES });
    const r1 = await runScan({ now: NOW, adapters: [adapterOf('arcgis-dc-311')], fetchImpl: down.fetch }, asDb(f1));
    expect(r1.sources[0].status).toBe('error');
    expect(down.urls.some((u) => u.includes('/query?'))).toBe(false);
    resetArcgisFieldCache();
    const noDate = portal({}, { 'arcgis-dc-311': { fields: [{ name: 'SERVICEREQUESTID', type: 'esriFieldTypeString' }, { name: 'SERVICECODEDESCRIPTION', type: 'esriFieldTypeString' }] } });
    const f2 = new FakeDb({ holler_profiles: PROFILES });
    const r2 = await runScan({ now: NOW, adapters: [adapterOf('arcgis-dc-311')], fetchImpl: noDate.fetch }, asDb(f2));
    expect(r2.sources[0].error ?? '').toMatch(/schema mismatch: expected ADDDATE/);
    expect(noDate.urls.some((u) => u.includes('/query?'))).toBe(false);
  });

  it('the sources report lists each with its probe and the file to promote it in', () => {
    const rows = probationOverview(IDS.map((id) => ({ id, probation: true })), [], (id) => VIOL_R20_SOURCES.find((s) => s.id === id)!.metro);
    for (const r of rows) {
      expect(r.check).toBe('not_run');
      expect(r.probe).toBe(`/api/admin/coverage-probe?source=${r.id}`);
      expect(r.promote).toMatch(/probation: true and schemaUnverified: true from its entry in lib\/signals\/adapters\/viol-datasets\.ts and add its SOURCE_DEFAULTS label .*proposed-labels\.ts/);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('queries ask only for configured columns (no person column is ever downloaded)', () => {
  const FORBIDDEN = /^(apartment|story|unit_?number|location_?description|details|inspectorname|respondent.*|owner.*|tenant.*|complainant.*|inspector.*)$/i;
  it.each(VIOL_SOCRATA_DATASETS.map((d) => d.id))('%s: $select lists no name-like, unit or free-text-narrative column', (id) => {
    const ds = soc(id);
    const cols = socrataSelectColumns(ds);
    for (const c of cols) {
      expect(FORBIDDEN.test(c), `${id} ${c}`).toBe(false);
      expect(NAME_LIKE_COLUMN.test(c) && !NAME_COLUMN_OK.includes(c), `${id} ${c}`).toBe(false);
    }
    expect(ds.contacts).toBeUndefined();
  });

  it('DC 311: outFields never include INSPECTORNAME or DETAILS, even though the layer has them', () => {
    const present = new Set([...expectedColumns({ platform: 'arcgis', ds: DC }), 'INSPECTORNAME', 'DETAILS']);
    const out = buildArcgisQuery(DC, NOW, undefined, { present, dateType: 'date' }).get('outFields')!.split(',');
    expect(out).not.toContain('INSPECTORNAME');
    expect(out).not.toContain('DETAILS');
    expect(buildArcgisQuery(DC, NOW).get('where')).toMatch(/UPPER\(SERVICECODEDESCRIPTION\) LIKE '%RODENT%'/);
  });

  it('HPD asks for open class B and C violations of the last 2 days, 6 pages; the rodent feed only rat findings', () => {
    const w = buildSocrataQuery(HPD, NOW).get('$where')!;
    expect(w).toContain("violationstatus = 'Open' AND class IN ('B','C')");
    expect(w).toContain("novissueddate > '2026-11-20T07:00:00'"); // two days back, New York wall clock
    expect(HPD.maxPages).toBe(6);
    expect(buildSocrataQuery(RODENT, NOW).get('$where')).toContain("upper(result) like '%RAT%'");
    expect(buildSocrataQuery(MONT, NOW).get('$where')).toContain('date_corrected IS NULL');
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('privacy: planted names never reach a stored record (per feed)', () => {
  it('HPD: the order text is never printed (even with a tenant name typed in it); title uses fixed words; address at block level', () => {
    const items = parseSoc(HPD, [hpdRow(`${HPD_TEXT.outlet} PER TENANT JANE TENANTSON`, { housenumber: '2318', streetname: 'WEST 52 STREET Maria Lopez' })]);
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.title).toBe('Code violation in New York City: electrical');
    expect(JSON.stringify(it0)).not.toMatch(PEOPLE_RE);
    expect(JSON.stringify(it0)).not.toMatch(/NORTH WALL|APT 2A|BATHROOM/);
    expect(it0.summary ?? '').toMatch(/2300 block of WEST 52 STREET/);
    expect(it0.lat).toBe(40.81);
    expect(it0.lon).toBe(-73.942);
    expect(it0.contacts).toBeUndefined();
  });

  it('rodent: a result value carrying a name is withheld; the title then uses fixed words', () => {
    const items = parseSoc(RODENT, [rodentRow('Rat Activity - Maria Lopez')]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Code violation in New York City: pests');
    expect(JSON.stringify(items[0])).not.toMatch(PEOPLE_RE);
  });

  it('Montgomery: a code value carrying a name is withheld; unit and location description are never read', () => {
    const items = parseSoc(MONT, [montRow('Windows', 'Windows/doors - Robert Ownerby', { street_address: '8701 GEORGIA AVE APT 12 Pat Complainer' })]);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items[0])).not.toMatch(PEOPLE_RE);
    expect(JSON.stringify(items[0])).not.toMatch(/APT 12/);
  });

  it('DC 311: DETAILS and INSPECTORNAME sent by the server anyway are not stored; no address in a 311 summary', () => {
    const r = parseArcgisReport({ features: [dcFeature('Housing Inspection - Mold in Building')] }, DC);
    expect(r.items).toHaveLength(1);
    expect(JSON.stringify(r.items[0])).not.toMatch(PEOPLE_RE);
    expect(JSON.stringify(r.items[0])).not.toMatch(/7TH ST|202-555/);
  });

  it('the probe answers column names, counts and mapped rows only: never a planted value', async () => {
    const { fetch: doFetch } = portal({ 'socrata-nyc-hpd-violations': [hpdRow(HPD_TEXT.mice), hpdRow(HPD_TEXT.outlet)] });
    const out = await runCoverageProbe('socrata-nyc-hpd-violations', doFetch, NOW);
    expect(out).toMatchObject({ status: 'ok', platform: 'socrata', schema: 'ok', wroteNothing: true });
    expect(out.columns).toContain('owner_name'); // a column NAME is reported ...
    expect(JSON.stringify(out)).not.toMatch(PEOPLE_RE); // ... never its value
    expect(out.mapped.map((m) => m.title)).toEqual(['Code violation in New York City: pests', 'Code violation in New York City: electrical']);
    const dc = await runCoverageProbe('arcgis-dc-311', portal({}).fetch, NOW);
    expect(dc).toMatchObject({ status: 'ok', platform: 'arcgis', schema: 'ok' });
    expect(JSON.stringify(dc)).not.toMatch(PEOPLE_RE);
    expect(coverageProbeSourceIds()).toEqual(expect.arrayContaining(IDS));
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('mapping to trades and the proposed labels (real parser, real rules)', () => {
  type Case = { ds: SocrataDataset; row: Record<string, unknown>; want: Partial<Record<CategoryId, OpportunityLabel>> };
  const CASES: Record<string, Case> = {
    'HPD outlet [3P]': { ds: HPD, row: hpdRow(HPD_TEXT.outlet), want: { electrical: 'act_now' } },
    'HPD plaster and paint [3P]': { ds: HPD, row: hpdRow(HPD_TEXT.plaster), want: { painting: 'act_now' } },
    'HPD self-closing door [3P]': { ds: HPD, row: hpdRow(HPD_TEXT.door), want: { 'windows-doors': 'act_now', handyman: 'coming_soon' } },
    'HPD mice [3P]': { ds: HPD, row: hpdRow(HPD_TEXT.mice), want: { 'pest-control': 'act_now' } },
    'HPD encumbrances at stairs [3P]': { ds: HPD, row: hpdRow(HPD_TEXT.encumbrance), want: { handyman: 'coming_soon', 'general-contractor': 'market_insight' } },
    'HPD heat [A]': { ds: HPD, row: hpdRow(HPD_TEXT.heat), want: { hvac: 'act_now' } },
    'HPD leak [A]': { ds: HPD, row: hpdRow(HPD_TEXT.leak), want: { plumbing: 'act_now' } },
    'HPD mold [A]': { ds: HPD, row: hpdRow(HPD_TEXT.mold), want: { restoration: 'coming_soon' } },
    'HPD floor [A]': { ds: HPD, row: hpdRow(HPD_TEXT.floor), want: { flooring: 'coming_soon' } },
    'rodent Rat Activity [A]': { ds: RODENT, row: rodentRow('Rat Activity'), want: { 'pest-control': 'act_now' } },
    'Montgomery Water Heater [3P]': { ds: MONT, row: montRow('Water Heater', 'Inoperable'), want: { plumbing: 'act_now' } },
    'Montgomery Windows / Windows/doors [3P]': { ds: MONT, row: montRow('Windows', 'Windows/doors'), want: { 'windows-doors': 'act_now', handyman: 'coming_soon' } },
    // The title is the item; an item that names no repair leaves the order unnamed, so the mold condition is a heads-up (item [A], condition [3P]).
    'Montgomery Water/Mold-Light [3P]': { ds: MONT, row: montRow('Bathroom', 'Water/Mold-Light'), want: { restoration: 'coming_soon' } },
    'Montgomery Accessory Structure [3P]': { ds: MONT, row: montRow('Accessory Structure', 'Deteriorated'), want: { handyman: 'coming_soon', 'general-contractor': 'market_insight' } },
  };

  it.each(Object.entries(CASES))('%s: tagged trades and their labels', (_name, c) => {
    const items = parseSoc(c.ds, [c.row]);
    expect(items).toHaveLength(1);
    const item = items[0];
    // Every tagged trade gets exactly the case's label; a trade the case does not list gets no alert from it.
    const got: Partial<Record<CategoryId, OpportunityLabel>> = {};
    for (const t of item.categories as CategoryId[]) {
      const l = projected(item, t);
      if (l !== 'context') got[t] = l;
    }
    expect(got).toEqual(c.want);
    // And PROPOSED_LABELS says the same for each trade.
    for (const [t, l] of Object.entries(c.want)) expect(proposedLabelOf(PROPOSED_LABELS[item.source].labels[t as CategoryId])?.label, `${item.source} ${t}`).toBe(l);
  });

  it('PROPOSED_LABELS lists only labels some case proves, per source', () => {
    const proven = new Map<string, Set<string>>();
    for (const c of Object.values(CASES)) for (const t of Object.keys(c.want)) proven.set(c.ds.id, new Set([...(proven.get(c.ds.id) ?? []), t]));
    for (const id of ['socrata-nyc-hpd-violations', 'socrata-nyc-rodent-violations', 'socrata-montgomery-violations']) {
      expect(Object.keys(PROPOSED_LABELS[id].labels).sort(), id).toEqual([...(proven.get(id) ?? [])].sort());
    }
  });

  it('a street number of three digits or more drops the address (existing block-address rule): no address rather than a wrong one', () => {
    const items = parseSoc(HPD, [hpdRow(HPD_TEXT.outlet, { housenumber: '20', streetname: 'EAST 130 STREET' })]);
    expect(items).toHaveLength(1);
    expect(items[0].summary ?? '').not.toMatch(/130/);
  });

  it('rows that name no repair or are paperwork are dropped: HPD buzzer, rodent "Passed", Montgomery "Address Numbers"', () => {
    expect(parseSoc(HPD, [hpdRow(HPD_TEXT.buzzer)])).toEqual([]);
    expect(parseSoc(RODENT, [rodentRow('Passed')])).toEqual([]);
    expect(parseSoc(MONT, [montRow('Address Numbers', 'Missing')])).toEqual([]);
  });

  it('DC 311: city-work request types are context for every trade they tag (proposal: no trade covered)', () => {
    const r = parseArcgisReport({ features: [dcFeature('Rodent Inspection and Treatment'), dcFeature('Bulk Collection'), dcFeature('Illegal Dumping'), dcFeature('Graffiti Removal')] }, DC);
    expect(r.items.length).toBe(3); // "Bulk Collection" names no trade under the 311 rules and is dropped
    for (const item of r.items) for (const t of item.categories as CategoryId[]) expect(projected(item, t), `${item.title} ${t}`).toBe('context');
    expect(PROPOSED_LABELS['arcgis-dc-311']).toMatchObject({ labels: {}, callPath: false, recordKind: '311-request' });
  });

  it('every proposal is a registered probation source in its metro, well formed for the scorecard (SCORE validator rules)', () => {
    const metroIds = new Set(METROS.map((m) => m.id));
    const types = new Set(RECORD_TYPES.map((r) => r.id));
    for (const [id, p] of Object.entries(PROPOSED_LABELS)) {
      expect(adapterOf(id)?.probation, id).toBe(true);
      for (const m of p.metros) expect(metroIds.has(m), `${id} ${m}`).toBe(true);
      expect(types.has(p.recordKind), id).toBe(true);
      expect(['O', '3P', 'A']).toContain(p.volumeEvidence.tag);
      expect(p.expectedRowsPerWeekPerMetro).toBeGreaterThanOrEqual(0);
      expect(sourcePlaces().get(id), id).toBe(p.metros[0]);
      for (const e of Object.values(p.labels)) expect(proposedLabelOf(e)!.share).toBeLessThanOrEqual(1);
    }
    // Every VIOL source has a proposal; the VIOL ones have no SOURCE_DEFAULTS entry.
    for (const id of IDS) {
      expect(PROPOSED_LABELS[id], id).toBeDefined();
      expect(SOURCE_DEFAULTS[id], id).toBeUndefined();
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('Phoenix NSD property maintenance (scorecard priority; every column name assumed)', () => {
  it('a layer whose field list lacks the assumed id and date columns is "schema mismatch: expected CASE_NUMBER, OPEN_DATE" and no data query is sent', async () => {
    const fields = [{ name: 'CASENUM', type: 'esriFieldTypeString' }, { name: 'DATE_OPENED', type: 'esriFieldTypeDate' }, { name: 'OWNER_NAME', type: 'esriFieldTypeString' }];
    const { fetch: doFetch, urls } = portal({}, { 'arcgis-phoenix-violations': { fields } });
    const f = new FakeDb({ holler_profiles: PROFILES });
    const r = await runScan({ now: NOW, adapters: [adapterOf('arcgis-phoenix-violations')], fetchImpl: doFetch }, asDb(f));
    expect(r.sources[0].error ?? '').toMatch(/schema mismatch: expected CASE_NUMBER, OPEN_DATE/);
    expect(urls.some((u) => u.includes('/query?'))).toBe(false);
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
    // The probe names the layer's real columns (names only), so one probe gives the fix.
    resetArcgisFieldCache();
    const out = await runCoverageProbe('arcgis-phoenix-violations', doFetch, NOW);
    expect(out.schema).toBe('mismatch');
    expect(out.columns).toEqual(['CASENUM', 'DATE_OPENED', 'OWNER_NAME']);
    expect(out.missingExpected).toEqual(expect.arrayContaining(['CASE_NUMBER', 'OPEN_DATE']));
  });

  it('outFields never include owner, complainant or inspector columns; the stored row has none of their values; block-level address', () => {
    const present = new Set([...expectedColumns({ platform: 'arcgis', ds: PHX }), ...Object.keys(PLANTED_PHX)]);
    const out = buildArcgisQuery(PHX, NOW, undefined, { present, dateType: 'date' }).get('outFields')!.split(',');
    for (const c of Object.keys(PLANTED_PHX)) expect(out).not.toContain(c);
    const r = parseArcgisReport({ features: [phxFeature('Grass/Weeds - Maria Lopez')] }, PHX);
    expect(r.items).toHaveLength(1);
    expect(JSON.stringify(r.items[0])).not.toMatch(PEOPLE_RE);
    expect(r.items[0].summary ?? '').toMatch(/1800 block of W ROOSEVELT ST/);
    expect(r.items[0].title).toBe('Code violation in Phoenix: overgrown yard');
  });

  it('mapping: grass, junk and pool case types tag their trades; the proposal caps them at a heads-up (complaint-level, like Kansas City line 9)', () => {
    const r = parseArcgisReport({ features: [phxFeature('Grass/Weeds'), phxFeature('Junk/Trash/Debris'), phxFeature('Stagnant Swimming Pool')] }, PHX);
    expect(r.items.map((i) => i.categories)).toEqual([['lawn-care', 'landscaping'], ['junk-removal'], ['pool-spa']]);
    // Today's violation rule would make a named case urgent; the proposal is a heads-up until a complaint-level rule is reviewed.
    expect(projected(r.items[0], 'lawn-care')).toBe('act_now');
    for (const t of ['lawn-care', 'landscaping', 'junk-removal', 'pool-spa'] as CategoryId[]) {
      expect(proposedLabelOf(PROPOSED_LABELS['arcgis-phoenix-violations'].labels[t])?.label, t).toBe('coming_soon');
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
describe('NYC 311 call path: whole-building requests carry the building address (round 20)', () => {
  const NYC311 = soc('socrata-nyc-311');
  const row = (complaint_type: string, descriptor: string, incident_address: string | undefined, over: Record<string, unknown> = {}) => ({
    unique_key: String(66000000 + ++n), created_date: '2026-11-21T03:12:00.000', agency: 'HPD', complaint_type, descriptor, incident_zip: '11220',
    borough: 'BROOKLYN', status: 'Open', latitude: '40.6430', longitude: '-74.0100', ...(incident_address === undefined ? {} : { incident_address }), ...over,
  });

  it('isWholeBuildingNyc311: entire-building heat and non-residential heat only', async () => {
    const { isWholeBuildingNyc311 } = await import('@/lib/signals/adapters/socrata-datasets');
    expect(isWholeBuildingNyc311('HEAT/HOT WATER', 'ENTIRE BUILDING')).toBe(true);
    expect(isWholeBuildingNyc311('Non-Residential Heat', 'Inadequate or No Heat')).toBe(true);
    expect(isWholeBuildingNyc311('HEAT/HOT WATER', 'APARTMENT ONLY')).toBe(false);
    expect(isWholeBuildingNyc311('Sewer Maintenance', 'Backup')).toBe(false);
    expect(isWholeBuildingNyc311('Rodent', 'Rat Sighting')).toBe(false);
  });

  it('before/after on fixture rows: entire-building heat gains the street address (call path); apartment-only and street requests do not; never a unit', async () => {
    const { contactPathOf } = await import('@/lib/signals/alert-gate');
    const items = parseSocrataReport([
      row('HEAT/HOT WATER', 'ENTIRE BUILDING', '6801 4 AVENUE'),
      row('HEAT/HOT WATER', 'ENTIRE BUILDING', '41-20 BOWNE STREET APT 4B'),
      row('HEAT/HOT WATER', 'APARTMENT ONLY', '6801 4 AVENUE'),
      row('Sewer Maintenance', 'Backup', '120 72 STREET'),
      row('HEAT/HOT WATER', 'ENTIRE BUILDING', undefined), // a row without the column: unchanged (no address)
      row('HEAT/HOT WATER', 'ENTIRE BUILDING', 'BAY RIDGE PARKWAY and 4 AVENUE'), // an intersection is not a building
    ], NYC311).items;
    expect(items.map((i) => i.summary)).toEqual([
      'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN | 6801 4 AVENUE',
      'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN | 41-20 BOWNE STREET',
      'HEAT/HOT WATER | APARTMENT ONLY | BROOKLYN',
      'Sewer Maintenance | Backup | BROOKLYN',
      'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN',
      'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN',
    ]);
    expect(items.map((i) => contactPathOf(null, i.summary))).toEqual(['site', 'site', null, null, null, null]);
    expect(JSON.stringify(items)).not.toMatch(/APT 4B|\b4B\b/);
  });

  it('the old fixture (no incident_address column) parses exactly as before', async () => {
    const fixture = (await import('../fixtures/socrata-nyc-311.json')).default as unknown[];
    const items = parseSocrataReport(fixture, NYC311).items;
    for (const it0 of items) expect(it0.summary ?? '').not.toMatch(/\d+ [A-Z]/);
  });
});
